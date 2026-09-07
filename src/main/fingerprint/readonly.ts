/**
 * 核心指纹只读保障（05-T3，需求文档 §6.5 / §5）。
 *
 * 三道约束：
 * 1. deepFreeze：运行时深冻结，任何流程拿到 Env 后改字段即抛 TypeError（strict mode）
 * 2. ReadonlyCoreFingerprint：编译期类型约束（见 shared/types.ts）
 * 3. assertNoProtectedUpdate：DAO 层断言——env:update 的 patch 禁止携带 fingerprint
 *
 * 02-storage 集成点：
 * - 读取 environments 行后经 freezeCoreFingerprint() 冻结再返回
 * - updateEnv() 入口调用 assertNoProtectedUpdate(patch)
 */
import type { CoreFingerprint, ReadonlyCoreFingerprint } from '../../shared/types'

/** 递归冻结对象及其所有嵌套属性（含数组元素），返回冻结后的只读视图 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value as Readonly<T>
  }
  Object.freeze(value)
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value as Readonly<T>
}

/** 冻结核心指纹（数据库行 → Env 出口处调用；原地冻结调用方持有的对象） */
export function freezeCoreFingerprint(fp: CoreFingerprint): ReadonlyCoreFingerprint {
  return deepFreeze(fp)
}

/**
 * 禁止经 update 流程改写的字段（§6.5：核心指纹永久只读；
 * alignFields/proxyConfig 等可变字段不在列）。
 */
export const PROTECTED_ENV_FIELDS: readonly string[] = Object.freeze(['fingerprint'])

/**
 * DAO 层断言：patch 携带受保护字段时抛错（阻止"改写核心指纹"的代码路径）。
 * 抛出的 Error 经 ipc.toAppError 归为 INTERNAL——触发即接线错误，不是用户错误。
 */
export function assertNoProtectedUpdate(patch: Record<string, unknown>): void {
  for (const field of PROTECTED_ENV_FIELDS) {
    if (field in patch) {
      throw new Error(`环境更新 patch 含只读字段 "${field}"（核心指纹生成后永久只读，§6.5）`)
    }
  }
}
