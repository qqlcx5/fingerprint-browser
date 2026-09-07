/**
 * 内核模块装配（03-T4/T5）
 *
 * - browser:ensure：ready 直返；否则 磁盘预检 → 下载安装 → 复验（错误分类见 download.ts）
 * - browser:download-progress：下载进度节流广播到所有窗口
 *
 * 接线：src/main/index.ts 在 app ready 后调用 registerKernelIpc()（见 parallel-plan §2 规则 4）
 */
import { IPC } from '../../shared/types'
import type { DownloadProgress, KernelInfo } from '../../shared/types'
import { broadcast, defineIpc } from '../ipc'
import { kernelError } from './errors'
import { currentPlatform, locate, readChromiumDescriptor } from './locate'
import { chromiumRoot } from '../../shared/paths'
import { checkDiskSpace } from './space'
import { downloadAndInstall } from './download'

const PROGRESS_THROTTLE_MS = 100

let installing: Promise<KernelInfo> | null = null
let lastBroadcastAt = 0

function pushProgress(received: number, total: number): void {
  const now = Date.now()
  if (received !== total && now - lastBroadcastAt < PROGRESS_THROTTLE_MS) return
  lastBroadcastAt = now
  broadcast(IPC.browserDownloadProgress, { received, total } satisfies DownloadProgress)
}

/**
 * 内核就绪保证（browser:ensure 处理器）：
 * 并发去重——下载期间重复 invoke 复用同一 Promise，结果与进度广播共享。
 */
export async function ensureKernel(): Promise<KernelInfo> {
  const info = locate()
  if (info.ready) return info
  if (!installing) {
    installing = install().finally(() => {
      installing = null
    })
  }
  return installing
}

async function install(): Promise<KernelInfo> {
  const desc = readChromiumDescriptor()
  const pf = currentPlatform()
  await checkDiskSpace(chromiumRoot())
  pushProgress(0, 0)
  await downloadAndInstall(desc, pf, { onProgress: pushProgress })
  const after = locate()
  if (!after.ready) {
    throw kernelError('KERNEL_CORRUPT', '内核安装后校验未通过（可执行文件缺失）')
  }
  return after
}

/** 模块接线入口（由 src/main/index.ts 调用一次） */
export function registerKernelIpc(): void {
  defineIpc(IPC.browserEnsure, () => ensureKernel())
}
