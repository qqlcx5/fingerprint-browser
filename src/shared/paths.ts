/**
 * 存储路径唯一入口（需求文档 §5）。主进程专用，渲染进程禁止 import。
 * 只做路径解析；目录创建/清理由 02-storage 负责。
 */
import { app } from 'electron'
import { join } from 'path'

/** 应用数据根目录：app.getPath('userData') */
export function dataRoot(): string {
  return app.getPath('userData')
}

/** SQLite 数据库文件：userData/data/envs.db */
export function dbFile(): string {
  return join(dataRoot(), 'data', 'envs.db')
}

/** 环境浏览器数据目录（Chromium userDataDir）：userData/envs/{id}/profile */
export function envProfileDir(id: string): string {
  return join(dataRoot(), 'envs', id, 'profile')
}

/** 环境下载目录（默认隔离，防多环境互串）：userData/envs/{id}/downloads */
export function envDownloadsDir(id: string): string {
  return join(dataRoot(), 'envs', id, 'downloads')
}

/** 内核根目录：userData/chromium/ */
export function chromiumRoot(): string {
  return join(dataRoot(), 'chromium')
}

/** 内核目录：userData/chromium/{revision}/ */
export function chromiumDir(revision: string): string {
  return join(chromiumRoot(), revision)
}

/** 日志目录：userData/logs/ */
export function logsDir(): string {
  return join(dataRoot(), 'logs')
}
