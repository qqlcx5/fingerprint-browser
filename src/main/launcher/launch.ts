/**
 * 环境启动流水线（06-T2）
 *
 * 顺序：状态置 starting → 内核就绪 → 代理测连（解密仅内存）→ 国家变更检测
 *   → launchPersistentContext（指纹/对齐原生选项 + 隔离下载目录）→ 指纹注入
 *   → running + lastLaunchedAt 落库 → 挂接关闭/崩溃钩子
 * 任何一步失败：状态回 idle，错误（code 已由下层给定）原样上抛给 07。
 */
import { chromium, type BrowserContext } from 'playwright-core'
import { broadcast } from '../ipc'
import { IPC } from '../../shared/types'
import { rm } from 'fs/promises'
import { join } from 'path'
import type { CountryChangeInfo, EgressInfo } from '../../shared/types'
import type { EnvRecord } from '../db'
import { decryptProxyConfig, getEnvDao, getLogger } from '../db'
import { ensureKernel } from '../kernel'
import { testEgress, toPlaywrightProxy, type PlaywrightProxyOptions } from '../proxy'
import { buildFingerprintLaunchOptions, diffAlignCountry, injectFingerprint } from '../fingerprint'
import { envDownloadsDir, envProfileDir } from '../../shared/paths'
import { killByProfileDir } from './orphan'
import { getStatus, setStatus } from './status'

const contexts = new Map<string, BrowserContext>()
const launchTokens = new Map<string, symbol>()
const reportedCrashes = new Set<string>()

export function getContext(id: string): BrowserContext | undefined {
  return contexts.get(id)
}

/** 取消尚未完成的启动；已创建 context 的关闭交由 stopEnv() 处理。 */
export function cancelLaunch(id: string): void {
  launchTokens.delete(id)
}

function isLaunchCurrent(id: string, token: symbol): boolean {
  return launchTokens.get(id) === token
}

function failLaunchCancelled(): never {
  throw Object.assign(new Error('环境启动已取消'), { code: 'INTERNAL' })
}

function reportCrash(id: string, source: string): void {
  if (reportedCrashes.has(id)) return
  reportedCrashes.add(id)
  getLogger().error('launcher.crashed', { id, source, exitCode: null })
  broadcast(IPC.envCrashed, { envId: id, exitCode: null })
}

export interface LaunchResult {
  /** 启动成功后的持久化上下文（06 内部已挂好钩子，07 无需再管） */
  context: BrowserContext
  /** 非空 = 代理出口国家与对齐字段不一致，07 需发起确认流（§6.5） */
  countryChanged: CountryChangeInfo | null
  /** 本次测连的出口信息（有代理时） */
  egress: EgressInfo | null
}

