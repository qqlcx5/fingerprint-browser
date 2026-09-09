/**
 * V2 轻量浏览器配置自检。
 *
 * 验证同一持久化 Profile 在两次启动间保留 UA、语言、时区、viewport，
 * 且 V2 不注入页面脚本、不修改 WebGL/Canvas/Audio 或 navigator.webdriver。
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { chromium } from 'playwright-core'
import { alignFieldsForCountry } from '../src/main/fingerprint/align'
import { generateCoreFingerprint } from '../src/main/fingerprint/generate'
import { freezeCoreFingerprint } from '../src/main/fingerprint/readonly'
import { buildFingerprintLaunchOptions } from '../src/main/fingerprint/inject'
import type { CoreFingerprint } from '../src/shared/types'

const failures: string[] = []
function check(name: string, condition: boolean): void {
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
  if (!condition) failures.push(name)
}

function offlineChecks(): void {
  console.log('\n== V2 离线自检 ==')
  const core = generateCoreFingerprint('US')
  const frozen = freezeCoreFingerprint(JSON.parse(JSON.stringify(core)) as CoreFingerprint)
  const options = buildFingerprintLaunchOptions(frozen, alignFieldsForCountry('US'))
  check('启动选项使用持久化 UA', options.userAgent === frozen.userAgent)
  check('启动选项使用持久化尺寸', options.viewport.width === frozen.screen.width)
  check('启动参数为空，不关闭自动化特征', options.args.length === 0)
  check('配置未包含注入脚本字段', !('initScript' in options))
}

async function resolveChromium(): Promise<string> {
  const configured = process.env.FP_CHECK_CHROMIUM
  if (configured && existsSync(configured)) return configured
  const executable = chromium.executablePath()
  if (existsSync(executable)) return executable
  throw new Error('未找到 Chromium；设置 FP_CHECK_CHROMIUM 后重试')
}

interface Metrics {
  userAgent: string
  language: string
  timezone: string
  webdriver: boolean
  hasInitMarker: boolean
}

async function launchOnce(
  executablePath: string,
  profileDir: string,
  core: CoreFingerprint
): Promise<Metrics> {
  const align = alignFieldsForCountry('US')
  const context = await chromium.launchPersistentContext(profileDir, {
    ...buildFingerprintLaunchOptions(core, align),
    executablePath,
    headless: true
  })
  try {
    const page = await context.newPage()
    return await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webdriver: navigator.webdriver,
      hasInitMarker: '__fingerprintInjected' in window
    }))
  } finally {
    await context.close()
  }
}

async function browserChecks(): Promise<void> {
  console.log('\n== V2 浏览器持久化自检 ==')
  const executablePath = await resolveChromium()
  const root = mkdtempSync(join(tmpdir(), 'v2-profile-check-'))
  const coreFile = join(root, 'core.json')
  const profileDir = join(root, 'profile')
  writeFileSync(coreFile, JSON.stringify(generateCoreFingerprint('US')))
  const core = JSON.parse(readFileSync(coreFile, 'utf8')) as CoreFingerprint
  const first = await launchOnce(executablePath, profileDir, core)
  const second = await launchOnce(executablePath, profileDir, core)
  check(
    '两次启动 UA 一致',
    first.userAgent === second.userAgent && first.userAgent === core.userAgent
  )
  check('两次启动语言一致', first.language === second.language)
  check('两次启动时区一致', first.timezone === second.timezone)
  check('没有自定义页面注入标记', !first.hasInitMarker && !second.hasInitMarker)
  check('未修改 Playwright 的 webdriver 默认行为', first.webdriver && second.webdriver)
}

async function main(): Promise<void> {
  offlineChecks()
  if (process.env.FP_CHECK_OFFLINE !== '1') await browserChecks()
  if (failures.length > 0) {
    console.error(`V2_PROFILE_CHECK: FAIL: ${failures.join('；')}`)
    process.exit(1)
  }
  console.log('V2_PROFILE_CHECK: PASS')
}

void main()
