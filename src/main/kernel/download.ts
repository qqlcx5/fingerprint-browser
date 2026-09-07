/**
 * 内核下载与安装（03-T3）
 *
 * 流程：.part 断点续传下载（Range + 多镜像轮换 + 空闲超时看门狗）
 *   → 解压到 staging → 校验可执行文件 → 原子改名到 userData/chromium/{revision}/
 * 完整性三道关：传输大小核对、zip 中央目录可读（yauzl open）、解压后 exe 校验。
 * 任一关失败 → KERNEL_CORRUPT 并清理残留，下次 browser:ensure 全新下载（需求 §9 引导重下）。
 */
import { createWriteStream, constants as fsConstants } from 'fs'
import { access, chmod, mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'stream/web'
import {
  type ChromiumDescriptor,
  type ShortPlatform,
  downloadZipRelPath,
  executablePathIn,
  installDir,
  kernelTempDir
} from './locate'
import { kernelError, type KernelError } from './errors'
import { extractZip } from './unzip'

/**
 * 镜像优先级：npmmirror（本仓 .npmrc 同源，已核实托管 builds/cft）→ 官方 CDN → ESRP。
 * 与 playwright 1.63 语义一致：环境变量命中则只用自定义源。
 * 注：官方对 CFT 构建默认仅列 cdn.playwright.dev，dbazure/prss 为兜底（307/400 会被轮换跳过）。
 */
function mirrorHosts(): string[] {
  const custom =
    process.env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST || process.env.PLAYWRIGHT_DOWNLOAD_HOST
  if (custom) return [custom]
  return [
    'https://cdn.npmmirror.com/binaries/playwright',
    'https://cdn.playwright.dev',
    'https://cdn.playwright.dev/dbazure/download/playwright',
    'https://playwright.download.prss.microsoft.com/dbazure/download/playwright'
  ]
}

/** 一轮 = 全部镜像各试一次；网络整体故障时最多两轮 */
const MAX_ROUNDS = 2
/** 空闲看门狗：超过该时长未收到任何字节视为连接僵死，中断并续传 */
const IDLE_TIMEOUT_MS = 30_000

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`HTTP ${status}：${url}`)
  }
}

/** 网络中断（可续传）：包装底层原因供最终错误分类（如 ENOSPC → DISK_FULL） */
class InterruptedDownload extends Error {
  constructor(readonly reason?: unknown) {
    super('下载中断')
  }
}

export interface InstallCallbacks {
  onProgress?: (received: number, total: number) => void
}

async function existingSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/**
 * 单次下载：带 Range 续传追加写；返回 true = 传输完整。
 * 网络中断/僵死 → 抛 InterruptedDownload（保留 .part）；HTTP 错误状态 → 抛 HttpStatusError（外层换镜像）。
 */
async function fetchToFile(
  url: string,
  partPath: string,
  onProgress: InstallCallbacks['onProgress']
): Promise<boolean> {
  const offset = await existingSize(partPath)
  const controller = new AbortController()
  const idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      signal: controller.signal,
      redirect: 'follow'
    })
    if (res.status === 416) return true // part 已达文件末尾（若超长由 zip 校验裁决）
    if (res.status !== 200 && res.status !== 206) throw new HttpStatusError(res.status, url)
    let start = offset
    if (res.status === 200 && offset > 0) start = 0 // 服务器忽略 Range，覆盖重写
    const contentLength = Number(res.headers.get('content-length') ?? 0)
    const total = contentLength > 0 ? start + contentLength : 0
    if (!res.body) throw new Error('下载响应无 body')

    let received = start
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length
        idle.refresh()
        onProgress?.(received, total)
        cb(null, chunk)
      }
    })
    const out = createWriteStream(partPath, { flags: start > 0 ? 'a' : 'w' })
    await pipeline(
      Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>),
      counter,
      out
    )
    if (total > 0 && received < total) throw new InterruptedDownload(new Error('传输不完整'))
    return true
  } catch (e) {
    if (e instanceof HttpStatusError) throw e
    throw new InterruptedDownload(e)
  } finally {
    clearTimeout(idle)
  }
}

