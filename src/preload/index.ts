/**
 * preload：contextBridge 白名单入口（冻结文件，见 doc/tasks/parallel-plan.md §3）
 * 只暴露 shared/types.ts 中 Api 接口列出的方法；返回 Result 信封，永不 throw。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/types'
import type { Api, EnvStatusMap, DownloadProgress, CrashedInfo } from '../shared/types'

function subscribe<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: T): void => cb(data)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  ping: () => ipcRenderer.invoke(IPC.appPing),
  envList: () => ipcRenderer.invoke(IPC.envList),
  envGet: (input) => ipcRenderer.invoke(IPC.envGet, input),
  envCreate: (input) => ipcRenderer.invoke(IPC.envCreate, input),
  envUpdate: (input) => ipcRenderer.invoke(IPC.envUpdate, input),
  envUpdateFingerprint: (input) => ipcRenderer.invoke(IPC.envUpdateFingerprint, input),
  envDelete: (input) => ipcRenderer.invoke(IPC.envDelete, input),
  envStart: (input) => ipcRenderer.invoke(IPC.envStart, input),
  envStop: (input) => ipcRenderer.invoke(IPC.envStop, input),
  envStatus: () => ipcRenderer.invoke(IPC.envStatus),
  proxyTest: (input) => ipcRenderer.invoke(IPC.proxyTest, input),
  proxyCsvPreview: (input) => ipcRenderer.invoke(IPC.proxyCsvPreview, input),
  envProxyRebind: (input) => ipcRenderer.invoke(IPC.envProxyRebind, input),
  envSecurityGet: (input) => ipcRenderer.invoke(IPC.envSecurityGet, input),
  envSecurityUpdate: (input) => ipcRenderer.invoke(IPC.envSecurityUpdate, input),
  envTotpEnable: (input) => ipcRenderer.invoke(IPC.envTotpEnable, input),
  envTotpClear: (input) => ipcRenderer.invoke(IPC.envTotpClear, input),
  envTotpCode: (input) => ipcRenderer.invoke(IPC.envTotpCode, input),
  browserEnsure: () => ipcRenderer.invoke(IPC.browserEnsure),
  alignConfirm: (input) => ipcRenderer.invoke(IPC.alignConfirm, input),
  appNotices: () => ipcRenderer.invoke(IPC.appNotices),
  appWipeData: () => ipcRenderer.invoke(IPC.appWipeData),
  envExport: () => ipcRenderer.invoke(IPC.envExport),
  envImport: () => ipcRenderer.invoke(IPC.envImport),
  appLogs: () => ipcRenderer.invoke(IPC.appLogs),
  appStartupGet: () => ipcRenderer.invoke(IPC.appStartupGet),
  appStartupSet: (input) => ipcRenderer.invoke(IPC.appStartupSet, input),
  onStatusChanged: (cb: (status: EnvStatusMap) => void) =>
    subscribe<EnvStatusMap>(IPC.envStatusChanged, cb),
  onCrashed: (cb: (info: CrashedInfo) => void) => subscribe<CrashedInfo>(IPC.envCrashed, cb),
  onDownloadProgress: (cb: (progress: DownloadProgress) => void) =>
    subscribe<DownloadProgress>(IPC.browserDownloadProgress, cb)
}

// contextIsolation 必须开启（需求文档 §8）；走到 else 说明安全配置被改坏
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  throw new Error('contextIsolation 必须开启：请检查 BrowserWindow webPreferences')
}
