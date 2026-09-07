/**
 * 指纹一致性自检（05-T6，验收 3 的自动化脚本）。
 *
 * 同一"环境"（同一 userDataDir + 同一份核心指纹）无头启动两次，读取
 * UA / 屏幕 / WebGL / 时区 / 语言，打印 diff 并判定 PASS/FAIL。
 * 核心指纹只生成一次、经临时目录的 core.json 模拟 SQLite 持久化，
 * 第二次启动从磁盘重新读取（与应用的真实流程一致）。
 *
 * 运行方式（项目未内置 tsx，用 esbuild 打包后跑；esbuild 是 electron-vite 的依赖，
 * 必须直接调平台二进制，node_modules/.bin 里的壳脚本不可用）：
 *
 *   ESB="node_modules/.pnpm/$(ls node_modules/.pnpm | grep -E '^@esbuild+darwin-arm64@' | tail -1)/node_modules/@esbuild/darwin-arm64/bin/esbuild"
 *   TMP=$(mktemp -d)
 *   "$ESB" scripts/fp-check.ts --bundle --platform=node --format=cjs \
 *     --external:playwright-core --external:fingerprint-generator \
 *     --external:header-generator --external:fingerprint-injector \
 *     --outfile="$TMP/fp-check.cjs"
 *   FP_CHECK_OFFLINE=1 NODE_PATH="$PWD/node_modules" node "$TMP/fp-check.cjs"
 *   NODE_PATH="$PWD/node_modules" node "$TMP/fp-check.cjs"   # 含浏览器启动的完整验收
 *
 * （Linux/Windows 把 darwin-arm64 换成对应平台包名）
 *
 * 环境变量：
 *   FP_CHECK_COUNTRY   目标国家（默认 US，测对齐字段与 locale 一致性）
 *   FP_CHECK_OFFLINE   =1 时跳过浏览器启动，只做纯逻辑断言（生成/对齐/冻结/差异/注入确定性）
 *   FP_CHECK_CHROMIUM  显式指定 Chromium 可执行文件（03 内核落地后可指向 userData/chromium/{rev}/...）
 *
 * 浏览器二进制缺失时：`pnpm exec playwright-core install chromium` 或等 03 内核就绪。
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { chromium } from 'playwright-core'
import { alignFieldsForCountry } from '../src/main/fingerprint/align'
import { generateCoreFingerprint } from '../src/main/fingerprint/generate'
import {
  assertNoProtectedUpdate,
  deepFreeze,
  freezeCoreFingerprint
} from '../src/main/fingerprint/readonly'
import { diffCountry, countryOfAlign } from '../src/main/fingerprint/diffCountry'
import {
  buildFingerprintLaunchOptions,
  buildInjectableFingerprint,
  injectFingerprint
} from '../src/main/fingerprint/inject'
import type { CoreFingerprint, ReadonlyCoreFingerprint } from '../src/shared/types'

// ---------- 通用断言 ----------

const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  const mark = cond ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures.push(name)
}

function expectThrow(name: string, fn: () => void): void {
  try {
    fn()
    check(name, false, '未抛出异常')
  } catch (e) {
    check(name, true, e instanceof Error ? e.message.slice(0, 60) : String(e))
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---------- 纯逻辑自检（无需浏览器） ----------

function offlineChecks(): void {
  console.log(`\n== 离线自检：生成 / 对齐 / 只读 / 差异 / 注入确定性 ==`)

  const country = process.env.FP_CHECK_COUNTRY ?? 'US'
  const core = generateCoreFingerprint(country)
  console.log(`  样本核心指纹（country=${country}）:`)
  console.log(
    '   ',
    JSON.stringify({
      userAgent: core.userAgent.slice(0, 60) + '…',
      platform: core.platform,
      locale: core.locale,
      screen: core.screen,
      hardwareConcurrency: core.hardwareConcurrency,
      deviceMemory: core.deviceMemory,
      webgl: core.webgl
    })
  )
  check('T1 UA 为 Chrome', /Chrome\/\d+/.test(core.userAgent), core.userAgent.slice(0, 50))
  check('T1 平台非空且与 UA 一致', core.platform.length > 0 && uaMatchesPlatform(core))
  check(
    'T1 屏幕字段合理',
    core.screen.width >= 600 && core.screen.height >= 600 && core.screen.colorDepth >= 24,
    `${core.screen.width}x${core.screen.height}@${core.screen.pixelRatio}`
  )
  check(
    'T1 WebGL vendor/renderer 非空',
    core.webgl.vendor.length > 0 && core.webgl.renderer.length > 0,
    `${core.webgl.vendor} / ${core.webgl.renderer.slice(0, 30)}`
  )
  check(
    'T1 硬件并发/内存为正数',
    core.hardwareConcurrency > 0 && core.deviceMemory > 0,
    `${core.hardwareConcurrency}核 / ${core.deviceMemory}GB`
  )
  const again = generateCoreFingerprint(country)
  check('T1 两次调用产生不同指纹（生成器有随机性）', !deepEqual(core, again))

  // T2 对齐
  const align = alignFieldsForCountry(country)
  check('T2 对齐时区非 UTC（表内国家）', align.timezone !== 'UTC', align.timezone)
  check('T2 对齐语言 = 核心指纹 locale', align.language === core.locale, align.language)
  const unknown = alignFieldsForCountry('ZZ')
  check('T2 未知国家回退 UTC/en-US', unknown.timezone === 'UTC' && unknown.language === 'en-US')

  // T3 只读
  const frozen = freezeCoreFingerprint(JSON.parse(JSON.stringify(core)) as CoreFingerprint)
  check('T3 深冻结后 Object.isFrozen', Object.isFrozen(frozen) && Object.isFrozen(frozen.screen))
  expectThrow('T3 严格模式下改写指纹抛 TypeError', () => {
    'use strict'
    ;(frozen as { userAgent: string }).userAgent = 'tampered'
  })
  expectThrow('T3 DAO patch 带 fingerprint 字段被断言拦截', () =>
    assertNoProtectedUpdate({ id: 'x', fingerprint: {} })
  )
  check('T3 DAO patch 不带指纹字段时放行', (() => {
    assertNoProtectedUpdate({ id: 'x', name: 'ok' })
    return true
  })())

  // T4 国家差异
  check('T4 US→DE 触发变更', diffCountry('US', 'DE').changed)
  check('T4 DE→DE 不触发', !diffCountry('DE', 'DE').changed)
  check('T4 null→US 触发（从未对齐）', diffCountry(null, 'US').changed)
  check('T4 任意→null 不触发（测连无国家）', !diffCountry('US', null).changed)
  check('T4 from 取自对齐字段反查', countryOfAlign(alignFieldsForCountry('JP')) === 'JP')

  // T5 注入确定性：同 core 重建注入指纹必须逐字节一致（验收 3 的前提）
  const fp1 = JSON.stringify(buildInjectableFingerprint(frozen))
  const fp2 = JSON.stringify(buildInjectableFingerprint(frozen))
  check('T5 同核心指纹重建注入指纹确定一致', fp1 === fp2, `体积 ${fp1.length}B`)
  const opts = buildFingerprintLaunchOptions(frozen, align)
  check(
    'T5 启动选项含时区/UA/viewport',
    opts.timezoneId === align.timezone &&
      opts.userAgent === core.userAgent &&
      opts.viewport.width === core.screen.width
  )
}

function uaMatchesPlatform(core: CoreFingerprint): boolean {
  const ua = core.userAgent
  if (/Windows/i.test(ua)) return core.platform === 'Win32'
  if (/Mac OS X|Macintosh/i.test(ua)) return core.platform === 'MacIntel'
  if (/Linux|Android/i.test(ua)) return core.platform.startsWith('Linux')
  return true
}

// ---------- 浏览器一致性（验收 3） ----------

async function resolveChromium(): Promise<string> {
  if (process.env.FP_CHECK_CHROMIUM) {
    const p = process.env.FP_CHECK_CHROMIUM
    if (!existsSync(p)) throw new Error(`FP_CHECK_CHROMIUM 指向的文件不存在: ${p}`)
    return p
  }
  try {
    const p = chromium.executablePath()
    if (existsSync(p)) return p
  } catch {
    /* registry 未安装，走报错分支 */
  }
  throw new Error(
    '未找到 Chromium 二进制。两种解决方式：\n' +
      '  1) pnpm exec playwright-core install chromium\n' +
      '  2) 03 内核就绪后设置 FP_CHECK_CHROMIUM=<userData/chromium/{rev}/可执行文件>'
  )
}