async function downloadWithResume(
  desc: ChromiumDescriptor,
  pf: ShortPlatform,
  partPath: string,
  cb: InstallCallbacks
): Promise<void> {
  const rel = downloadZipRelPath(desc, pf)
  const urls = mirrorHosts().map((h) => `${h.replace(/\/+$/, '')}/${rel}`)
  let lastErr: unknown = new Error('未发起下载')
  let lastUrl = urls[0]
  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (const url of urls) {
      lastUrl = url
      try {
        if (await fetchToFile(url, partPath, cb.onProgress)) return
      } catch (e) {
        lastErr = e instanceof InterruptedDownload ? (e.reason ?? e) : e
      }
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw kernelError(
    'KERNEL_DOWNLOAD_FAILED',
    `内核下载失败（${urls.length} 个镜像 × ${MAX_ROUNDS} 轮均失败，最后镜像 ${lastUrl}）：${detail}。请检查网络后重试`
  )
}

/** exe 存在且可执行；部分 zip 工具链会丢 x 位，chmod 兜底一次 */
async function verifyExecutable(dir: string, pf: ShortPlatform): Promise<void> {
  const exe = executablePathIn(dir, pf)
  const ok = async (): Promise<boolean> => {
    try {
      await access(exe, fsConstants.X_OK)
      return true
    } catch {
      return false
    }
  }
  if (await ok()) return
  try {
    await chmod(exe, 0o755)
  } catch {
    // 落到下方统一报错
  }
  if (await ok()) return
  throw kernelError('KERNEL_CORRUPT', `内核解压后缺少可执行文件：${exe}`)
}

/** 下载→解压→校验→原子落位；返回 executablePath。失败按错误矩阵分类抛出。 */
export async function downloadAndInstall(
  desc: ChromiumDescriptor,
  pf: ShortPlatform,
  cb: InstallCallbacks = {}
): Promise<string> {
  const downloadDir = kernelTempDir()
  await mkdir(downloadDir, { recursive: true })
  const partPath = join(downloadDir, `chromium-${desc.revision}.zip.part`)
  const staging = join(downloadDir, `staging-${desc.revision}`)
  try {
    await downloadWithResume(desc, pf, partPath, cb)

    await rm(staging, { recursive: true, force: true })
    await extractZip(partPath, staging)
    await verifyExecutable(staging, pf)

    const finalDir = installDir(desc.revision)
    await rm(finalDir, { recursive: true, force: true })
    await rename(staging, finalDir)
    await rm(partPath, { force: true })
    await verifyExecutable(finalDir, pf)
    return executablePathIn(finalDir, pf)
  } catch (e) {
    const err = classifyFailure(e)
    if (err.code === 'KERNEL_CORRUPT') {
      // 损坏：清掉残留，下次 ensure 全新下载；下载失败则保留 .part 供续传
      await rm(partPath, { force: true }).catch(() => {})
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
    throw err
  }
}

const KNOWN_CODES = new Set([
  'KERNEL_MISSING',
  'KERNEL_CORRUPT',
  'KERNEL_DOWNLOAD_FAILED',
  'DISK_FULL',
  'INTERNAL'
])

/** 错误分类（03-T5）：已带业务码的原样保留；写入时磁盘满 → DISK_FULL；其余安装期异常 → KERNEL_CORRUPT */
function classifyFailure(e: unknown): KernelError {
  if (
    e &&
    typeof e === 'object' &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
  ) {
    const code = (e as { code: string }).code
    if (KNOWN_CODES.has(code)) return e as KernelError
    if (code === 'ENOSPC') {
      return kernelError('DISK_FULL', '磁盘空间不足（写入内核文件时），请清理磁盘后重试')
    }
  }
  const msg = e instanceof Error ? e.message : String(e)
  return kernelError('KERNEL_CORRUPT', `内核安装失败（包损坏或解压异常）：${msg}`)
}
