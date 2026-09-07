/**
 * 内核定位与平台注册表（03-T1）
 *
 * revision/browserVersion 一律从 playwright-core 的 browsers.json 读取，不硬编码：
 * 升级 playwright-core 即升级内核（需求文档 §3 版本锁定策略）。
 * 可执行文件相对路径与下载包路径为 playwright-core 1.63（Chrome for Testing 布局）
 * 的平台表镜像；升级 playwright-core 后若布局变化，安装后的 ready 校验会立即暴露。
 */
import { createRequire } from 'module'
import { existsSync, readFileSync } from 'fs'
import { accessSync, constants as fsConstants, statSync } from 'fs'
import { dirname, join } from 'path'
import { arch, platform } from 'os'
import { chromiumDir, chromiumRoot } from '../../shared/paths'
import type { KernelInfo } from '../../shared/types'
import { kernelError } from './errors'

const nodeRequire = createRequire(__filename)

/** browsers.json 中 chromium 描述符的有效子集 */
export interface ChromiumDescriptor {
  /** 安装目录名用 revision，如 '1243' */
  revision: string
  /** 下载 URL 用的浏览器版本号，如 '153.0.8010.12' */
  browserVersion: string
}

export type ShortPlatform = 'mac-x64' | 'mac-arm64' | 'linux-x64' | 'linux-arm64' | 'win-x64'

/** zip 解压后内核可执行文件相对安装目录的路径（对齐 playwright-core EXECUTABLE_PATHS.chromium） */
const EXECUTABLE_TOKENS: Record<ShortPlatform, string[]> = {
  'mac-x64': [
    'chrome-mac-x64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing'
  ],
  'mac-arm64': [
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing'
  ],
  'linux-x64': ['chrome-linux64', 'chrome'],
  'linux-arm64': ['chrome-linux-arm64', 'chrome'],
  'win-x64': ['chrome-win64', 'chrome.exe']
}

/** CDN 上的下载包相对路径（对齐 playwright-core DOWNLOAD_PATHS.chromium 的 cft 布局） */
const DOWNLOAD_ZIP: Record<ShortPlatform, string> = {
  'mac-x64': 'mac-x64/chrome-mac-x64.zip',
  'mac-arm64': 'mac-arm64/chrome-mac-arm64.zip',
  'win-x64': 'win64/chrome-win64.zip',
  'linux-x64': 'linux64/chrome-linux64.zip',
  'linux-arm64': 'linux-arm64/chrome-linux-arm64.zip'
}

/** playwright-core 包根目录（browsers.json 所在处），走 exports 白名单 + 向上兜底 */
function playwrightRoot(): string {
  let dir: string
  try {
    dir = dirname(nodeRequire.resolve('playwright-core/package.json'))
  } catch {
    dir = dirname(nodeRequire.resolve('playwright-core'))
  }
  for (let i = 0; i < 3 && !existsSync(join(dir, 'browsers.json')); i++) {
    dir = dirname(dir)
  }
  if (!existsSync(join(dir, 'browsers.json'))) {
    throw kernelError(
      'INTERNAL',
      '找不到 playwright-core/browsers.json，playwright-core 依赖不完整'
    )
  }
  return dir
}

/** 读取当前 playwright-core 锁定的 chromium 描述符 */
export function readChromiumDescriptor(): ChromiumDescriptor {
  const raw = JSON.parse(readFileSync(join(playwrightRoot(), 'browsers.json'), 'utf8')) as {
    browsers?: Array<{ name?: string; revision?: string; browserVersion?: string }>
  }
  const chromium = raw.browsers?.find((b) => b.name === 'chromium')
  if (!chromium?.revision || !chromium.browserVersion) {
    throw kernelError(
      'INTERNAL',
      'browsers.json 中缺少 chromium 条目，playwright-core 布局已变化，需人工核对'
    )
  }
  return { revision: chromium.revision, browserVersion: chromium.browserVersion }
}

/** 当前宿主平台（playwright shortPlatform 同构推导）；不支持的平台抛 INTERNAL */
export function currentPlatform(): ShortPlatform {
  const p = platform()
  const a = arch()
  if (p === 'darwin') return a === 'arm64' ? 'mac-arm64' : 'mac-x64'
  if (p === 'win32' && a === 'x64') return 'win-x64'
  if (p === 'linux') return a === 'arm64' ? 'linux-arm64' : 'linux-x64'
  throw kernelError('INTERNAL', `当前平台无 Chromium 发行包：${p}-${a}`)
}

/** 下载包在 CDN 上的相对路径，如 builds/cft/153.0.8010.12/mac-arm64/chrome-mac-arm64.zip */
export function downloadZipRelPath(desc: ChromiumDescriptor, pf: ShortPlatform): string {
  return `builds/cft/${desc.browserVersion}/${DOWNLOAD_ZIP[pf]}`
}

/** 安装目录：userData/chromium/{revision}/ */
export function installDir(revision: string): string {
  return chromiumDir(revision)
}

/** 下载暂存目录（.part 与解压 staging 都在这里，成功后原子改名到安装目录） */
export function kernelTempDir(): string {
  return join(chromiumRoot(), '.download')
}

/** 指定根目录（安装目录或 staging）下的可执行文件路径 */
export function executablePathIn(rootDir: string, pf: ShortPlatform): string {
  return join(rootDir, ...EXECUTABLE_TOKENS[pf])
}

function canExecute(path: string): boolean {
  try {
    return statSync(path).isFile() && (accessSync(path, fsConstants.X_OK), true)
  } catch {
    return false
  }
}

/**
 * 内核定位（03-T1 核心）：
 * 存在 + 是文件 + 可执行 → ready:true 且带 executablePath；否则 ready:false（不抛错，
 * 缺失是首启正常态，由 browser:ensure 触发下载）。仅平台不支持/browsers.json 异常才抛错。
 */
export function locate(): KernelInfo {
  const desc = readChromiumDescriptor()
  const pf = currentPlatform()
  const path = executablePathIn(installDir(desc.revision), pf)
  const ready = canExecute(path)
  return { ready, revision: desc.revision, path: ready ? path : null }
}