export async function launchEnv(id: string): Promise<LaunchResult> {
  const dao = getEnvDao()
  const record: EnvRecord = dao.getEnv(id) ?? failNotFound(id)
  const token = Symbol(id)
  launchTokens.set(id, token)
  reportedCrashes.delete(id)
  setStatus(id, 'starting')
  let context: BrowserContext | undefined
  try {
    // 1. 内核就绪（缺失则触发下载；失败错误已带 KERNEL_*/DISK_FULL code）
    const kernel = await ensureKernel()
    if (!isLaunchCurrent(id, token)) failLaunchCancelled()
    if (!kernel.path) {
      throw Object.assign(new Error('内核路径缺失'), { code: 'KERNEL_CORRUPT' })
    }

    // 2. 代理测连（有代理才测；明文密码仅在本次调用内存中出现）
    let egress: EgressInfo | null = null
    let proxy: PlaywrightProxyOptions | undefined
    if (record.proxyConfig) {
      const cfg = decryptProxyConfig(record.proxyConfig)
      egress = await testEgress(cfg)
      if (!isLaunchCurrent(id, token)) failLaunchCancelled()
      proxy = toPlaywrightProxy(cfg)
    }

    // 3. 国家变更检测（不阻塞启动，交给 07 确认流）
    const diff = egress ? diffAlignCountry(record.alignFields, egress.country) : null
    const countryChanged = diff && diff.changed ? { envId: id, from: diff.from, to: diff.to } : null

    // 4. 清理残留占用：上次崩溃/强杀后仍存活的内核进程会锁住 profile 缓存目录，
    //    导致 Chromium「Unable to move the cache (0x5)」与 GPU 缓存创建失败(-2)。
    //    随后清掉 GPU 着色器缓存目录（体积小、Chromium 自动重建，无用户数据损失）。
    await killByProfileDir(id)
    await new Promise((r) => setTimeout(r, 150)) // 等待进程句柄释放
    await repairGpuCacheDirs(id)

    // 5. 启动：独立 profile + 隔离下载目录 + 指纹/对齐原生选项
    //    下载目录用 playwright 原生 downloadsPath（等价于任务文档中的 CDP
    //    Browser.setDownloadBehavior 方案，无需额外 CDP 会话）
    const fp = buildFingerprintLaunchOptions(record.fingerprint, record.alignFields)
    context = await chromium.launchPersistentContext(envProfileDir(id), {
      executablePath: kernel.path,
      proxy,
      downloadsPath: envDownloadsDir(id),
      acceptDownloads: true,
      headless: false,
      args: fp.args,
      userAgent: fp.userAgent,
      viewport: fp.viewport,
      screen: fp.screen,
      locale: fp.locale,
      timezoneId: fp.timezoneId,
      geolocation: fp.geolocation,
      permissions: fp.permissions,
      ignoreDefaultArgs: ['--enable-automation']
    })
    if (!isLaunchCurrent(id, token)) {
      await context.close()
      failLaunchCancelled()
    }

    // 创建 context 后立即登记与监听，保证注入阶段的异常关闭也能报告。
    contexts.set(id, context)
    watchContext(id, context)

    // 6. 核心 Chrome 指纹注入（init script，后续所有页面生效）
    await injectFingerprint(context, record.fingerprint)
    if (!isLaunchCurrent(id, token)) failLaunchCancelled()

    // 7. running + 落库最后启动时间
    launchTokens.delete(id)
    setStatus(id, 'running')
    dao.updateEnv(id, { lastLaunchedAt: Date.now() })
    getLogger().info('launcher.launched', {
      id,
      country: egress?.country ?? 'direct',
      changed: countryChanged != null
    })

    return { context, countryChanged, egress }
  } catch (e) {
    // 已被 stopEnv 取消的旧启动不得覆盖新启动的状态或日志。
    if (isLaunchCurrent(id, token)) {
      launchTokens.delete(id)
      if (context && contexts.get(id) === context) {
        setStatus(id, 'stopping')
        await context.close().catch(() => {})
        contexts.delete(id)
      }
      setStatus(id, 'idle')
      getLogger().error('launcher.launch_failed', {
        id,
        code: (e as { code?: string }).code ?? 'INTERNAL',
        message: e instanceof Error ? e.message : String(e)
      })
    }
    throw e
  }
}

/**
 * 启动前修复 GPU/着色器缓存目录：被锁死或损坏的缓存目录会导致
 * 「Unable to move the cache (0x5)」/「Gpu Cache Creation failed: -2」。
 * 仅删除可再生成的缓存目录，不触碰 Cookies/Local State 等用户数据。
 */
async function repairGpuCacheDirs(id: string): Promise<void> {
  const base = envProfileDir(id)
  await Promise.all(
    ['ShaderCache', 'GrShaderCache', 'GraphiteDawnCache', 'DawnCache', 'GPUCache'].map((name) =>
      rm(join(base, name), { recursive: true, force: true }).catch(() => {})
    )
  )
}

/**
 * 关闭/崩溃钩子（06-T4/T6）。
 * context.close 本身不提供退出码；Page 的 crash 事件可识别渲染进程崩溃，
 * 而 running context 的普通 close 仍按“用户关闭浏览器窗口”处理。
 */
function watchContext(id: string, context: BrowserContext): void {
  const onPageCrash = (): void => {
    const at = getStatus(id)
    if (at === 'idle' || at === 'stopping') return
    reportCrash(id, 'page_crash')
    setStatus(id, 'stopping')
    void context.close().catch(() => setStatus(id, 'idle'))
  }
  for (const page of context.pages()) page.on('crash', onPageCrash)
  context.on('page', (page) => page.on('crash', onPageCrash))
  context.on('close', () => {
    contexts.delete(id)
    const at = getStatus(id)
    if (at === 'stopping') {
      setStatus(id, 'idle')
      return
    }
    if (at === 'starting') {
      reportCrash(id, 'context_closed_during_start')
      setStatus(id, 'idle')
      return
    }
    // running 状态的 close 语义为用户关闭浏览器窗口（§6.6）。
    getLogger().info('launcher.window_closed', { id })
    setStatus(id, 'idle')
  })
}

function failNotFound(id: string): never {
  throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
}
