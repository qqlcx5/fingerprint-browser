/**
 * 指纹模块（05）公共出口。
 *
 * 两段式（需求文档 §6.5）：
 * - 创建环境（07-T1）：generateCoreFingerprint(country) + alignFieldsForCountry(country)
 *   → freezeCoreFingerprint 后与对齐字段一并入库
 * - 读取（02）：freezeCoreFingerprint / assertNoProtectedUpdate（只读保障）
 * - 启动（06-T2）：buildFingerprintLaunchOptions + injectFingerprint
 * - 换代理（07-T2）：diffAlignCountry → COUNTRY_CHANGED 确认流
 *
 * 本模块无 IPC 通道（alignConfirm 由 07 实现），集成阶段无需接入 index.ts。
 */
export * from './align'
export * from './generate'
export * from './readonly'
export * from './diffCountry'
export * from './inject'
export * from './validate'
export * from './warnings'