/**
 * 在注入后的页面里读取指纹表现值。
 * 注意：必须传真实函数引用（Playwright ≥1.4x 对字符串只做表达式求值，
 * '() => {...}' 会返回函数对象，序列化为 undefined）。
 */
interface Metrics {
  userAgent: string
  platform: string
  hardwareConcurrency: number
  deviceMemory: number | null
  screen: { width: number; height: number; colorDepth: number; pixelRatio: number }
  webgl: { vendor: string; renderer: string } | null
  timezone: string
  language: string
}

function readMetrics(): Metrics {
  const nav = navigator as unknown as Navigator & { deviceMemory?: number }
  const c = document.createElement('canvas')
  const gl = c.getContext('webgl')
  let webgl: { vendor: string; renderer: string } | null = null
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    webgl = {
      vendor: String(gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
      renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    }
  }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory ?? null,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
      pixelRatio: window.devicePixelRatio
    },
    webgl,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language
  }
}

async function launchOnce(
  executablePath: string,
  profileDir: string,
  core: ReadonlyCoreFingerprint
): Promise<Metrics> {
  const align = alignFieldsForCountry(process.env.FP_CHECK_COUNTRY ?? 'US')
  const context = await chromium.launchPersistentContext(profileDir, {
    ...buildFingerprintLaunchOptions(core, align),
    executablePath,
    headless: true
  })
  try {
    await injectFingerprint(context, core)
    const page = await context.newPage()
    await page.goto('about:blank')
    return await page.evaluate(readMetrics)
  } finally {
    await context.close()
  }
}

