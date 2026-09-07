/**
 * 主进程唯一日志入口（02-T6，需求文档 §5：userData/logs/，滚动 5MB × 5 个文件）
 *
 * 约定：
 * - 所有模块经 getLogger() 写日志；禁止各自 fs.append 到别的文件
 * - 写入前对 password/secret/token/authorization 键脱敏——代理密码等明文永不落日志（§8，02-T4）
 * - 同步写：§9 的崩溃退出码等关键日志不能因进程退出而丢失
 * - 日志系统自身失败必须静默，不允许影响业务
 */
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { logsDir } from '../../shared/paths'

export type LogLevel = 'info' | 'warn' | 'error'

export interface Logger {
  info(event: string, detail?: unknown): void
  warn(event: string, detail?: unknown): void
  error(event: string, detail?: unknown): void
}

const MAX_BYTES = 5 * 1024 * 1024 // §5：单文件 5MB
const MAX_FILES = 5 // §5：main.log + main.1.log ~ main.4.log 共 5 个
const SECRET_KEY_RE = /password|secret|token|authorization/i
const SCRUB_DEPTH_LIMIT = 4

/** 递归脱敏对象中的敏感键；非对象原样返回 */
function scrub(value: unknown, depth: number): unknown {
  if (depth > SCRUB_DEPTH_LIMIT || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_RE.test(key) ? '***' : scrub(val, depth + 1)
  }
  return out
}

function renderDetail(detail: unknown): string {
  if (detail === undefined) return ''
  try {
    return ` ${JSON.stringify(scrub(detail, 0))}`
  } catch {
    return ` ${String(detail)}`
  }
}

class RollingLogger implements Logger {
  private readonly file: string

  constructor() {
    mkdirSync(logsDir(), { recursive: true })
    this.file = join(logsDir(), 'main.log')
  }

  info(event: string, detail?: unknown): void {
    this.write('info', event, detail)
  }

  warn(event: string, detail?: unknown): void {
    this.write('warn', event, detail)
  }

  error(event: string, detail?: unknown): void {
    this.write('error', event, detail)
  }

  private write(level: LogLevel, event: string, detail?: unknown): void {
    const line = `${new Date().toISOString()} [${level}] ${event}${renderDetail(detail)}\n`
    try {
      this.rollIfNeeded()
      appendFileSync(this.file, line, 'utf8')
    } catch {
      // 日志失败静默（磁盘满等场景业务仍需可用）
    }
  }

  /** 超过 5MB 时滚动：删除最旧一档，其余顺位后移，main.log → main.1.log */
  private rollIfNeeded(): void {
    let size: number
    try {
      size = statSync(this.file).size
    } catch {
      return // 文件还不存在，无需滚动
    }
    if (size < MAX_BYTES) return
    rmSync(this.rolled(MAX_FILES - 1), { force: true })
    for (let i = MAX_FILES - 1; i >= 2; i--) {
      try {
        renameSync(this.rolled(i - 1), this.rolled(i))
      } catch {
        // 中间档缺失不影响整体顺移
      }
    }
    try {
      renameSync(this.file, this.rolled(1))
    } catch {
      // 滚动失败则继续写原文件
    }
  }

  private rolled(index: number): string {
    return join(logsDir(), `main.${index}.log`)
  }
}

let current: Logger | null = null

/** 显式初始化（setupStorage 引导时调用一次） */
export function initLogger(): Logger {
  current = new RollingLogger()
  return current
}

/** 获取全局日志器；未初始化时自动创建（单例） */
export function getLogger(): Logger {
  return current ?? initLogger()
}
