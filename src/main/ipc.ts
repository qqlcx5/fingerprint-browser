/**
 * 主进程统一 IPC 框架（冻结文件，见 doc/tasks/parallel-plan.md §3）
 *
 * 约定：
 * - 各业务模块用 defineIpc() 注册自己的通道处理器（在各自模块目录内）
 * - src/main/index.ts 在 app ready 后调用 registerIpc() 统一接线
 * - 处理器抛错（推荐用 fail()）→ 统一转为 { ok:false, error } 信封
 * - 未接线的通道注册 NOT_IMPLEMENTED 占位，渲染层可安全调用
 */
import { BrowserWindow, ipcMain } from 'electron'
import {
  INVOKE_CHANNELS,
  type AppError,
  type AppErrorCode,
  type EventChannel,
  type IpcChannel,
  type Result
} from '../shared/types'

type IpcHandler = (payload: unknown) => unknown | Promise<unknown>

const handlers = new Map<IpcChannel, IpcHandler>()

/** 构造业务错误（模块内部抛出用） */
export function appError(code: AppErrorCode, message: string): AppError {
  return { code, message }
}

/** 在处理器中抛出带 code 的业务错误 */
export function fail(code: AppErrorCode, message: string): never {
  const e = new Error(message) as Error & { code: AppErrorCode }
  e.code = code
  throw e
}

/** 任意异常 → AppError（带 code 的业务错误原样保留） */
export function toAppError(e: unknown): AppError {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const { code, message } = e as { code: AppErrorCode; message: string }
    return { code, message }
  }
  return { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e) }
}

/** 模块注册 invoke 处理器；重复注册视为接线错误，立即失败 */
export function defineIpc<TPayload, TData>(
  channel: IpcChannel,
  handler: (payload: TPayload) => TData | Promise<TData>
): void {
  if (handlers.has(channel)) {
    throw new Error(`IPC 通道重复注册: ${channel}`)
  }
  handlers.set(channel, handler as IpcHandler)
}

/**
 * 应用启动时调用一次：为全部 invoke 通道注册 handler。
 * 已定义的走业务处理器；未定义的返回 NOT_IMPLEMENTED 占位信封。
 */
export function registerIpc(): void {
  for (const channel of INVOKE_CHANNELS) {
    const handler = handlers.get(channel)
    if (handler) {
      ipcMain.handle(channel, async (_event, payload): Promise<Result<unknown>> => {
        try {
          return { ok: true, data: await handler(payload) }
        } catch (e) {
          return { ok: false, error: toAppError(e) }
        }
      })
    } else {
      ipcMain.handle(channel, (): Result<never> => ({
        ok: false,
        error: appError('NOT_IMPLEMENTED', `通道 ${channel} 尚未接线（对应模块未完成）`)
      }))
    }
  }
}

/** 主进程 → 渲染层事件广播（状态变化、下载进度等） */
export function broadcast(channel: EventChannel, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}
