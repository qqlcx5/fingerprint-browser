import type { AlignFields, ReadonlyCoreFingerprint } from '../../shared/types'

/**
 * V2 仅使用持久化的轻量浏览器配置。所有值都在创建持久化上下文时设置，
 * 不注入页面脚本、不修改渲染 API、不隐藏自动化标记。
 */
export interface FingerprintLaunchOptions {
  userAgent: string
  viewport: { width: number; height: number }
  screen: { width: number; height: number }
  locale: string
  timezoneId: string
  geolocation: { latitude: number; longitude: number; accuracy: number } | undefined
  permissions: string[]
  args: string[]
}

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
    args: []
  }
}
