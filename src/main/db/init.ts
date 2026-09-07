/**
 * SQLite 打开、建表与损坏自愈（02-T2，需求文档 §5 / §9）
 *
 * 损坏处理：打开或 quick_check 失败 → 原库备份为 envs.db.bak（连同清理
 * WAL/SHM 边车）→ 重建空库，返回 reset:true（交界面提示"环境列表为空属预期"）。
 * 注意 migrate（建表）失败属于程序缺陷而非库损坏，直接抛出不触发重建，
 * 避免健康数据被误清。
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { dirname } from 'path'
import { dbFile } from '../../shared/paths'
import { getLogger } from './logger'

export interface DbOpenResult {
  db: Database.Database
  /** true = 检测到损坏库，已备份 .bak 并重建空库（§9，界面需提示） */
  reset: boolean
}

/** 打开（必要时自愈重建）数据库。app ready 后调用一次 */
export function openDatabase(): DbOpenResult {
  const file = dbFile()
  mkdirSync(dirname(file), { recursive: true })

  if (existsSync(file)) {
    let db: Database.Database | null = null
    try {
      db = openDb(file)
      verifyIntegrity(db)
    } catch (err) {
      db?.close()
      backupCorrupt(file)
      getLogger().error('db.corrupt.rebuilt', {
        file,
        reason: err instanceof Error ? err.message : String(err),
        backup: `${file}.bak`
      })
      const rebuilt = openDb(file)
      migrate(rebuilt)
      return { db: rebuilt, reset: true }
    }
    migrate(db)
    return { db, reset: false }
  }

  const db = openDb(file)
  migrate(db)
  return { db, reset: false }
}

function openDb(file: string): Database.Database {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  return db
}

function verifyIntegrity(db: Database.Database): void {
  const rows = db.pragma('quick_check(1)') as Array<{ quick_check?: string }>
  const verdict = rows[0]?.quick_check?.toLowerCase()
  if (verdict !== 'ok') {
    throw new Error(`SQLite quick_check 未通过: ${verdict ?? '无结果'}`)
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS environments (
    id                TEXT PRIMARY KEY NOT NULL,
    name              TEXT NOT NULL,
    remark            TEXT NOT NULL DEFAULT '',
    fingerprint       TEXT NOT NULL,
    align_fields      TEXT NOT NULL,
    proxy_config      TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    last_launched_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_environments_created_at ON environments (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_environments_updated_at ON environments (updated_at DESC);
`

function migrate(db: Database.Database): void {
  db.exec(SCHEMA)
}

/** 把损坏库移走：先清 WAL/SHM 边车，主文件改名为 .bak；备份失败也必须移走原文件保应用可用 */
function backupCorrupt(file: string): void {
  for (const suffix of ['-wal', '-shm']) {
    rmSync(`${file}${suffix}`, { force: true })
  }
  const backup = `${file}.bak`
  try {
    rmSync(backup, { force: true })
    renameSync(file, backup)
  } catch {
    rmSync(file, { force: true })
  }
}