function compareRuns(core: ReadonlyCoreFingerprint, runs: Metrics[]): void {
  const fields: Array<[string, (m: Metrics) => unknown]> = [
    ['UA', (m) => m.userAgent],
    ['平台', (m) => m.platform],
    ['硬件并发', (m) => m.hardwareConcurrency],
    ['设备内存', (m) => m.deviceMemory],
    ['屏幕', (m) => m.screen],
    ['WebGL', (m) => m.webgl],
    ['时区', (m) => m.timezone],
    ['语言', (m) => m.language]
  ]
  for (const [name, get] of fields) {
    const same = deepEqual(get(runs[0]), get(runs[1]))
    check(`两次启动一致：${name}`, same, JSON.stringify([get(runs[0]), get(runs[1])]))
  }
  check('UA 与持久化核心指纹一致', runs[0].userAgent === core.userAgent)
  check('屏幕与持久化核心指纹一致', deepEqual(runs[0].screen, {
    width: core.screen.width,
    height: core.screen.height,
    colorDepth: core.screen.colorDepth,
    pixelRatio: core.screen.pixelRatio
  }))
  check('WebGL 与持久化核心指纹一致', deepEqual(runs[0].webgl, core.webgl))
  console.log('\n第一次启动表现值:')
  console.log(JSON.stringify(runs[0], null, 2))
  console.log('第二次启动表现值:')
  console.log(JSON.stringify(runs[1], null, 2))
}

async function browserChecks(): Promise<void> {
  console.log('\n== 浏览器自检：同环境两次无头启动 ==')
  const executablePath = await resolveChromium()
  const country = process.env.FP_CHECK_COUNTRY ?? 'US'

  const envDir = mkdtempSync(join(tmpdir(), 'fp-check-env-'))
  const profileDir = join(envDir, 'profile')
  const coreFile = join(envDir, 'core.json')

  // 第一次：生成并"入库"（模拟 07-T1 创建流程）
  writeFileSync(coreFile, JSON.stringify(generateCoreFingerprint(country)))

  const runs: Metrics[] = []
  for (const run of [1, 2]) {
    // 每次从磁盘重新读取并冻结（模拟 02 读取行 → freeze 的真实路径）
    const core = freezeCoreFingerprint(JSON.parse(readFileSync(coreFile, 'utf8')) as CoreFingerprint)
    console.log(`启动第 ${run} 次…`)
    runs.push(await launchOnce(executablePath, profileDir, core))
  }
  compareRunsFrozen(coreFile, runs)
  console.log(`\n环境目录（可保留排查）: ${envDir}`)
}

function compareRunsFrozen(coreFile: string, runs: Metrics[]): void {
  const core = freezeCoreFingerprint(JSON.parse(readFileSync(coreFile, 'utf8')) as CoreFingerprint)
  compareRuns(core, runs)
}

// ---------- 入口 ----------

async function main(): Promise<void> {
  offlineChecks()
  if (process.env.FP_CHECK_OFFLINE === '1') {
    finish()
    return
  }
  await browserChecks()
  finish()
}

function finish(): void {
  if (failures.length > 0) {
    console.error(`\nFP_CHECK: FAIL（${failures.length} 项）→ ${failures.join('；')}`)
    process.exit(1)
  }
  console.log('\nFP_CHECK: PASS')
}

main().catch((e) => {
  console.error('FP_CHECK: ERROR', e)
  process.exit(1)
})
