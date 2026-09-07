/**
 * 彻底清除数据（07-T8，§8"彻底清除数据"入口）
 *
 * 范围：db 文件（含 WAL/SHM）+ userData/envs/ 全部环境数据目录。
 * 保留：内核（避免重下 300MB）与日志。二次确认由 UI 负责。
 * 流程：停全部运行环境 → 关库 → 删文件 → 重建空库 → 状态表清零。
 */
import { rmSync } from 'fs'
import { join } from 'path'
import { closeStorage, getEnvDao, getLogger, setupStorage } from '../db'
import { initStatuses, stopAllRunning } from '../launcher'
import { pushNotice } from './notices'
import { dbFile, dataRoot } from '../../shared/paths'

export async function wipeAllData(): Promise<{ wipedEnvs: number }> {
  const ids = getEnvDao()
    .listEnvs()
    .map((r) => r.id)

  await stopAllRunning()
  closeStorage()

  for (const f of [dbFile(), `${dbFile()}-wal`, `${dbFile()}-shm`]) {
    rmSync(f, { force: true })
  }
  rmSync(join(dataRoot(), 'envs'), { recursive: true, force: true })

  const storage = setupStorage()
  initStatuses([])
  if (storage.reset) {
    pushNotice('db_reset', '数据已彻底清除，环境列表为空属预期')
  }
  getLogger().info('envManager.wiped', { count: ids.length })
  return { wipedEnvs: ids.length }
}
