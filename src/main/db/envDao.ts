/**
 * environments 表数据访问（02-T3，需求文档 §5）
 *
 * 纯数据库层：只动记录，不动 envs/{id}/ 目录（目录生命周期见 envLifecycle.ts，
 * 由 07 在 IPC 层组装）。运行状态不入库（§5，内存态归 06-launcher）。
 *
 * 核心指纹只读（§6.5 / 05-T3）：
 * - EnvChanges 类型不含 fingerprint 字段（类型级约束）
 * - updateEnv 运行时再断言一次，挡住绕过类型的 JS 调用
 */
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type {
  AlignFields,
  ProxyConfig,
  ProxyType,
  PublicProxyConfig,
  ReadonlyCoreFingerprint
} from '../../shared/types'
import { encryptSecret, decryptSecret, type SealedSecret } from './secret'

/** 入库形态：代理密码已加密，永不存明文（§8） */
export interface StoredProxyConfig {
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: SealedSecret
}

/** 出库形态：DB 记录的领域对象（指纹与对齐字段已反序列化） */
export interface EnvRecord {
  id: string
  name: string
  remark: string
  group: string
  fingerprint: ReadonlyCoreFingerprint
  alignFields: AlignFields
  proxyConfig: StoredProxyConfig | null
  createdAt: number
  updatedAt: number
  lastLaunchedAt: number | null
}

/** createEnv 入参：指纹与对齐字段由 05 生成、07 编排时传入 */
export interface EnvDraft {
  name: string
  remark: string
  group?: string
  fingerprint: ReadonlyCoreFingerprint
  alignFields: AlignFields
  proxyConfig?: ProxyConfig | null
}

/** updateEnv 入参：fingerprint 永不出现于此（§6.5 核心指纹只读） */
export interface EnvChanges {
  name?: string
  remark?: string
  group?: string
  /** 代理整体替换；null = 清除代理；undefined = 不变。密码在落库前加密 */
  proxyConfig?: ProxyConfig | null
  /** 仅 align:confirm 确认流（07-T3）可更新对齐字段 */
  alignFields?: AlignFields
  /** 仅 env:start 成功后（07-T4）更新 */
  lastLaunchedAt?: number | null
}

export interface EnvDao {
  createEnv(draft: EnvDraft): EnvRecord
  getEnv(id: string): EnvRecord | null
  /** 默认创建时间倒序（新环境在前） */
  listEnvs(): EnvRecord[]
  /** 返回更新后记录；id 不存在返回 null */
  updateEnv(id: string, changes: EnvChanges): EnvRecord | null
  /** 返回记录是否真的被删除 */
  deleteEnv(id: string): boolean
}

interface EnvRow {
  id: string
  name: string
  remark: string
  group_name: string
  fingerprint: string
  align_fields: string
  proxy_config: string | null
  created_at: number
  updated_at: number
  last_launched_at: number | null
}

