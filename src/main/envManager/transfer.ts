import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import type {
  AlignFields,
  CoreFingerprint,
  EnvTransfer,
  ProxyConfig,
  PublicProxyConfig,
  SecurityStatus,
  ShopMetadata
} from '../../shared/types'
import {
  DEFAULT_SECURITY_STATUS,
  DEFAULT_SHOP,
  createEnvWithDirs,
  deleteEnvWithDirs,
  getEnvDao,
  toPublicProxy,
  type EnvRecord
} from '../db'
import { alignFieldsError, coreFingerprintError } from '../fingerprint'
import { validateProxyConfig } from '../proxy'

interface TransferEnvironment {
  name: string
  remark: string
  group: string
  shop: ShopMetadata
  fingerprint: CoreFingerprint
  alignFields: AlignFields
  proxyConfig: PublicProxyConfig | null
  securityStatus: SecurityStatus
}

interface NormalizedTransfer {
  version: 2
  environments: TransferEnvironment[]
}

function exportRecord(record: EnvRecord): EnvTransfer['environments'][number] {
  return {
    name: record.name,
    remark: record.remark,
    group: record.group,
    shop: record.shop,
    fingerprint: record.fingerprint,
    alignFields: record.alignFields,
    // 仅导出安全代理摘要；密码和已验证出口均不导出。
    proxyConfig: record.proxyConfig ? toPublicProxy(record.proxyConfig) : null,
    securityStatus: record.securityStatus
  }
}

/**
 * 接受 V1/V2 导出。V1 只补充 V2 的非敏感默认字段；无论版本均丢弃
 * 密码、出口绑定、TOTP 和任何未知敏感字段，导入后必须重新验证代理。
 */
function parseTransfer(text: string): NormalizedTransfer {
  const parsed = JSON.parse(text) as { version?: unknown; environments?: unknown }
  if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.environments)) {
    throw new Error('导入文件格式无效，仅支持 V1 或 V2 环境配置')
  }
  const environments = parsed.environments.map((raw, index) => normalizeEnvironment(raw, index + 1))
  return { version: 2, environments }
}

function normalizeEnvironment(raw: unknown, index: number): TransferEnvironment {
  if (!raw || typeof raw !== 'object') throw new Error(`导入文件第 ${index} 个环境无效`)
  const item = raw as Record<string, unknown>
  const name = stringField(item, 'name', index, true)
  const remark = stringField(item, 'remark', index)
  const group = stringField(item, 'group', index)
  const fingerprint = item.fingerprint as CoreFingerprint
  const alignFields = item.alignFields as AlignFields
  const fingerprintError = coreFingerprintError(fingerprint)
  const alignError = alignFieldsError(alignFields)
  if (fingerprintError || alignError) {
    throw new Error(`导入文件第 ${index} 个环境配置无效：${fingerprintError ?? alignError}`)
  }
  const rawShop = item.shop
  const shop: ShopMetadata =
    rawShop && typeof rawShop === 'object'
      ? {
          site: stringField(rawShop as Record<string, unknown>, 'site', index) || DEFAULT_SHOP.site,
          shopIdentifier: stringField(rawShop as Record<string, unknown>, 'shopIdentifier', index),
          roleNote: stringField(rawShop as Record<string, unknown>, 'roleNote', index)
        }
      : { ...DEFAULT_SHOP }
  const rawSecurity = item.securityStatus
  const securityStatus = normalizeSecurity(rawSecurity, index)
  const proxyConfig = item.proxyConfig ? normalizeProxy(item.proxyConfig, index) : null
  return { name, remark, group, shop, fingerprint, alignFields, proxyConfig, securityStatus }
}

function stringField(
  item: Record<string, unknown>,
  key: string,
  index: number,
  required = false
): string {
  const value = item[key]
  if (value === undefined || value === null) {
    if (required) throw new Error(`导入文件第 ${index} 个环境缺少 ${key}`)
    return ''
  }
  if (typeof value !== 'string') throw new Error(`导入文件第 ${index} 个环境的 ${key} 必须是字符串`)
  if (required && !value.trim()) throw new Error(`导入文件第 ${index} 个环境的 ${key} 不能为空`)
  return value.trim()
}

function normalizeSecurity(raw: unknown, index: number): SecurityStatus {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SECURITY_STATUS }
  const value = raw as Partial<SecurityStatus>
  if (
    !Number.isInteger(value.verificationMethodCount) ||
    (value.verificationMethodCount ?? 0) < 0
  ) {
    throw new Error(`导入文件第 ${index} 个环境的验证方式数量无效`)
  }
  return { ...DEFAULT_SECURITY_STATUS, ...value }
}

function normalizeProxy(raw: unknown, index: number): PublicProxyConfig {
  if (!raw || typeof raw !== 'object') throw new Error(`导入文件第 ${index} 个环境的代理无效`)
  const item = raw as Record<string, unknown>
  const config = validateProxyConfig({
    type: item.type,
    host: item.host,
    port: item.port,
    ...(typeof item.username === 'string' && item.username ? { username: item.username } : {})
    // 故意忽略旧导出中的 password：导入后必须重新填写。
  })
  return {
    type: config.type,
    host: config.host,
    port: config.port,
    username: config.username,
    hasPassword: false
  }
}

export async function exportEnvs(): Promise<{ count: number; path: string | null }> {
  const result = await dialog.showSaveDialog({
    title: '导出环境配置',
    defaultPath: 'fingerprint-browser-envs.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { count: 0, path: null }
  const transfer: EnvTransfer = {
    version: 2,
    environments: getEnvDao().listEnvs().map(exportRecord)
  }
  writeFileSync(result.filePath, `${JSON.stringify(transfer, null, 2)}\n`, 'utf8')
  return { count: transfer.environments.length, path: result.filePath }
}

export async function importEnvs(): Promise<{ count: number; path: string | null }> {
  const result = await dialog.showOpenDialog({
    title: '导入环境配置',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return { count: 0, path: null }
  const transfer = parseTransfer(readFileSync(filePath, 'utf8'))
  const dao = getEnvDao()
  const created: string[] = []
  try {
    for (const item of transfer.environments) {
      const proxyConfig = item.proxyConfig ? toImportProxy(item.proxyConfig) : null
      const record = createEnvWithDirs(dao, {
        name: item.name,
        remark: item.remark,
        group: item.group,
        shop: item.shop,
        fingerprint: item.fingerprint,
        alignFields: item.alignFields,
        proxyConfig,
        securityStatus: item.securityStatus
      })
      created.push(record.id)
    }
  } catch (error) {
    for (const id of created.reverse()) deleteEnvWithDirs(dao, id)
    throw error
  }
  return { count: created.length, path: filePath }
}

function toImportProxy(proxy: PublicProxyConfig): ProxyConfig {
  return {
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    ...(proxy.username ? { username: proxy.username } : {})
  }
}

export { parseTransfer }
