/**
 * 全局 toast 单例 + §9 错误矩阵文案映射（08-T4）
 */
import { reactive } from 'vue'
import type { AppError, AppErrorCode } from '@shared/types'

export interface ToastItem {
  id: number
  kind: 'error' | 'info' | 'success'
  text: string
}

export const toasts = reactive<ToastItem[]>([])
let seq = 0

export function pushToast(kind: ToastItem['kind'], text: string, ttlMs = 5000): void {
  const id = ++seq
  toasts.push({ id, kind, text })
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, ttlMs)
}

/** §9 错误矩阵：code → 用户可见文案；缺映射给兜底 */
const CODE_TEXT: Record<AppErrorCode, string> = {
  VALIDATION: '输入不合法，请检查表单',
  NOT_FOUND: '环境不存在，可能已被删除',
  ENV_RUNNING: '环境运行中，请先停止',
  ENV_NOT_IDLE: '环境非空闲，无法启动',
  KERNEL_MISSING: '浏览器内核缺失，需要先下载',
  KERNEL_CORRUPT: '浏览器内核损坏，请重新下载',
  KERNEL_DOWNLOAD_FAILED: '内核下载失败，请检查网络后重试',
  DISK_FULL: '磁盘空间不足，请清理后重试',
  PROXY_AUTH: '代理账号或密码错误',
  PROXY_TIMEOUT: '代理连接超时，请检查代理服务商',
  PROXY_DNS: '代理域名解析失败，请检查代理地址',
  PROXY_PROTOCOL: '代理协议错误，请检查代理类型',
  COUNTRY_CHANGED: '代理出口地区已变化，需要确认',
  DB_CORRUPT: '本地数据库曾损坏，已自动重建（环境列表为空属预期）',
  NOT_IMPLEMENTED: '功能尚未完成',
  INTERNAL: '发生未知错误'
}

export function errorText(e: AppError): string {
  const base = CODE_TEXT[e.code] ?? `发生未知错误（${e.code}）`
  return e.message && e.code === 'VALIDATION' ? `${base}：${e.message}` : base
}

/** Result 信封快捷处理：失败弹 toast，成功返回 data */
export async function unwrap<T>(
  p: Promise<{ ok: true; data: T } | { ok: false; error: AppError }>
): Promise<T | null> {
  const res = await p
  if (res.ok) return res.data
  pushToast('error', errorText(res.error))
  return null
}
