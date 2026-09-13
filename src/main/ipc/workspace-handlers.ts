import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { isString, isObject, isOptionalBoolean, isOptionalString } from './validation'
import { validateStartOptions, applyResumePreference, applyPermissionModeToStartOptions } from './pi-start-options'
import { loadAppSettings } from './settings'
import type { WorkspaceTabOptions } from '../../shared/ipc-contracts'
import { isWithinSessionRoots } from '../pi-paths'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve } from 'path'
import { isPathWithin } from '../path-authorization'
import type { IpcContext } from './context'
import { appLog } from '../app-log'

function assertAuthorizedWorkspacePath(
  workspaceManager: IpcContext['workspaceManager'],
  candidatePath: string
): string {
  const resolved = resolve(candidatePath)
  const matched = workspaceManager.getWorkspaces().find((w) => resolve(w.path) === resolved)
  if (!matched) {
    throw new Error(`Unauthorized workspace path: ${candidatePath}`)
  }
  return matched.path
}

function validateWorkspaceTabOptions(value: unknown): WorkspaceTabOptions {
  if (value === undefined || value === null) return {}
  if (!isObject(value)) throw new Error('Tab options must be an object')
  if (!isOptionalString(value.name)) throw new Error('tab name must be a string')
  if (!isOptionalString(value.sourceWorkspaceId)) throw new Error('sourceWorkspaceId must be a string')
  if (!isOptionalString(value.forkSessionPath)) throw new Error('forkSessionPath must be a string')
  if (!isOptionalString(value.taskPrompt)) throw new Error('taskPrompt must be a string')
  if (!isOptionalBoolean(value.startPi)) throw new Error('startPi must be a boolean')

  return {
    ...(isString(value.name) ? { name: value.name } : {}),
    ...(isString(value.sourceWorkspaceId) ? { sourceWorkspaceId: value.sourceWorkspaceId } : {}),
    ...(isString(value.forkSessionPath) ? { forkSessionPath: value.forkSessionPath } : {}),
    ...(isString(value.taskPrompt) ? { taskPrompt: value.taskPrompt } : {}),
    ...(typeof value.startPi === 'boolean' ? { startPi: value.startPi } : {}),
  }
}

