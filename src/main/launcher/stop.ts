/**
 * 环境停止（06-T3）：优雅 close，5s 超时按 profile 目录强杀进程树。
 * 强杀复用 orphan.ts 的按路径匹配进程能力（Windows taskkill /T 连带子进程）。
 */
import type { BrowserContext } from 'playwright-core'
import { getLogger } from '../db'
import { killByProfileDir } from './orphan'
import { getContext, cancelLaunch } from './launch'
import { getActiveEnvIds, setStatus } from './status'

const STOP_TIMEOUT_MS = 5_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])
}

export async function stopEnv(id: string): Promise<void> {
  // 启动中的内核下载/代理测连不能直接中断；取消令牌确保其后续不会再创建 Chromium。
  cancelLaunch(id)
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

/** 应用退出与清空数据：逐个停止全部活动环境（含 starting / stopping）。 */
export async function stopAllRunning(): Promise<void> {
  await Promise.all(getActiveEnvIds().map((id) => stopEnv(id)))
}
