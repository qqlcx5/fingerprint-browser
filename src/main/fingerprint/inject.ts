/**
 * 指纹注入（05-T5）：为 06-launcher 的 launchPersistentContext 提供两件东西。
 *
 * 1. buildFingerprintLaunchOptions：UA / viewport / screen / locale /
 *    timezoneId / geolocation —— 时区、Accept-Language、geo 覆盖用 Playwright
 *    原生上下文选项实现（CDP 级，先于任何页面 JS，比 init script 更难被检测）
 * 2. injectFingerprint：调 fingerprint-injector 的 init script 覆盖核心指纹
 *    （UA/平台/屏幕/WebGL/硬件并发等），逐字段来自持久化的 CoreFingerprint
 *
 * 确定性说明：fingerprint-injector 需要"完整指纹"（fonts/codecs 等），
 * 而 DB 只存 CoreFingerprint（§5 schema）。本模块从 CoreFingerprint 确定性
 * 重建完整指纹——同一环境每次启动注入完全一致（验收 3），不引入随机性。
 *
 * 本模块保持零 electron 依赖（纯逻辑），供 fp-check 脚本独立复用。
 */
import { FingerprintInjector } from 'fingerprint-injector'
import type {
  BrowserFingerprintWithHeaders,
  ExtraProperties,
  Fingerprint,
  NavigatorFingerprint,
  ScreenFingerprint,
  UserAgentData
} from 'fingerprint-generator'
import type { BrowserContext } from 'playwright-core'
import type { AlignFields, ReadonlyCoreFingerprint } from '../../shared/types'

const injector = new FingerprintInjector()

/** injector 的 playwright 上下文参数类型（optional peer，运行时与 playwright-core 兼容） */
type InjectorContext = Parameters<FingerprintInjector['attachFingerprintToPlaywright']>[0]

// ---------- 从 UA 派生的确定性辅助 ----------

function chromeMajorVersion(ua: string): string {
  const m = /Chrome\/(\d+)/.exec(ua)
  return m ? m[1] : '131'
}

function uaPlatformInfo(ua: string): {
  navigatorPlatform: string
  uaDataPlatform: string
  platformVersion: string
} {
  if (/Windows/i.test(ua)) {
    return { navigatorPlatform: 'Win32', uaDataPlatform: 'Windows', platformVersion: '10.0.0' }
  }
  if (/Mac OS X|Macintosh/i.test(ua)) {
    return { navigatorPlatform: 'MacIntel', uaDataPlatform: 'macOS', platformVersion: '14.5.0' }
  }
  if (/Android/i.test(ua)) {
    return {
      navigatorPlatform: 'Linux armv8l',
      uaDataPlatform: 'Android',
      platformVersion: '14.0.0'
    }
  }
  return { navigatorPlatform: 'Linux x86_64', uaDataPlatform: 'Linux', platformVersion: '6.6.0' }
}

function userAgentDataFor(ua: string): UserAgentData {
  const major = chromeMajorVersion(ua)
  const { uaDataPlatform, platformVersion } = uaPlatformInfo(ua)
  const brands = [
    { brand: 'Not?A_Brand', version: '99' },
    { brand: 'Google Chrome', version: major },
    { brand: 'Chromium', version: major }
  ]
  return {
    brands,
    mobile: /Mobile|Android/i.test(ua),
    platform: uaDataPlatform,
    architecture: /arm/i.test(ua) ? 'arm' : 'x86',
    bitness: '64',
    fullVersionList: brands,
    model: '',
    platformVersion,
    uaFullVersion: `${major}.0.0.0`
  }
}

function buildAcceptLanguage(language: string): string {
  const base = language.split('-')[0]
  return base && base !== language ? `${language},${base};q=0.9` : language
}

// ---------- CoreFingerprint → 完整指纹（确定性重建） ----------

/** Windows 任务栏/浏览器 UI 的确定性高度近似（只为派生 avail/inner 等非核心字段） */
const TASKBAR_HEIGHT = 40
const BROWSER_CHROME_HEIGHT = 88

function screenFingerprintFor(core: ReadonlyCoreFingerprint): ScreenFingerprint {
  const { width, height, colorDepth, pixelRatio } = core.screen
  const availHeight = Math.max(height - TASKBAR_HEIGHT, Math.floor(height / 2))
  const innerHeight = Math.max(availHeight - BROWSER_CHROME_HEIGHT, Math.floor(availHeight / 2))
  return {
    width,
    height,
    availWidth: width,
    availHeight,
    availTop: 0,
    availLeft: 0,
    colorDepth,
    pixelDepth: colorDepth,
    devicePixelRatio: pixelRatio,
    pageXOffset: 0,
    pageYOffset: 0,
    innerWidth: width,
    innerHeight,
    outerWidth: width,
    outerHeight: availHeight,
    screenX: 0,
    clientWidth: width,
    clientHeight: innerHeight,
    hasHDR: colorDepth > 24
  }
}

