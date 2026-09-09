/**
 * 存储层公共出口（02-storage 汇总）
 *
 * 接线方式（集成阶段写入 src/main/index.ts）：
 *   app.whenReady 内、registerIpc() 之前：
 *     const storage = setupStorage()
 *     若 storage.reset === true → 通知渲染层提示"数据库已重置，环境列表为空属预期"（§9，08-T8）
 *   before-quit 时调用 closeStorage()（在 06-T7 逐环境停止之后）
 *
 * 07-envManager 经 getEnvDao() 取 DAO；各模块经 getLogger() 写日志。
 */
import type Database from 'better-sqlite3'
import { openDatabase } from './init'
import { createEnvDao, type EnvDao } from './envDao'
import { initLogger, type Logger } from './logger'

export { createEnvDao, toPublicBinding, toPublicProxy } from './envDao'
export type {
  EnvDao,
  EnvDraft,
  EnvChanges,
  EnvRecord,
  StoredProxyBinding,
  StoredProxyConfig
} from './envDao'
export { createEnvWithDirs, deleteEnvWithDirs, assertSafeEnvId } from './envLifecycle'
export { getLogger, initLogger } from './logger'
export type { Logger, LogLevel } from './logger'
export { openDatabase } from './init'

export interface StorageHandle {
  dao: EnvDao
  logger: Logger
  /** true = 损坏库已备份 .bak 并重建空库（§9，需界面提示） */
  reset: boolean
}

let db: Database.Database | null = null
let dao: EnvDao | null = null

/** 初始化存储层：日志 → SQLite（含损坏自愈）→ DAO。app ready 后调用一次 */
export function setupStorage(): StorageHandle {
  const logger = initLogger()
  const opened = openDatabase()
  db = opened.db
  dao = createEnvDao(opened.db)
  logger.info('storage.ready', { reset: opened.reset })
  return { dao, logger, reset: opened.reset }
}

/** 取全局 DAO；未初始化说明接线缺失，直接抛错暴露问题 */
export function getEnvDao(): EnvDao {
  if (!dao) {
    throw new Error('STORAGE_NOT_READY: 请先在 app ready 后调用 setupStorage()')
  }
  return dao
}

/** 关闭数据库（WAL checkpoint 落盘）；before-quit 时调用 */
export function closeStorage(): void {
  db?.close()
  db = null
  dao = null
}
