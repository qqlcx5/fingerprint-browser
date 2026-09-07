/**
 * 启动期一次性通知队列（07-T9）
 *
 * db_reset / weak_encryption 产生于 app ready 时，早于渲染层订阅，
 * 广播会丢，因此用拉取通道：渲染层挂载后 app:notices 取一次、读后清空。
 */
import type { NoticeKind, StartupNotice } from '../../shared/types'

const queue: StartupNotice[] = []

export function pushNotice(kind: NoticeKind, message: string): void {
  queue.push({ kind, message })
}

/** 读后清空 */
export function drainNotices(): StartupNotice[] {
  const out = [...queue]
  queue.length = 0
  return out
}