function navigatorFingerprintFor(core: ReadonlyCoreFingerprint): NavigatorFingerprint {
  const base = core.locale.split('-')[0]
  const languages = base && base !== core.locale ? [core.locale, base] : [core.locale]
  return {
    userAgent: core.userAgent,
    userAgentData: userAgentDataFor(core.userAgent),
    doNotTrack: null as unknown as string, // Chrome 实际返回 null，注入层按原值覆盖
    appCodeName: 'Mozilla',
    appName: 'Netscape',
    appVersion: core.userAgent.replace(/^Mozilla\//, ''),
    oscpu: '',
    webdriver: 'false',
    language: core.locale,
    languages,
    platform: core.platform,
    deviceMemory: core.deviceMemory,
    hardwareConcurrency: core.hardwareConcurrency,
    product: 'Gecko',
    productSub: '20030107',
    vendor: 'Google Inc.',
    vendorSub: '',
    maxTouchPoints: 0,
    extraProperties: {
      vendorFlavors: ['chrome'],
      isBluetoothSupported: false,
      globalPrivacyControl: null,
      pdfViewerEnabled: true,
      installedApps: []
    } as ExtraProperties
  }
}

/** 常见桌面字体集（确定性；真实探测成本高，轻量指纹场景可接受） */
const FONT_SET = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Impact',
  'Lucida Console',
  'Microsoft Sans Serif',
  'Palatino Linotype',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana'
]

function fingerprintFromCore(core: ReadonlyCoreFingerprint): Fingerprint {
  return {
    screen: screenFingerprintFor(core),
    navigator: navigatorFingerprintFor(core),
    videoCard: { vendor: core.webgl.vendor, renderer: core.webgl.renderer },
    videoCodecs: {
      avc1: 'probably',
      h264: 'probably',
      vp8: 'probably',
      vp9: 'probably',
      av01: 'probably'
    },
    audioCodecs: {
      aac: 'probably',
      mp3: 'probably',
      opus: 'probably',
      ogg: 'probably',
      flac: 'probably',
      wav: 'probably'
    },
    pluginsData: {},
    multimediaDevices: [],
    fonts: FONT_SET,
    mockWebRTC: true, // 防 WebRTC 泄露代理外的真实 IP
    slim: false
  }
}

/** 由持久化的核心指纹构建 injector 可注入的完整指纹 + 浏览器级 headers */
export function buildInjectableFingerprint(
  core: ReadonlyCoreFingerprint
): BrowserFingerprintWithHeaders {
  const major = chromeMajorVersion(core.userAgent)
  const { uaDataPlatform } = uaPlatformInfo(core.userAgent)
  return {
    headers: {
      'user-agent': core.userAgent,
      'accept-language': buildAcceptLanguage(core.locale),
      'sec-ch-ua': `"Not?A_Brand";v="99", "Google Chrome";v="${major}", "Chromium";v="${major}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': `"${uaDataPlatform}"`
    },
    fingerprint: fingerprintFromCore(core)
  }
}

// ---------- 对 06-launcher 的两个出口 ----------

/** launchPersistentContext 需要的指纹/对齐相关选项（结构兼容 playwright 选项名） */
export interface FingerprintLaunchOptions {
  userAgent: string
  viewport: { width: number; height: number }
  screen: { width: number; height: number }
  locale: string
  /** 对齐字段：IANA 时区（Intl/Date 全局生效） */
  timezoneId: string
  /** 对齐字段：地理位置（无则 undefined，不模拟） */
  geolocation: { latitude: number; longitude: number; accuracy: number } | undefined
  /** geolocation 存在时预授权，保证对齐覆盖对页面可见 */
  permissions: string[]
  /** navigator.webdriver=false 所需（否则 Playwright 下恒为 true，指纹即穿帮） */
  args: string[]
}

/**
 * 时区/Accept-Language/geo 覆盖 + 核心 UA/屏幕的原生启动选项。
 * 06-launcher 将返回值展开进 launchPersistentContext 的第二个参数。
 */
export function buildFingerprintLaunchOptions(
  core: ReadonlyCoreFingerprint,
  align: AlignFields
): FingerprintLaunchOptions {
  return {
    userAgent: core.userAgent,
    viewport: { width: core.screen.width, height: core.screen.height },
    screen: { width: core.screen.width, height: core.screen.height },
    locale: core.locale,
    timezoneId: align.timezone,
    geolocation: align.geolocation ? { ...align.geolocation, accuracy: 100 } : undefined,
    permissions: align.geolocation ? ['geolocation'] : [],
    args: ['--disable-blink-features=AutomationControlled']
  }
}

/**
 * 核心 Chrome 指纹注入（fingerprint-injector init script）。
 * 必须在 context 创建后、打开任何页面前调用；UA/viewport/时区等原生部分
 * 由 buildFingerprintLaunchOptions 在创建时给定。
 */
export async function injectFingerprint(
  context: BrowserContext,
  core: ReadonlyCoreFingerprint
): Promise<void> {
  await injector.attachFingerprintToPlaywright(
    context as unknown as InjectorContext,
    buildInjectableFingerprint(core)
  )
}
