/**
 * 环境运行状态表（06-T1）
 *
 * 状态只存内存，不落库（需求文档 §5）：应用启动时全部置 idle，
 * 崩溃后残留状态自然消失。任何变化经 env:status-changed 广播。
 */
import { broadcast } from '../ipc'
import { IPC } from '../../shared/types'
import type { EnvStatus, EnvStatusMap } from '../../shared/types'

const statuses = new Map<string, EnvStatus>()

/** 应用启动时以 DB 环境清单初始化（全部 idle） */
export function initStatuses(ids: string[]): void {
  statuses.clear()
  for (const id of ids) statuses.set(id, 'idle')
  push()
}

export function getStatus(id: string): EnvStatus {
  return statuses.get(id) ?? 'idle'
}

export function getStatusMap(): EnvStatusMap {
  return Object.fromEntries(statuses)
}

export function getRunningIds(): string[] {
  return [...statuses.entries()].filter(([, s]) => s === 'running').map(([id]) => id)
}

/** 变更状态并广播；状态无变化时不重复推送 */
export function setStatus(id: string, status: EnvStatus): void {
  if (statuses.get(id) === status) return
  statuses.set(id, status)
  push()
}

function push(): void {
  broadcast(IPC.envStatusChanged, getStatusMap())
}
