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
import type { CountryChangeInfo, EgressInfo } from '../../shared/types'
import type { EnvRecord } from '../db'
import { decryptProxyConfig, getEnvDao, getLogger } from '../db'
import { ensureKernel } from '../kernel'
import { testEgress, toPlaywrightProxy, type PlaywrightProxyOptions } from '../proxy'
import { buildFingerprintLaunchOptions, diffAlignCountry, injectFingerprint } from '../fingerprint'
import { envDownloadsDir, envProfileDir } from '../../shared/paths'
import { getStatus, setStatus } from './status'

const contexts = new Map<string, BrowserContext>()

export function getContext(id: string): BrowserContext | undefined {
  return contexts.get(id)
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
  setStatus(id, 'starting')
  try {
    // 1. 内核就绪（缺失则触发下载；失败错误已带 KERNEL_*/DISK_FULL code）
    const kernel = await ensureKernel()
    if (!kernel.path) {
      throw Object.assign(new Error('内核路径缺失'), { code: 'KERNEL_CORRUPT' })
    }

    // 2. 代理测连（有代理才测；明文密码仅在本次调用内存中出现）
    let egress: EgressInfo | null = null
    let proxy: PlaywrightProxyOptions | undefined
    if (record.proxyConfig) {
      const cfg = decryptProxyConfig(record.proxyConfig)
      egress = await testEgress(cfg)
      proxy = toPlaywrightProxy(cfg)
    }

    // 3. 国家变更检测（不阻塞启动，交给 07 确认流）
    const diff = egress ? diffAlignCountry(record.alignFields, egress.country) : null
    const countryChanged = diff && diff.changed ? { envId: id, from: diff.from, to: diff.to } : null

    // 4. 启动：独立 profile + 隔离下载目录 + 指纹/对齐原生选项
    //    下载目录用 playwright 原生 downloadsPath（等价于任务文档中的 CDP
    //    Browser.setDownloadBehavior 方案，无需额外 CDP 会话）
    const fp = buildFingerprintLaunchOptions(record.fingerprint, record.alignFields)
    const context = await chromium.launchPersistentContext(envProfileDir(id), {
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

    // 5. 核心 Chrome 指纹注入（init script，后续所有页面生效）
    await injectFingerprint(context, record.fingerprint)

    // 6. running + 落库最后启动时间 + 挂钩子
    contexts.set(id, context)
    setStatus(id, 'running')
    dao.updateEnv(id, { lastLaunchedAt: Date.now() })
    getLogger().info('launcher.launched', {
      id,
      country: egress?.country ?? 'direct',
      changed: countryChanged != null
    })
    watchContext(id, context)

    return { context, countryChanged, egress }
  } catch (e) {
    setStatus(id, 'idle')
    getLogger().error('launcher.launch_failed', {
      id,
      code: (e as { code?: string }).code ?? 'INTERNAL',
      message: e instanceof Error ? e.message : String(e)
    })
    throw e
  }
}

/**
 * 关闭/崩溃钩子（06-T4/T6）
 * - stopping 中关闭：正常停止 → idle
 * - running 中关闭：用户关浏览器窗口 = 停止该环境（§6.6）→ idle
 * - starting 中关闭：从未达到 running，视为异常退出 → env:crashed + idle
 */
function watchContext(id: string, context: BrowserContext): void {
  context.on('close', () => {
    contexts.delete(id)
    const at = getStatus(id)
    if (at === 'stopping') {
      setStatus(id, 'idle')
      return
    }
    if (at === 'starting') {
      getLogger().error('launcher.crashed_during_start', { id })
      broadcast(IPC.envCrashed, { envId: id, exitCode: null })
      setStatus(id, 'idle')
      return
    }
    // running：视作用户主动关窗（§6.6 语义），正常停止
    getLogger().info('launcher.window_closed', { id })
    setStatus(id, 'idle')
  })
}

function failNotFound(id: string): never {
  throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
}
