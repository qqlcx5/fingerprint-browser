/**
 * 业务编排层（07）：env:* 与 app:* IPC 通道的唯一实现处。
 *
 * 数据流：渲染层 → 这里（校验/编排）→ db / launcher / fingerprint / proxy。
 * 错误：下层业务错误（code 已定）原样透传；本层校验失败抛 VALIDATION/NOT_FOUND/ENV_RUNNING。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { logsDir } from '../../shared/paths'
import { exportEnvs, importEnvs } from './transfer'
import { defineIpc, fail } from '../ipc'
import { IPC } from '../../shared/types'
import type {
  AlignConfirmInput,
  CountryChangeInfo,
  Env,
  EnvCreateInput,
  EnvSummary,
  EnvUpdateInput,
  FingerprintUpdateInput,
  IdInput,
  StartupNotice
} from '../../shared/types'
import {
  createEnvWithDirs,
  deleteEnvWithDirs,
  getEnvDao,
  getLogger,
  toPublicBinding,
  toPublicProxy,
  type EnvChanges,
  type EnvRecord
} from '../db'
import {
  alignFieldsForCountry,
  coreFingerprintError,
  generateCoreFingerprint
} from '../fingerprint'
import { testEgress, validateProxyConfig } from '../proxy'
import { getStatus, getStatusMap, launchEnv, stopEnv } from '../launcher'
import { drainNotices, pushNotice } from './notices'
import { wipeAllData } from './wipe'

/** DB 记录 → 渲染层 Env（包含完整本地代理配置）。 */
function toEnv(r: EnvRecord): Env {
  return {
    id: r.id,
    name: r.name,
    remark: r.remark,
    group: r.group,
    shop: r.shop,
    fingerprint: r.fingerprint,
    alignFields: r.alignFields,
    proxyConfig: r.proxyConfig ? toPublicProxy(r.proxyConfig) : null,
    proxyBinding: toPublicBinding(r.proxyBinding),
    securityStatus: r.securityStatus,
    hasTotpSecret: r.totpSecretRef !== null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastLaunchedAt: r.lastLaunchedAt
  }
}

function toSummary(r: EnvRecord): EnvSummary {
  const p = r.proxyBinding?.config ?? r.proxyConfig
  return {
    id: r.id,
    name: r.name,
    remark: r.remark,
    group: r.group,
    shop: r.shop,
    status: getStatus(r.id),
    proxySummary: p ? `${p.type}://${p.host}:${p.port}` : null,
    expectedEgressIp: r.proxyBinding?.expectedEgressIp ?? null,
    egressCountry: r.proxyBinding?.country ?? null,
    verifiedAt: r.proxyBinding?.verifiedAt ?? null,
    securityStatus: r.securityStatus,
    lastLaunchedAt: r.lastLaunchedAt
  }
}

/** 待确认的地区变更（env:start 检出 → align:confirm 消费，§6.5） */
const pendingAlign = new Map<string, string>()

