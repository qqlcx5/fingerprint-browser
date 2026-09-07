/**
 * 孤儿 Chromium 清理（06-T5）
 *
 * 场景：主进程上次崩溃/被强杀，Chromium 进程还挂着各环境的 profile 目录。
 * 应用启动时按命令行匹配「本应用 userData 下的 envs/{id}/profile」逐一强杀。
 * 只精确匹配本应用路径，绝不误杀用户其他 Chromium。
 */
import { execFile } from 'child_process'
import { app } from 'electron'
import { getLogger } from '../db'
import { envProfileDir } from '../../shared/paths'

function listProcesses(): Promise<{ pid: number; args: string }[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // PowerShell 一次性枚举；启动期调用，延迟可接受
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'
        ],
        { timeout: 15_000 },
        (err, stdout) => {
          if (err) return resolve([])
          const rows = String(stdout)
            .split(/\r?\n/)
            .map((line) => {
              const m = line.match(/^\s*(\d+)\t(.*)$/)
              return m ? { pid: Number(m[1]), args: m[2] } : null
            })
            .filter((x): x is { pid: number; args: string } => x !== null)
          resolve(rows)
        }
      )
      return
    }
    execFile('ps', ['-Ao', 'pid=,args='], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve([])
      const rows = String(stdout)
        .split(/\n/)
        .map((line) => {
          const t = line.trim()
          const sp = t.indexOf(' ')
          return sp > 0 ? { pid: Number(t.slice(0, sp)), args: t.slice(sp + 1) } : null
        })
        .filter((x): x is { pid: number; args: string } => x !== null)
      resolve(rows)
    })
  })
}

function kill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // /T 连带子进程树
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve())
    } else {
      process.kill(pid, 'SIGKILL')
      resolve()
    }
  })
}

/** 启动时清理：杀掉所有占用本应用 envs/{id}/profile 的孤儿进程 */
export async function cleanupOrphanChromium(): Promise<number> {
  const envsRoot = envProfileDir('').split('/profile')[0] // userData/envs
  const rows = await listProcesses()
  let killed = 0
  for (const row of rows) {
    // 精确路径段匹配，避免误杀（如编辑器打开该目录的场景命令行不含 profile 段）
    if (!row.args.includes(envsRoot)) continue
    if (!/profile[\\/]?(\s|$|"|')/.test(row.args) && !row.args.includes('chrom')) continue
    if (row.pid === process.pid) continue
    await kill(row.pid)
    killed++
  }
  if (killed > 0) getLogger().warn('launcher.orphans_cleaned', { count: killed, envsRoot })
  return killed
}

/** 供 06-T3 强杀兜底：按单个环境的 profile 目录精确清理 */
export async function killByProfileDir(id: string): Promise<void> {
  const profile = envProfileDir(id)
  const rows = await listProcesses()
  for (const row of rows) {
    if (row.args.includes(profile) && row.pid !== process.pid) await kill(row.pid)
  }
}

/** 避免 app 未 ready 时误调用（execFile 与路径解析不依赖 ready，此处仅防御） */
export function orphanCleanupAvailable(): boolean {
  return !!app.getPath('userData')
}
