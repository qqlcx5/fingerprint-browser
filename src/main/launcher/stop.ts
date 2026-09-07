/**
 * 环境停止（06-T3）：优雅 close，5s 超时按 profile 目录强杀进程树。
 * 强杀复用 orphan.ts 的按路径匹配进程能力（Windows taskkill /T 连带子进程）。
 */
import type { BrowserContext } from 'playwright-core'
import { getLogger } from '../db'
import { killByProfileDir } from './orphan'
import { setStatus } from './status'
import { getContext } from './launch'

const STOP_TIMEOUT_MS = 5_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])
}

export async function stopEnv(id: string): Promise<void> {
  const context: BrowserContext | undefined = getContext(id)
  if (!context) {
    setStatus(id, 'idle')
    return
  }
  setStatus(id, 'stopping')
  try {
    const result = await withTimeout(context.close(), STOP_TIMEOUT_MS)
    if (result === 'timeout') {
      getLogger().warn('launcher.stop_timeout_kill', { id })
      await killByProfileDir(id)
    }
  } catch (e) {
    // close 抛错（进程已死等）：确保目录级进程清理后状态归位
    getLogger().warn('launcher.stop_error', {
      id,
      message: e instanceof Error ? e.message : String(e)
    })
    await killByProfileDir(id)
  } finally {
    // 'close' 事件钩子会推 idle；此处兜底（进程已死但事件未触发的边界）
    setStatus(id, 'idle')
  }
}

/** 应用退出钩子（06-T7）：逐个优雅停止全部运行中环境，单个超时强杀 */
export async function stopAllRunning(): Promise<void> {
  const { getRunningIds } = await import('./status')
  const ids = getRunningIds()
  await Promise.all(ids.map((id) => stopEnv(id)))
}
