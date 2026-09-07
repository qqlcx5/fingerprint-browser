/**
 * 启动/停止与生命周期模块（06）公共出口。
 *
 * 接线方式（已由集成写入 src/main/index.ts）：
 *   app.whenReady：initStatuses(dao.listEnvs().map(r => r.id)) → cleanupOrphanChromium()
 *   before-quit：stopAllRunning() → closeStorage()
 * env:start / env:stop / env:status IPC 由 07-env-manager 编排（launchEnv/stopEnv/getStatusMap）。
 */
export { initStatuses, getStatus, getStatusMap, getActiveEnvIds, setStatus } from './status'
export { launchEnv, getContext, cancelLaunch, type LaunchResult } from './launch'
export { stopEnv, stopAllRunning } from './stop'
export { cleanupOrphanChromium, killByProfileDir } from './orphan'
