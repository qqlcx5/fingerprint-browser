/**
 * 磁盘空间预检（03-T2）
 *
 * 需求文档 §6.2：下载前检查磁盘剩余空间 ≥ 2GB，不足则拦截并提示清理。
 * fs.statfs 需 Node ≥ 18.15（Electron 39 / Node 22 满足），三平台均可用。
 */
import { mkdir, statfs } from 'fs/promises'
import { kernelError } from './errors'

/** 预检阈值：2GB（Chromium 包约 150–300MB，解压+安装余量） */
export const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024

/** 目录所在卷的剩余可写空间（字节）。目录不存在时先创建（内核目录首启尚未建立）。 */
export async function freeBytes(dir: string): Promise<number> {
  await mkdir(dir, { recursive: true })
  const st = await statfs(dir)
  return st.bavail * st.bsize
}

/** 预检：不足 2GB 抛 DISK_FULL（渲染层据此提示清理并保留重试入口） */
export async function checkDiskSpace(dir: string): Promise<number> {
  const free = await freeBytes(dir)
  if (free < MIN_FREE_BYTES) {
    throw kernelError(
      'DISK_FULL',
      `磁盘剩余空间不足 2GB（当前约 ${(free / 1024 ** 3).toFixed(1)}GB），请清理磁盘后重试`
    )
  }
  return free
}
