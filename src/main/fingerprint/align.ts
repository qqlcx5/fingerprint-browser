/**
 * 对齐字段映射（05-T2）：国家 → 时区 / 语言 / 地理位置。
 *
 * 两段式策略（需求文档 §6.5）：核心指纹只读，时区/语言/地理位置作为
 * 派生字段跟随代理出口国家。本表内置常见国家；未覆盖的国家回退
 * UTC/en-US 并记日志（待 02-T6 滚动日志器接线后替换 console 输出）。
 *
 * 本模块保持零 electron 依赖（纯逻辑），供 generate / inject / 脚本直接复用。
 */
import type { AlignFields } from '../../shared/types'

export interface CountryAlignEntry {
  /** IANA 时区，如 'Europe/Berlin' */
  readonly timezone: string
  /** Accept-Language 首选 BCP-47，如 'de-DE' */
  readonly language: string
  /** 代表性坐标（首都，约 2 位小数精度） */
  readonly geolocation: { readonly latitude: number; readonly longitude: number }
}

/** 国家（ISO 3166-1 alpha-2）→ 对齐字段基线 */
export const COUNTRY_ALIGN_TABLE: Readonly<Record<string, CountryAlignEntry>> = {
  US: {
    timezone: 'America/New_York',
    language: 'en-US',
    geolocation: { latitude: 40.71, longitude: -74.01 }
  },
  CA: {
    timezone: 'America/Toronto',
    language: 'en-CA',
    geolocation: { latitude: 43.65, longitude: -79.38 }
  },
  MX: {
    timezone: 'America/Mexico_City',
    language: 'es-MX',
    geolocation: { latitude: 19.43, longitude: -99.13 }
  },
  BR: {
    timezone: 'America/Sao_Paulo',
    language: 'pt-BR',
    geolocation: { latitude: -23.55, longitude: -46.63 }
  },
  AR: {
    timezone: 'America/Argentina/Buenos_Aires',
    language: 'es-AR',
    geolocation: { latitude: -34.6, longitude: -58.38 }
  },
  GB: {
    timezone: 'Europe/London',
    language: 'en-GB',
    geolocation: { latitude: 51.51, longitude: -0.13 }
  },
  IE: {
    timezone: 'Europe/Dublin',
    language: 'en-IE',
    geolocation: { latitude: 53.35, longitude: -6.26 }
  },
  DE: {
    timezone: 'Europe/Berlin',
    language: 'de-DE',
    geolocation: { latitude: 52.52, longitude: 13.41 }
  },
  FR: {
    timezone: 'Europe/Paris',
    language: 'fr-FR',
    geolocation: { latitude: 48.86, longitude: 2.35 }
  },
  ES: {
    timezone: 'Europe/Madrid',
    language: 'es-ES',
    geolocation: { latitude: 40.42, longitude: -3.7 }
  },
  PT: {
    timezone: 'Europe/Lisbon',
    language: 'pt-PT',
    geolocation: { latitude: 38.72, longitude: -9.14 }
  },
  IT: {
    timezone: 'Europe/Rome',
    language: 'it-IT',
    geolocation: { latitude: 41.9, longitude: 12.5 }
  },
  NL: {
    timezone: 'Europe/Amsterdam',
    language: 'nl-NL',
    geolocation: { latitude: 52.37, longitude: 4.9 }
  },
  BE: {
    timezone: 'Europe/Brussels',
    language: 'nl-BE',
    geolocation: { latitude: 50.85, longitude: 4.35 }
  },
  CH: {
    timezone: 'Europe/Zurich',
    language: 'de-CH',
    geolocation: { latitude: 47.37, longitude: 8.54 }
  },
  AT: {
    timezone: 'Europe/Vienna',
    language: 'de-AT',
    geolocation: { latitude: 48.21, longitude: 16.37 }
  },
  SE: {
    timezone: 'Europe/Stockholm',
    language: 'sv-SE',
    geolocation: { latitude: 59.33, longitude: 18.07 }
  },
  NO: {
    timezone: 'Europe/Oslo',
    language: 'nb-NO',
    geolocation: { latitude: 59.91, longitude: 10.75 }
  },
  DK: {
    timezone: 'Europe/Copenhagen',
    language: 'da-DK',
    geolocation: { latitude: 55.68, longitude: 12.57 }
  },
  FI: {
    timezone: 'Europe/Helsinki',
    language: 'fi-FI',
    geolocation: { latitude: 60.17, longitude: 24.94 }
  },
  PL: {
    timezone: 'Europe/Warsaw',
    language: 'pl-PL',
    geolocation: { latitude: 52.23, longitude: 21.01 }
  },
  CZ: {
    timezone: 'Europe/Prague',
    language: 'cs-CZ',
    geolocation: { latitude: 50.09, longitude: 14.42 }
  },
  GR: {
    timezone: 'Europe/Athens',
    language: 'el-GR',
    geolocation: { latitude: 37.98, longitude: 23.73 }
  },
  RU: {
    timezone: 'Europe/Moscow',
    language: 'ru-RU',
    geolocation: { latitude: 55.76, longitude: 37.62 }
  },
  UA: {
    timezone: 'Europe/Kyiv',
    language: 'uk-UA',
    geolocation: { latitude: 50.45, longitude: 30.52 }
  },
  TR: {
    timezone: 'Europe/Istanbul',
    language: 'tr-TR',
    geolocation: { latitude: 41.01, longitude: 28.98 }
  },
  AE: {
    timezone: 'Asia/Dubai',
    language: 'ar-AE',
    geolocation: { latitude: 25.2, longitude: 55.27 }
  },
  SA: {
    timezone: 'Asia/Riyadh',
    language: 'ar-SA',
    geolocation: { latitude: 24.71, longitude: 46.68 }
  },
  IL: {
    timezone: 'Asia/Jerusalem',
    language: 'he-IL',
    geolocation: { latitude: 31.77, longitude: 35.21 }
  },
  EG: {
    timezone: 'Africa/Cairo',
    language: 'ar-EG',
    geolocation: { latitude: 30.04, longitude: 31.24 }
  },
  NG: {
    timezone: 'Africa/Lagos',
    language: 'en-NG',
    geolocation: { latitude: 6.52, longitude: 3.38 }
  },
  ZA: {
    timezone: 'Africa/Johannesburg',
    language: 'en-ZA',
    geolocation: { latitude: -26.2, longitude: 28.05 }
  },
  IN: {
    timezone: 'Asia/Kolkata',
    language: 'hi-IN',
    geolocation: { latitude: 28.61, longitude: 77.21 }
  },
  TH: {
    timezone: 'Asia/Bangkok',
    language: 'th-TH',
    geolocation: { latitude: 13.76, longitude: 100.5 }
  },
  VN: {
    timezone: 'Asia/Ho_Chi_Minh',
    language: 'vi-VN',
    geolocation: { latitude: 10.82, longitude: 106.63 }
  },
  ID: {
    timezone: 'Asia/Jakarta',
    language: 'id-ID',
    geolocation: { latitude: -6.21, longitude: 106.85 }
  },
  MY: {
    timezone: 'Asia/Kuala_Lumpur',
    language: 'ms-MY',
    geolocation: { latitude: 3.14, longitude: 101.69 }
  },
  PH: {
    timezone: 'Asia/Manila',
    language: 'en-PH',
    geolocation: { latitude: 14.6, longitude: 120.98 }
  },
  SG: {
    timezone: 'Asia/Singapore',
    language: 'en-SG',
    geolocation: { latitude: 1.35, longitude: 103.82 }
  },
  CN: {
    timezone: 'Asia/Shanghai',
    language: 'zh-CN',
    geolocation: { latitude: 31.23, longitude: 121.47 }
  },
  HK: {
    timezone: 'Asia/Hong_Kong',
    language: 'zh-HK',
    geolocation: { latitude: 22.32, longitude: 114.17 }
  },
  TW: {
    timezone: 'Asia/Taipei',
    language: 'zh-TW',
    geolocation: { latitude: 25.03, longitude: 121.57 }
  },
  JP: {
    timezone: 'Asia/Tokyo',
    language: 'ja-JP',
    geolocation: { latitude: 35.68, longitude: 139.69 }
  },
  KR: {
    timezone: 'Asia/Seoul',
    language: 'ko-KR',
    geolocation: { latitude: 37.57, longitude: 126.98 }
  },
  AU: {
    timezone: 'Australia/Sydney',
    language: 'en-AU',
    geolocation: { latitude: -33.87, longitude: 151.21 }
  },
  NZ: {
    timezone: 'Pacific/Auckland',
    language: 'en-NZ',
    geolocation: { latitude: -36.85, longitude: 174.76 }
  }
}

