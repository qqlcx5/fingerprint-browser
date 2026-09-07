/**
 * zip 解压（03-T3 内部件）
 *
 * 复用 playwright-core/lib/utilsBundle 内置的 yauzl（exports 白名单子路径，不引新依赖），
 * 语义对齐 playwright 官方 extract-zip：保留 unix 权限位与符号链接、跳过 __MACOSX、
 * 防路径穿越——这些是 Chrome for Testing 包在 macOS/Linux 上可运行的必要条件。
 */
import { createRequire } from 'module'
import { createWriteStream } from 'fs'
import { mkdir, realpath, symlink } from 'fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'path'
import { pipeline } from 'stream/promises'
import type { Readable } from 'stream'
import { kernelError } from './errors'

const nodeRequire = createRequire(__filename)

interface ZipEntry {
  fileName: string
  versionMadeBy: number
  externalFileAttributes: number
}

interface ZipFile {
  readEntry(): void
  close(): void
  on(event: 'entry', listener: (entry: ZipEntry) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'close', listener: () => void): this
  openReadStream(entry: ZipEntry, cb: (err: Error | null, stream: Readable) => void): void
}

type Yauzl = {
  open(
    path: string,
    opts: { lazyEntries: boolean },
    cb: (err: Error | null, zip: ZipFile) => void
  ): void
}

// utilsBundle 无类型声明，此处按需声明结构
const yauzl = nodeRequire('playwright-core/lib/utilsBundle').yauzl as Yauzl

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

// zip 内 unix mode 存在 externalFileAttributes 高 16 位
function entryMode(entry: ZipEntry, isDir: boolean): number {
  let mode = (entry.externalFileAttributes >> 16) & 0xffff
  if (mode === 0) mode = isDir ? 0o755 : 0o644
  return mode & 0o777
}

/**
 * 解压 zipPath 到 dir（dir 须为绝对路径）。
 * zip 损坏（中央目录不可读等）抛 KERNEL_CORRUPT，由调用方清理残留并引导重下。
 */
export async function extractZip(
  zipPath: string,
  dir: string,
  onEntry?: (name: string) => void
): Promise<void> {
  if (!isAbsolute(dir)) throw kernelError('INTERNAL', '解压目标目录必须是绝对路径')
  await mkdir(dir, { recursive: true })
  const realDir = await realpath(dir)

  const zipfile = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) =>
      err
        ? reject(kernelError('KERNEL_CORRUPT', `内核包无法读取（zip 损坏）：${err.message}`))
        : resolve(zip)
    )
  })

  await new Promise<void>((resolve, reject) => {
    zipfile.on('error', (err) =>
      reject(kernelError('KERNEL_CORRUPT', `内核包损坏：${err.message}`))
    )
    zipfile.on('close', () => resolve())
    zipfile.on('entry', (entry) => {
      void handleEntry(entry)
        .then(() => zipfile.readEntry())
        .catch((err: unknown) => {
          zipfile.close()
          reject(err)
        })
    })
    zipfile.readEntry()
  })

  async function handleEntry(entry: ZipEntry): Promise<void> {
    if (entry.fileName.startsWith('__MACOSX/')) return
    onEntry?.(entry.fileName)
    const dest = join(realDir, entry.fileName)
    const destDir = dirname(dest)
    await mkdir(destDir, { recursive: true })
    // 防路径穿越：解压目标不得逃逸出 realDir
    const canonical = await realpath(destDir)
    if (relative(realDir, canonical).split(sep).includes('..')) {
      throw kernelError('KERNEL_CORRUPT', `内核包含越界路径：${entry.fileName}`)
    }

    const mode = entryMode(entry, entry.fileName.endsWith('/'))
    // mode===0 且非目录结尾的符号链接条目：externalFileAttributes 高位即链接目标模式，仅以 IFMT 判型
    const fmt = (entry.externalFileAttributes >> 16) & 0xf000
    const isSymlink = fmt === 0xa000

    if (entry.fileName.endsWith('/')) return // 纯目录条目，mkdir 已完成

    const stream = await new Promise<Readable>((resolve, reject) => {
      zipfile.openReadStream(entry, (err, rs) => (err ? reject(err) : resolve(rs)))
    })
    if (isSymlink) {
      const target = (await readAll(stream)).toString('utf8')
      await symlink(target, dest)
    } else {
      await pipeline(stream, createWriteStream(dest, { mode }))
    }
  }
}
