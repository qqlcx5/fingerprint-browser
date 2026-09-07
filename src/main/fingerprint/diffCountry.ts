/**
 * 国家变更检测（05-T4，需求文档 §6.5 第 2 条）。
 *
 * 更换代理且出口国家变化时，由 07 在 env:start 流程调用：
 * 先 diffCountry 判断是否需要确认，changed=true 则返回 COUNTRY_CHANGED
 * 给渲染层弹窗；用户 accept 后 07 用 alignFieldsForCountry(to) 更新对齐字段
 * （核心指纹不动）。
 *
 * "from" 的来源：环境当前对齐字段反查国家（countryOfAlign）。
 * 反查不到（UTC 回退/手动改过时区）按 null 处理——视为需要对齐。
 */
import { countryForTimezone } from './align'
import type { AlignFields } from '../../shared/types'

export interface CountryDiff {
  /** true = 出口国家变化，需走确认流（COUNTRY_CHANGED） */
  changed: boolean
  /** 环境当前对齐国家；null = 未知（直连基线/回退时区/未对齐过） */
  from: string | null
  /** 新代理出口国家；null = 测连未取得国家（此时不触发确认流） */
  to: string | null
}

/** 由环境当前对齐字段反查其对应国家（时区为唯一稳定键） */
export function countryOfAlign(align: AlignFields): string | null {
  return countryForTimezone(align.timezone)
}

/**
 * 比较环境当前对齐国家与新代理出口国家。
 *
 * - to === null：测连未取得国家 → 不触发确认流（changed=false）
 * - from === null 且 to 非空：从未对齐过 → 视为变化（对齐到新国家）
 * - from === to：直连换直连等 → 无需确认
 */
export function diffCountry(from: string | null, to: string | null): CountryDiff {
  if (to === null) {
    return { changed: false, from, to: null }
  }
  return { changed: from !== to, from, to }
}

/**
 * 便捷封装：直接从对齐字段出发比较（供 07 一行调用）。
 * 组装 COUNTRY_CHANGED 载荷时补 envId 即得 CountryChangeInfo。
 */
export function diffAlignCountry(
  currentAlign: AlignFields,
  newEgressCountry: string | null
): CountryDiff {
  return diffCountry(countryOfAlign(currentAlign), newEgressCountry)
}