/** 未覆盖国家的回退基线（需求文档 §6.5-T2：UTC/en-US + 日志） */
export const FALLBACK_ALIGN: CountryAlignEntry = {
  timezone: 'UTC',
  language: 'en-US',
  geolocation: { latitude: 0, longitude: 0 }
}

function warnFallback(country: string | null | undefined): void {
  // TODO 集成阶段替换为 02-T6 滚动日志器（userData/logs/）
  console.warn(
    `[fingerprint:align] 国家 "${country ?? '(空)'}" 未内置对齐映射，回退 UTC/en-US。可在 COUNTRY_ALIGN_TABLE 中补充。`
  )
}

function normalizeCountry(country: string | null | undefined): string | null {
  if (!country) return null
  const code = country.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

/** 查表；未覆盖/非法输入返回 null（调用方决定是否回退） */
export function lookupCountryAlign(country: string | null | undefined): CountryAlignEntry | null {
  const code = normalizeCountry(country)
  return code ? (COUNTRY_ALIGN_TABLE[code] ?? null) : null
}

/**
 * 目标国家的 locale（传给 fingerprint-generator 保证 UA/语言一致，§6.5 第 3 条）。
 * 未覆盖国家回退 'en-US'。
 */
export function localeForCountry(country: string | null | undefined): string {
  return (lookupCountryAlign(country) ?? FALLBACK_ALIGN).language
}

/** 国家 → 对齐字段（未覆盖回退 UTC/en-US 并记日志） */
export function alignFieldsForCountry(country: string | null | undefined): AlignFields {
  const entry = lookupCountryAlign(country)
  if (!entry) {
    warnFallback(country)
    return {
      timezone: FALLBACK_ALIGN.timezone,
      language: FALLBACK_ALIGN.language,
      geolocation: null
    }
  }
  return {
    timezone: entry.timezone,
    language: entry.language,
    geolocation: { latitude: entry.geolocation.latitude, longitude: entry.geolocation.longitude }
  }
}

const TIMEZONE_TO_COUNTRY: ReadonlyMap<string, string> = new Map(
  Object.entries(COUNTRY_ALIGN_TABLE).map(([country, entry]) => [entry.timezone, country])
)

/** 反查：时区 → 国家（对齐字段未覆盖时返回 null） */
export function countryForTimezone(timezone: string): string | null {
  return TIMEZONE_TO_COUNTRY.get(timezone) ?? null
}
