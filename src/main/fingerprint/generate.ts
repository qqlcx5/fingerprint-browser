/**
 * 核心指纹生成（05-T1）：调 fingerprint-generator，产出可持久化的 CoreFingerprint。
 *
 * 两段式策略（需求文档 §6.5）：核心指纹在创建环境时以代理出口国家为输入
 * 生成一次，此后只读。传入目标国家以设置 locale，保证 UA 平台/语言与
 * 目标地区合理匹配（§6.5 第 3 条，避免"中文 UA + 巴西 IP"类矛盾）。
 *
 * 本模块保持零 electron 依赖（纯逻辑）。
 */
import { FingerprintGenerator } from 'fingerprint-generator'
import { localeForCountry } from './align'
import type { CoreFingerprint } from '../../shared/types'

/** 桌面 Chrome 指纹：内核为 Playwright Chromium，只生成 chrome 桌面组合 */
const GENERATOR = new FingerprintGenerator({
  browsers: ['chrome'],
  devices: ['desktop'],
  operatingSystems: ['windows', 'macos']
})

/**
 * 以目标国家生成一份核心指纹。
 *
 * @param country 代理出口国家（ISO 3166-1 alpha-2）；无代理/未知国家回退 en-US 基线
 * @returns CoreFingerprint（调用方经 readonly.ts 冻结后入库，此后只读）
 */
export function generateCoreFingerprint(country: string | null | undefined): CoreFingerprint {
  const locale = localeForCountry(country)
  let fingerprint
  try {
    fingerprint = GENERATOR.getFingerprint({
      locales: [locale],
      browsers: ['chrome'],
      devices: ['desktop'],
      operatingSystems: ['windows', 'macos']
    }).fingerprint
  } catch (e) {
    // 个别 locale 与 OS 组合可能无生成场景：回退 en-US，不再让创建流程失败
    // TODO 集成阶段替换为 02-T6 滚动日志器
    console.warn(`[fingerprint:generate] locale "${locale}" 生成失败，回退 en-US：`, e)
    fingerprint = GENERATOR.getFingerprint({
      locales: ['en-US'],
      browsers: ['chrome'],
      devices: ['desktop'],
      operatingSystems: ['windows', 'macos']
    }).fingerprint
  }

  const { navigator: nav, screen, videoCard } = fingerprint
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory ?? 8,
    screen: {
      width: screen.width,
      height: screen.height,
      colorDepth: screen.colorDepth,
      pixelRatio: screen.devicePixelRatio
    },
    webgl: { vendor: videoCard.vendor, renderer: videoCard.renderer },
    locale
  }
}