export function registerWorkspaceHandlers(ctx: IpcContext): void {
  const { workspaceManager, notesManager } = ctx

  // ─── Workspace Management ───────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_LIST, async () => {
    return workspaceManager.getWorkspaces()
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE, async (_event, name: unknown, path: unknown) => {
    if (!isString(name)) throw new Error('name must be a string')
    if (!isString(path)) throw new Error('path must be a string')
    return workspaceManager.createWorkspace(name, path)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REMOVE, async (_event, workspaceId: unknown) => {
    if (!isString(workspaceId)) throw new Error('workspaceId must be a string')
    const result = await workspaceManager.removeWorkspace(workspaceId)
    // Notes scoped to the removed workspace fall back to global so they survive.
    await notesManager.reassignToGlobal(workspaceId)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RENAME, async (_event, workspaceId: unknown, name: unknown) => {
    if (!isString(workspaceId)) throw new Error('workspaceId must be a string')
    if (!isString(name)) throw new Error('name must be a string')
    await workspaceManager.renameWorkspace(workspaceId, name)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CHANGE_PATH, async (_event, workspaceId: unknown, newPath: unknown) => {
    if (!isString(workspaceId)) throw new Error('workspaceId must be a string')
    if (!isString(newPath)) throw new Error('newPath must be a string')
    await workspaceManager.changeWorkspacePath(workspaceId, newPath)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_PATH_EXISTS, async (): Promise<boolean> => {
    return workspaceManager.activeWorkspacePathExists()
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, async (_event, workspaceId: unknown) => {
    if (!isString(workspaceId)) throw new Error('workspaceId must be a string')
    return workspaceManager.setActiveWorkspace(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_ACTIVE, async () => {
    return workspaceManager.getActiveWorkspace()
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_START_PI, async (_event, workspaceId: unknown, options?: unknown) => {
    if (!isString(workspaceId)) throw new Error('workspaceId must be a string')
    const opts = validateStartOptions(options)
    const settings = await loadAppSettings(workspaceManager)
    const workspace = workspaceManager.getWorkspaces().find((w) => w.id === workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    await workspaceManager.startPiForWorkspace(
      workspaceId,
      applyPermissionModeToStartOptions(
        applyResumePreference({ cwd: workspace.path, ...opts }, settings),
        settings
      )
    )
    const pi = workspaceManager.getPiManager(workspaceId)
    return pi?.getStatus() ?? { status: 'stopped', pid: null, error: null }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_STOP_PI, async (_event, workspaceId: unknown) => {
    if (!isString(workspaceId)) throw new Error('workspaceId must be a string')
    workspaceManager.stopPiForWorkspace(workspaceId)
    return { status: 'stopped', pid: null, error: null }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE_TAB, async (_event, value: unknown) => {
    const options = validateWorkspaceTabOptions(value)
    if (options.forkSessionPath) {
      if (!isWithinSessionRoots(options.forkSessionPath) || !existsSync(options.forkSessionPath)) {
        throw new Error('forkSessionPath must point to an existing Pi session file')
      }
    }

    const settings = await loadAppSettings(workspaceManager)
    const workspace = await workspaceManager.createWorktreeWorkspace(options)
    // Return the new project tab immediately. Its session runtime starts in the
    // background so the tab/file contents are usable before Pi is ready. A task
    // launch may explicitly skip this default runtime to avoid two Pi processes
    // in the freshly-created worktree.
    if (options.startPi !== false) void workspaceManager.startPiForWorkspace(
      workspace.id,
      applyPermissionModeToStartOptions(
        applyResumePreference(
          {
            cwd: workspace.path,
            provider: settings.defaultProvider ?? undefined,
            model: settings.defaultModel ?? undefined,
            forkSessionPath: options.forkSessionPath,
          },
          settings
        ),
        settings
      )
    ).catch((error) => appLog.warn('workspaces', 'Background worktree Pi start failed', error))
    return workspace
  })

  // ─── Project Memory & Instructions ──────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_MEMORY, async (_event, workspacePath: unknown) => {
    if (!isString(workspacePath)) throw new Error('workspacePath must be a string')
    const wsPath = assertAuthorizedWorkspacePath(workspaceManager, workspacePath)
    const antaMemory = join(wsPath, '.anta-harness', 'memory.json')
    const piMemory = join(wsPath, '.pi', 'memory.json')
    const memoryFile =
      isPathWithin(wsPath, antaMemory) && existsSync(antaMemory)
        ? antaMemory
        : isPathWithin(wsPath, piMemory) && existsSync(piMemory)
          ? piMemory
          : null
    if (!memoryFile) {
      return { memory: { entries: [] } }
    }
    try {
      const raw = await readFile(memoryFile, 'utf-8')
      const parsed = JSON.parse(raw)
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
      return { memory: { entries } }
    } catch {
      return { memory: { entries: [] } }
    }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SAVE_MEMORY, async (_event, workspacePath: unknown, entries: unknown) => {
    if (!isString(workspacePath)) throw new Error('workspacePath must be a string')
    const wsPath = assertAuthorizedWorkspacePath(workspaceManager, workspacePath)
    if (!Array.isArray(entries)) throw new Error('entries must be an array')
    if (entries.length > 500) throw new Error('Too many memory entries (max 500)')

    const sanitizedEntries = entries.map((raw, idx) => {
      if (!raw || typeof raw !== 'object') throw new Error(`Entry ${idx} must be an object`)
      const e = raw as Record<string, unknown>
      if (!isString(e.id)) throw new Error(`Entry ${idx} id must be a string`)
      if (e.key !== undefined && !isString(e.key)) throw new Error(`Entry ${idx} key must be a string`)
      if (e.title !== undefined && !isString(e.title)) throw new Error(`Entry ${idx} title must be a string`)
      if (!isString(e.content)) throw new Error(`Entry ${idx} content must be a string`)
      if (e.content.length > 32_768) throw new Error(`Entry ${idx} content exceeds 32KB limit`)
      if (e.category !== undefined && !isString(e.category)) throw new Error(`Entry ${idx} category must be a string`)
      if (e.updatedAt !== undefined && typeof e.updatedAt !== 'number') throw new Error(`Entry ${idx} updatedAt must be a number`)
      return {
        id: e.id,
        ...(e.key ? { key: e.key } : {}),
        ...(e.title ? { title: e.title } : {}),
        content: e.content,
        ...(e.category ? { category: e.category } : {}),
        updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now(),
      }
    })

    const antaDir = join(wsPath, '.anta-harness')
    const piDir = join(wsPath, '.pi')
    const targetDir = existsSync(antaDir) || !existsSync(piDir) ? antaDir : piDir
    const memoryFile = join(targetDir, 'memory.json')
    if (!isPathWithin(wsPath, memoryFile)) throw new Error('Target file is outside workspace')

    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true })
    }
    await writeFile(memoryFile, JSON.stringify({ entries: sanitizedEntries }, null, 2), 'utf-8')
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_INSTRUCTIONS, async (_event, workspacePath: unknown) => {
    if (!isString(workspacePath)) throw new Error('workspacePath must be a string')
    const wsPath = assertAuthorizedWorkspacePath(workspaceManager, workspacePath)
    const candidates = [
      join(wsPath, '.anta-harness', 'instructions.md'),
      join(wsPath, '.pi', 'instructions.md'),
      join(wsPath, 'AGENTS.md'),
      join(wsPath, '.cursorrules'),
      join(wsPath, '.agents', 'rules'),
    ]
    for (const candidate of candidates) {
      if (isPathWithin(wsPath, candidate) && existsSync(candidate)) {
        const content = await readFile(candidate, 'utf-8')
        return { instructions: content, sourcePath: candidate }
      }
    }
    return { instructions: '', sourcePath: join(wsPath, '.anta-harness', 'instructions.md') }
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SAVE_INSTRUCTIONS, async (_event, workspacePath: unknown, content: unknown, targetPath?: unknown) => {
    if (!isString(workspacePath)) throw new Error('workspacePath must be a string')
    if (!isString(content)) throw new Error('content must be a string')
    if (content.length > 256 * 1024) throw new Error('Instructions exceed 256KB limit')
    const wsPath = assertAuthorizedWorkspacePath(workspaceManager, workspacePath)

    let destination: string
    if (isString(targetPath) && targetPath.trim()) {
      destination = resolve(targetPath)
      if (!isPathWithin(wsPath, destination)) {
        throw new Error('targetPath must be within the workspace')
      }
    } else {
      const antaDir = join(wsPath, '.anta-harness')
      const piDir = join(wsPath, '.pi')
      const targetDir = existsSync(antaDir) || !existsSync(piDir) ? antaDir : piDir
      if (!existsSync(targetDir)) {
        await mkdir(targetDir, { recursive: true })
      }
      destination = join(targetDir, 'instructions.md')
    }

    const destDir = join(destination, '..')
    if (!existsSync(destDir)) {
      await mkdir(destDir, { recursive: true })
    }
    await writeFile(destination, content, 'utf-8')
    return { success: true, sourcePath: destination }
  })
}