export function createEnvDao(db: Database.Database): EnvDao {
  const insert = db.prepare(
    `INSERT INTO environments
       (id, name, remark, group_name, fingerprint, align_fields, proxy_config,
        created_at, updated_at, last_launched_at)
     VALUES
       (@id, @name, @remark, @group_name, @fingerprint, @align_fields, @proxy_config,
        @created_at, @updated_at, @last_launched_at)`
  )
  const selectById = db.prepare('SELECT * FROM environments WHERE id = ?')
  const selectAll = db.prepare('SELECT * FROM environments ORDER BY created_at DESC, id DESC')
  const deleteById = db.prepare('DELETE FROM environments WHERE id = ?')

  function createEnv(draft: EnvDraft): EnvRecord {
    if (typeof draft.name !== 'string' || draft.name.trim() === '') {
      throw new Error('ENV_NAME_REQUIRED: 环境名称不能为空')
    }
    const now = Date.now()
    const record: EnvRecord = {
      id: randomUUID(),
      name: draft.name,
      remark: draft.remark ?? '',
      group: draft.group?.trim() ?? '',
      fingerprint: draft.fingerprint,
      alignFields: draft.alignFields,
      proxyConfig: draft.proxyConfig ? sealProxy(draft.proxyConfig) : null,
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
    // §6.5 断言：核心指纹生成后只读，任何更新请求都不允许携带 fingerprint
    if (changes !== null && typeof changes === 'object' && 'fingerprint' in changes) {
      throw new Error('FINGERPRINT_READONLY: 核心指纹只读，禁止更新（§6.5）')
    }
    const sets: string[] = []
    const values: unknown[] = []
    if (changes.name !== undefined) {
      sets.push('name = ?')
      values.push(changes.name)
    }
    if (changes.remark !== undefined) {
      sets.push('remark = ?')
      values.push(changes.remark)
    }
    if (changes.group !== undefined) {
      sets.push('group_name = ?')
      values.push(changes.group.trim())
    }
    if (changes.proxyConfig !== undefined) {
      sets.push('proxy_config = ?')
      values.push(changes.proxyConfig ? JSON.stringify(sealProxy(changes.proxyConfig)) : null)
    }
    if (changes.alignFields !== undefined) {
      sets.push('align_fields = ?')
      values.push(JSON.stringify(changes.alignFields))
    }
    if (changes.lastLaunchedAt !== undefined) {
      sets.push('last_launched_at = ?')
      values.push(changes.lastLaunchedAt)
    }
    if (sets.length === 0) {
      return getEnv(id)
    }
    sets.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)
    db.prepare(`UPDATE environments SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return getEnv(id)
  }

  function deleteEnv(id: string): boolean {
    return deleteById.run(id).changes > 0
  }

  return { createEnv, getEnv, listEnvs, updateEnv, deleteEnv }
}

function sealProxy(config: ProxyConfig): StoredProxyConfig {
  const stored: StoredProxyConfig = {
    type: config.type,
    host: config.host,
    port: config.port,
    ...(config.username !== undefined ? { username: config.username } : {})
  }
  if (config.password) {
    stored.password = encryptSecret(config.password)
  }
  return stored
}

function recordToRow(record: EnvRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name,
    remark: record.remark,
    group_name: record.group,
    fingerprint: JSON.stringify(record.fingerprint),
    align_fields: JSON.stringify(record.alignFields),
    proxy_config: record.proxyConfig ? JSON.stringify(record.proxyConfig) : null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_launched_at: record.lastLaunchedAt
  }
}

function parseJson(text: string, field: string, id: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`ENV_FIELD_CORRUPT: 环境 ${id} 的 ${field} 字段无法解析，可能被外部改动`)
  }
}

function rowToRecord(row: EnvRow): EnvRecord {
  const proxyConfig = row.proxy_config
    ? (parseJson(row.proxy_config, 'proxy_config', row.id) as StoredProxyConfig)
    : null
  return {
    id: row.id,
    name: row.name,
    remark: row.remark,
    group: row.group_name ?? '',
    fingerprint: parseJson(row.fingerprint, 'fingerprint', row.id) as ReadonlyCoreFingerprint,
    alignFields: parseJson(row.align_fields, 'align_fields', row.id) as AlignFields,
    proxyConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLaunchedAt: row.last_launched_at ?? null
  }
}

// ---------- 供 06/07 组装使用的转换（不经过 DAO 状态） ----------

/** 转渲染层可见形态：密码永不回传，仅带 hasPassword 标记（§8） */
export function toPublicProxy(stored: StoredProxyConfig | null): PublicProxyConfig | null {
  if (!stored) return null
  return {
    type: stored.type,
    host: stored.host,
    port: stored.port,
    ...(stored.username !== undefined ? { username: stored.username } : {}),
    hasPassword: Boolean(stored.password)
  }
}

/**
 * 解密代理密码，得到完整 ProxyConfig。
 * 明文仅限主进程内存（06 启动注入、07 代理测试使用）；禁止回传渲染层或写日志。
 */
export function decryptProxyConfig(stored: StoredProxyConfig): ProxyConfig {
  return {
    type: stored.type,
    host: stored.host,
    port: stored.port,
    ...(stored.username !== undefined ? { username: stored.username } : {}),
    ...(stored.password ? { password: decryptSecret(stored.password) } : {})
  }
}
