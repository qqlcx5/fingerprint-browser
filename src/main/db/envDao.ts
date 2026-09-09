import { randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import type {
  AlignFields,
  ProxyBinding,
  ProxyConfig,
  PublicProxyConfig,
  ReadonlyCoreFingerprint,
  SecurityStatus,
  ShopMetadata
} from '../../shared/types'

export const DEFAULT_SHOP: ShopMetadata = {
  site: 'UNKNOWN',
  shopIdentifier: '',
  roleNote: ''
}

export const DEFAULT_SECURITY_STATUS: SecurityStatus = {
  twoStepVerification: 'unknown',
  verificationMethodCount: 0,
  phoneLinked: 'unknown',
  loginAlertsEnabled: 'unknown',
  unknownDevicesReviewedAt: null,
  lastSecurityCheckedAt: null,
  reVerificationRequired: false
}

/** 主进程运行时使用明文密码；落库前由 sealProxy 加密。 */
export interface StoredProxyConfig extends ProxyConfig {}

export interface StoredProxyBinding extends Omit<ProxyBinding, 'config'> {
  config: StoredProxyConfig
}

export interface EnvRecord {
  id: string
  name: string
  remark: string
  group: string
  shop: ShopMetadata
  fingerprint: ReadonlyCoreFingerprint
  alignFields: AlignFields
  /** 旧环境兼容字段。新业务环境必须使用 proxyBinding。 */
  proxyConfig: StoredProxyConfig | null
  proxyBinding: StoredProxyBinding | null
  securityStatus: SecurityStatus
  /** 仅为系统安全存储的引用，绝不是 TOTP 密钥。 */
  totpSecretRef: string | null
  createdAt: number
  updatedAt: number
  lastLaunchedAt: number | null
}

export interface EnvDraft {
  name: string
  remark: string
  group?: string
  shop?: ShopMetadata
  fingerprint: ReadonlyCoreFingerprint
  alignFields: AlignFields
  /** V2 首选字段。写入前必须已完成出口验证。 */
  proxyBinding?: StoredProxyBinding | null
  /** 旧导入兼容字段，后续应重绑定为 proxyBinding。 */
  proxyConfig?: ProxyConfig | null
  securityStatus?: SecurityStatus
  totpSecretRef?: string | null
}

export interface EnvChanges {
  name?: string
  remark?: string
  group?: string
  shop?: ShopMetadata
  proxyConfig?: ProxyConfig | null
  proxyBinding?: StoredProxyBinding | null
  securityStatus?: SecurityStatus
  totpSecretRef?: string | null
  alignFields?: AlignFields
  lastLaunchedAt?: number | null
}

export interface EnvDao {
  createEnv(draft: EnvDraft): EnvRecord
  getEnv(id: string): EnvRecord | null
  listEnvs(): EnvRecord[]
  updateEnv(id: string, changes: EnvChanges): EnvRecord | null
  updateFingerprint(id: string, fingerprint: ReadonlyCoreFingerprint): EnvRecord | null
  deleteEnv(id: string): boolean
  /** 用于代理导入预检和绑定前冲突检测。 */
  getEnvIdByEgressIp(ip: string, excludeEnvId?: string): string | null
}

interface EnvRow {
  id: string
  name: string
  remark: string
  group_name: string
  fingerprint: string
  align_fields: string
  proxy_config: string | null
  proxy_binding: string | null
  site: string | null
  shop_identifier: string | null
  role_note: string | null
  security_status: string | null
  totp_secret_ref: string | null
  created_at: number
  updated_at: number
  last_launched_at: number | null
}

export function createEnvDao(db: Database.Database): EnvDao {
  const insert = db.prepare(
    `INSERT INTO environments
       (id, name, remark, group_name, fingerprint, align_fields, proxy_config, proxy_binding,
        expected_egress_ip, site, shop_identifier, role_note, security_status, totp_secret_ref,
        created_at, updated_at, last_launched_at)
     VALUES
       (@id, @name, @remark, @group_name, @fingerprint, @align_fields, @proxy_config, @proxy_binding,
        @expected_egress_ip, @site, @shop_identifier, @role_note, @security_status, @totp_secret_ref,
        @created_at, @updated_at, @last_launched_at)`
  )
  const selectById = db.prepare('SELECT * FROM environments WHERE id = ?')
  const selectAll = db.prepare('SELECT * FROM environments ORDER BY created_at DESC, id DESC')
  const deleteById = db.prepare('DELETE FROM environments WHERE id = ?')
  const selectByEgressIp = db.prepare(
    `SELECT id FROM environments WHERE expected_egress_ip = ? LIMIT 1`
  )

  function createEnv(draft: EnvDraft): EnvRecord {
    if (typeof draft.name !== 'string' || draft.name.trim() === '') {
      throw new Error('ENV_NAME_REQUIRED: 环境名称不能为空')
    }
    const now = Date.now()
    const record: EnvRecord = {
      id: randomUUID(),
      name: draft.name.trim(),
      remark: draft.remark ?? '',
      group: draft.group?.trim() ?? '',
      shop: normalizeShop(draft.shop),
      fingerprint: draft.fingerprint,
      alignFields: draft.alignFields,
      proxyConfig: draft.proxyConfig ? { ...draft.proxyConfig } : null,
      proxyBinding: draft.proxyBinding
        ? { ...draft.proxyBinding, config: { ...draft.proxyBinding.config } }
        : null,
      securityStatus: normalizeSecurityStatus(draft.securityStatus),
      totpSecretRef: draft.totpSecretRef ?? null,
      createdAt: now,
      updatedAt: now,
      lastLaunchedAt: null
    }
    insert.run(recordToRow(record))
    return record
  }

  function getEnv(id: string): EnvRecord | null {
    const row = selectById.get(id) as EnvRow | undefined
    return row ? rowToRecord(row) : null
  }

  function listEnvs(): EnvRecord[] {
    return (selectAll.all() as EnvRow[]).map(rowToRecord)
  }

  function updateEnv(id: string, changes: EnvChanges): EnvRecord | null {
    if (changes !== null && typeof changes === 'object' && 'fingerprint' in changes) {
      throw new Error('FINGERPRINT_READONLY: 核心指纹只读，禁止更新')
    }
    const sets: string[] = []
    const values: unknown[] = []
    if (changes.name !== undefined) {
      sets.push('name = ?')
      values.push(changes.name.trim())
    }
    if (changes.remark !== undefined) {
      sets.push('remark = ?')
      values.push(changes.remark)
    }
    if (changes.group !== undefined) {
      sets.push('group_name = ?')
      values.push(changes.group.trim())
    }
    if (changes.shop !== undefined) {
      const shop = normalizeShop(changes.shop)
      sets.push('site = ?', 'shop_identifier = ?', 'role_note = ?')
      values.push(shop.site, shop.shopIdentifier, shop.roleNote)
    }
    if (changes.proxyConfig !== undefined) {
      sets.push('proxy_config = ?')
      values.push(changes.proxyConfig ? JSON.stringify(sealProxy(changes.proxyConfig)) : null)
    }
    if (changes.proxyBinding !== undefined) {
      const binding = changes.proxyBinding
      sets.push('proxy_binding = ?', 'expected_egress_ip = ?')
      values.push(
        binding ? JSON.stringify(sealBinding(binding)) : null,
        binding?.expectedEgressIp ?? null
      )
    }
    if (changes.securityStatus !== undefined) {
      sets.push('security_status = ?')
      values.push(JSON.stringify(normalizeSecurityStatus(changes.securityStatus)))
    }
    if (changes.totpSecretRef !== undefined) {
      sets.push('totp_secret_ref = ?')
      values.push(changes.totpSecretRef)
    }
    if (changes.alignFields !== undefined) {
      sets.push('align_fields = ?')
      values.push(JSON.stringify(changes.alignFields))
    }
    if (changes.lastLaunchedAt !== undefined) {
      sets.push('last_launched_at = ?')
      values.push(changes.lastLaunchedAt)
    }
    if (sets.length === 0) return getEnv(id)
    sets.push('updated_at = ?')
    values.push(Date.now(), id)
    db.prepare(`UPDATE environments SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return getEnv(id)
  }

  function updateFingerprint(id: string, fingerprint: ReadonlyCoreFingerprint): EnvRecord | null {
    db.prepare('UPDATE environments SET fingerprint = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(fingerprint),
      Date.now(),
      id
    )
    return getEnv(id)
  }

  function deleteEnv(id: string): boolean {
    return deleteById.run(id).changes > 0
  }

  function getEnvIdByEgressIp(ip: string, excludeEnvId?: string): string | null {
    const row = selectByEgressIp.get(ip) as { id?: string } | undefined
    if (!row?.id || row.id === excludeEnvId) return null
    return row.id
  }

  return {
    createEnv,
    getEnv,
    listEnvs,
    updateEnv,
    updateFingerprint,
    deleteEnv,
    getEnvIdByEgressIp
  }
}

function normalizeShop(shop: ShopMetadata | undefined): ShopMetadata {
  return {
    site: shop?.site?.trim() || DEFAULT_SHOP.site,
    shopIdentifier: shop?.shopIdentifier?.trim() || '',
    roleNote: shop?.roleNote?.trim() || ''
  }
}

function normalizeSecurityStatus(status: SecurityStatus | undefined): SecurityStatus {
  return { ...DEFAULT_SECURITY_STATUS, ...(status ?? {}) }
}

/** proxy_config 的旧记录可为明文；新写入均使用 Electron safeStorage。 */
function sealProxy(config: ProxyConfig): ProxyConfig {
  if (!config.password) return { ...config }
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('操作系统安全存储不可用，不能保存代理密码'), {
      code: 'SECURE_STORAGE_UNAVAILABLE'
    })
  }
  return {
    ...config,
    password: `enc:${safeStorage.encryptString(config.password).toString('base64')}`
  }
}

function unsealProxy(config: ProxyConfig): ProxyConfig {
  if (!config.password?.startsWith('enc:')) return { ...config }
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('操作系统安全存储不可用，无法读取代理密码'), {
      code: 'SECURE_STORAGE_UNAVAILABLE'
    })
  }
  return {
    ...config,
    password: safeStorage.decryptString(Buffer.from(config.password.slice(4), 'base64'))
  }
}

function sealBinding(binding: StoredProxyBinding): StoredProxyBinding {
  return { ...binding, config: sealProxy(binding.config) }
}

function unsealBinding(binding: StoredProxyBinding): StoredProxyBinding {
  return { ...binding, config: unsealProxy(binding.config) }
}

function recordToRow(record: EnvRecord): Record<string, unknown> {
  const binding = record.proxyBinding ? sealBinding(record.proxyBinding) : null
  return {
    id: record.id,
    name: record.name,
    remark: record.remark,
    group_name: record.group,
    fingerprint: JSON.stringify(record.fingerprint),
    align_fields: JSON.stringify(record.alignFields),
    proxy_config: record.proxyConfig ? JSON.stringify(sealProxy(record.proxyConfig)) : null,
    proxy_binding: binding ? JSON.stringify(binding) : null,
    expected_egress_ip: binding?.expectedEgressIp ?? null,
    site: record.shop.site,
    shop_identifier: record.shop.shopIdentifier,
    role_note: record.shop.roleNote,
    security_status: JSON.stringify(record.securityStatus),
    totp_secret_ref: record.totpSecretRef,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_launched_at: record.lastLaunchedAt
  }
}

function parseJson(text: string, field: string, id: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`ENV_FIELD_CORRUPT: 环境 ${id} 的 ${field} 字段无法解析`)
  }
}

function rowToRecord(row: EnvRow): EnvRecord {
  const legacy = row.proxy_config
    ? unsealProxy(parseJson(row.proxy_config, 'proxy_config', row.id) as ProxyConfig)
    : null
  const binding = row.proxy_binding
    ? unsealBinding(parseJson(row.proxy_binding, 'proxy_binding', row.id) as StoredProxyBinding)
    : null
  return {
    id: row.id,
    name: row.name,
    remark: row.remark,
    group: row.group_name ?? '',
    shop: normalizeShop({
      site: row.site ?? DEFAULT_SHOP.site,
      shopIdentifier: row.shop_identifier ?? '',
      roleNote: row.role_note ?? ''
    }),
    fingerprint: parseJson(row.fingerprint, 'fingerprint', row.id) as ReadonlyCoreFingerprint,
    alignFields: parseJson(row.align_fields, 'align_fields', row.id) as AlignFields,
    proxyConfig: legacy,
    proxyBinding: binding,
    securityStatus: row.security_status
      ? normalizeSecurityStatus(
          parseJson(row.security_status, 'security_status', row.id) as SecurityStatus
        )
      : { ...DEFAULT_SECURITY_STATUS },
    totpSecretRef: row.totp_secret_ref ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLaunchedAt: row.last_launched_at ?? null
  }
}

export function toPublicProxy(stored: StoredProxyConfig | null): PublicProxyConfig | null {
  if (!stored) return null
  const { password: _password, ...config } = stored
  return { ...config, hasPassword: Boolean(_password) }
}

export function toPublicBinding(stored: StoredProxyBinding | null): ProxyBinding | null {
  if (!stored) return null
  return { ...stored, config: toPublicProxy(stored.config)! }
}