function registerEnvChannels(): void {
  // T6 env:list：DB join 内存运行状态
  defineIpc(IPC.envList, (): EnvSummary[] => getEnvDao().listEnvs().map(toSummary))

  // env:get 详情（编辑弹窗需要完整代理字段）
  defineIpc<IdInput, Env | null>(IPC.envGet, (input) => {
    const r = getEnvDao().getEnv(input.id)
    return r ? toEnv(r) : null
  })

  // T1 env:create：校验 → 测代理取出口国家 → 生成指纹/对齐 → 落库+建目录
  defineIpc<EnvCreateInput, Env>(IPC.envCreate, async (input) => {
    const name = (input.name ?? '').trim()
    if (!name) fail('VALIDATION', '环境名称不能为空')
    const dao = getEnvDao()
    const proxyConfig =
      input.proxyConfig === undefined || input.proxyConfig === null
        ? null
        : validateProxyConfig(input.proxyConfig)
    let country: string | null = null
    if (proxyConfig) {
      try {
        country = (await testEgress(proxyConfig)).country
      } catch (e) {
        // T1 约定：测试失败允许保存，以直连基准生成指纹，错误码留给启动时再暴露
        getLogger().warn('envManager.create_proxy_test_failed', {
          code: (e as { code?: string }).code ?? 'INTERNAL',
          message: e instanceof Error ? e.message : String(e)
        })
      }
    }
    const record = createEnvWithDirs(dao, {
      name,
      remark: input.remark ?? '',
      group: input.group ?? '',
      shop: {
        site: input.shop?.site ?? 'UNKNOWN',
        shopIdentifier: input.shop?.shopIdentifier ?? '',
        roleNote: input.shop?.roleNote ?? ''
      },
      fingerprint: generateCoreFingerprint(country),
      alignFields: alignFieldsForCountry(country),
      proxyConfig
    })
    return toEnv(record)
  })

  // T2 env:update：名称/备注/代理（国家变更检测收敛到 env:start，见文档决策）
  defineIpc<EnvUpdateInput, Env>(IPC.envUpdate, (input) => {
    const changes: EnvChanges = {}
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) fail('VALIDATION', '环境名称不能为空')
      changes.name = name
    }
    if (input.remark !== undefined) changes.remark = input.remark
    if (input.group !== undefined) changes.group = input.group
    if (input.shop !== undefined) {
      const existing = getEnvDao().getEnv(input.id)
      if (!existing) fail('NOT_FOUND', `环境不存在: ${input.id}`)
      changes.shop = { ...existing.shop, ...input.shop }
    }
    if (input.proxyConfig !== undefined) {
      changes.proxyConfig =
        input.proxyConfig === null ? null : validateProxyConfig(input.proxyConfig)
    }
    const updated = getEnvDao().updateEnv(input.id, changes)
    if (!updated) fail('NOT_FOUND', `环境不存在: ${input.id}`)
    return toEnv(updated)
  })

  defineIpc<FingerprintUpdateInput, Env>(IPC.envUpdateFingerprint, (input) => {
    if (getStatus(input.id) !== 'idle') fail('ENV_RUNNING', '环境运行中，不能修改核心指纹')
    const error = coreFingerprintError(input.fingerprint)
    if (error) fail('VALIDATION', error)
    const updated = getEnvDao().updateFingerprint(input.id, input.fingerprint)
    if (!updated) fail('NOT_FOUND', `环境不存在: ${input.id}`)
    getLogger().info('envManager.fingerprint_updated', { id: input.id })
    return toEnv(updated)
  })

  // T3 align:confirm：确认 → 仅更新对齐字段（核心指纹只读由 DAO 断言兜底）；取消 → 保留
  defineIpc<AlignConfirmInput, { id: string }>(IPC.alignConfirm, (input) => {
    const country = pendingAlign.get(input.id)
    if (input.accept) {
      if (!country) fail('VALIDATION', '没有待确认的地区变更')
      getEnvDao().updateEnv(input.id, { alignFields: alignFieldsForCountry(country) })
      getLogger().info('envManager.align_confirmed', { id: input.id, country })
    }
    pendingAlign.delete(input.id)
    return { id: input.id }
  })

  // T4 env:start：launchEnv 内含内核→代理→注入全流水线；lastLaunchedAt 已落库
  defineIpc<IdInput, CountryChangeInfo | null>(IPC.envStart, async (input) => {
    const st = getStatus(input.id)
    if (st !== 'idle') fail('ENV_NOT_IDLE', `环境非空闲，无法启动（当前: ${st}）`)
    const res = await launchEnv(input.id)
    if (res.countryChanged) {
      pendingAlign.set(input.id, res.countryChanged.to ?? '')
    }
    return res.countryChanged
  })

  // T4 env:stop
  defineIpc<IdInput, { id: string }>(IPC.envStop, async (input) => {
    await stopEnv(input.id)
    return { id: input.id }
  })

  // T5 env:delete：运行中拒绝；否则 DB + 目录全删
  defineIpc<IdInput, { id: string }>(IPC.envDelete, (input) => {
    const st = getStatus(input.id)
    if (st !== 'idle') fail('ENV_RUNNING', `环境运行中（${st}），请先停止再删除`)
    deleteEnvWithDirs(getEnvDao(), input.id)
    return { id: input.id }
  })

  // T7 env:status：内存状态表（UI 首屏来源）
  defineIpc(IPC.envStatus, () => getStatusMap())
}

function registerAppChannels(): void {
  // T9 app:notices：启动期通知，读后清空
  defineIpc(IPC.appNotices, (): StartupNotice[] => drainNotices())

  // T8 app:wipeData：彻底清除数据（停环境 → 删 db+envs → 重建空库）
  defineIpc(IPC.appWipeData, () => wipeAllData())

  defineIpc(IPC.envExport, () => exportEnvs())
  defineIpc(IPC.envImport, () => importEnvs())
  defineIpc(IPC.appLogs, () => {
    const lines: string[] = []
    for (const file of ['main.4.log', 'main.3.log', 'main.2.log', 'main.1.log', 'main.log']) {
      try {
        lines.push(...readFileSync(join(logsDir(), file), 'utf8').trim().split('\n'))
      } catch {
        // 缺失的轮换文件属正常状态
      }
    }
    return { lines: lines.filter(Boolean).slice(-300) }
  })
}

/** 集成入口：src/main/index.ts 在 registerIpc() 之前调用一次 */
export function registerEnvManagerIpc(): void {
  registerEnvChannels()
  registerAppChannels()
}

/** 供 index.ts 在 setupStorage 后注入启动期通知 */
export { pushNotice }
