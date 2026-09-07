/**
 * 内核模块业务错误（03）
 *
 * 与 src/main/ipc.ts 的 fail() 同构：Error 实例携带 code，
 * registerIpc 的 toAppError 会原样保留 code 回传渲染层。
 * 单独建文件是为了让 kernel 子模块（locate/space/download）不依赖 electron。
 */
import type { AppErrorCode } from '../../shared/types'

export type KernelError = Error & { code: AppErrorCode }

export function kernelError(code: AppErrorCode, message: string): KernelError {
  const e = new Error(message) as KernelError
  e.code = code
  return e
}
