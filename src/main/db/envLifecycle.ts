/**
 * 环境目录生命周期（02-T5，需求文档 §5 / §6.1）
 *
 * 组装 DB 记录与 envs/{id} 目录的完整流程，供 07 在 IPC 层调用：
 * - 创建：先落库拿 id，再建 profile + downloads 目录；建目录失败回滚删除记录，
 *   不留"无目录环境"
 * - 删除：先删记录（必须成功），再幂等删目录；目录删除失败仅记日志不抛出，
 *   不阻塞记录删除（残留目录可手动清理，下次 app:wipeData 也会覆盖）
 *
 * id 来自渲染层输入，进入任何文件操作前必须通过 UUID 校验，防路径穿越。
 */
import { mkdirSync, rmSync } from 'fs'
import { dirname } from 'path'
import { envDownloadsDir, envProfileDir } from '../../shared/paths'
import type { EnvDao, EnvDraft, EnvRecord } from './envDao'
import { getLogger } from './logger'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 校验环境 id 为标准 UUID v4 形态；非法直接抛错（防目录穿越/误删） */
export function assertSafeEnvId(id: string): void {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new Error(`ENV_ID_INVALID: 非法环境 id`)
  }
}

/** 创建环境完整流程：落库 → 建 profile/downloads 目录（失败回滚记录） */
export function createEnvWithDirs(dao: EnvDao, draft: EnvDraft): EnvRecord {
  const record = dao.createEnv(draft)
  try {
    mkdirSync(envProfileDir(record.id), { recursive: true })
    mkdirSync(envDownloadsDir(record.id), { recursive: true })
  } catch (err) {
    getLogger().error('env.dirs.create-failed', {
      id: record.id,
      reason: err instanceof Error ? err.message : String(err)
    })
    try {
      dao.deleteEnv(record.id)
    } catch {
      // 回滚失败不掩盖原始错误
    }
    throw err
  }
  getLogger().info('env.created', { id: record.id })
  return record
}

/** 删除环境完整流程：删记录 → 连目录一起删（幂等，失败仅记日志） */
export function deleteEnvWithDirs(dao: EnvDao, id: string): boolean {
  assertSafeEnvId(id)
  const existed = dao.deleteEnv(id)
  try {
    // envs/{id} 下只有 profile 与 downloads，整目录递归删除即"连目录一起删"；
    // force:true 使目录不存在时也不报错 → 幂等
    rmSync(dirname(envProfileDir(id)), { recursive: true, force: true })
  } catch (err) {
    getLogger().error('env.dirs.delete-failed', {
      id,
      reason: err instanceof Error ? err.message : String(err)
    })
  }
  if (existed) {
    getLogger().info('env.deleted', { id })
  }
  return existed
}
