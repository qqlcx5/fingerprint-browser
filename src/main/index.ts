import { app, safeStorage, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { createRequire } from 'module'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'
import { defineIpc, registerIpc } from './ipc'
import { setupStorage, closeStorage, getEnvDao } from './db'
import {
  initStatuses,
  cleanupOrphanChromium,
  stopAllRunning,
  getActiveEnvIds,
  getContext
} from './launcher'
import { registerEnvManagerIpc, pushNotice } from './envManager'
import { registerKernelIpc } from './kernel'
import { registerProxyIpc } from './proxy'
import icon from '../../resources/icon.png?asset'

const nodeRequire = createRequire(__filename)

/** 骨架自检：better-sqlite3 原生模块在 Electron ABI 下是否可用（01-T6） */
function sqliteAvailable(): boolean {
  try {
    nodeRequire('better-sqlite3')
    return true
  } catch {
    return false
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
/** E2E 冒烟模式：E2E_SMOKE=1 时无头自检 IPC 全链路后退出（CI/打包验收用） */
async function runSmoke(): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 用 about:blank 而非应用页面：避免 KernelGate 自动触发内核下载（300MB）
  await win.loadURL('about:blank')
  const res = await win.webContents.executeJavaScript(
    `(async () => {
      const ping = await window.api.ping()
      const created = await window.api.envCreate({ name: 'smoke-env' })
      const invalidProxy = await window.api.envCreate({
        name: 'invalid-proxy',
        proxyConfig: { type: 'ftp', host: '', port: 0 }
      })
      const list1 = await window.api.envList()
      const del = created.ok ? await window.api.envDelete({ id: created.data.id }) : created
      const list2 = await window.api.envList()
      const status = await window.api.envStatus()
      const notices = await window.api.appNotices()
      return { ping, created, invalidProxy, list1, del, list2, status, notices }
    })()`
  )
  console.log('E2E_PING', JSON.stringify(res.ping))
  console.log(
    'E2E_CRUD',
    JSON.stringify({
      created: res.created.ok,
      list1Count: res.list1.ok ? res.list1.data.length : -1,
      deleted: res.del.ok,
      list2Count: res.list2.ok ? res.list2.data.length : -1
    })
  )
  console.log('E2E_PROXY_VALIDATION', JSON.stringify(res.invalidProxy))
  console.log('E2E_STATUS', JSON.stringify(res.status))
  console.log('E2E_NOTICES', JSON.stringify(res.notices))

  let kernelFailureOk = true
  if (process.env['E2E_KERNEL_FAILURE'] === '1') {
    const failures = await win.webContents.executeJavaScript(
      `(async () => [await window.api.browserEnsure(), await window.api.browserEnsure()])()`
    )
    kernelFailureOk = failures.every(
      (result) => !result.ok && result.error.code === 'KERNEL_DOWNLOAD_FAILED'
    )
    console.log('E2E_KERNEL_FAILURE', JSON.stringify(failures))
  }

  let runtimeOk = true
  if (process.env['E2E_RUNTIME'] === '1') {
    const count = Math.max(1, Math.min(10, Number(process.env['E2E_RUNTIME_COUNT'] ?? '1')))
    const runtimeProxies = JSON.parse(process.env['E2E_RUNTIME_PROXIES'] ?? '[]') as unknown[]
    const runtime = await win.webContents.executeJavaScript(
      `(async () => {
        const proxyConfigs = ${JSON.stringify(runtimeProxies)}
        const created = await Promise.all(
          Array.from({ length: ${count} }, (_, i) =>
            window.api.envCreate({
              name: 'runtime-' + i,
              ...(proxyConfigs[i] ? { proxyConfig: proxyConfigs[i] } : {})
            })
          )
        )
        if (created.some((r) => !r.ok)) return { ok: false, phase: 'create' }
        const ids = created.map((r) => r.data.id)
        const startedAt = Date.now()
        const started = await Promise.all(ids.map((id) => window.api.envStart({ id })))
        const status = await window.api.envStatus()
        return { ok: started.every((r) => r.ok), ids, status, launchMs: Date.now() - startedAt }
      })()`
    )
    let cookiePersisted = false
    let cookieIsolated = count < 2
    let windowCloseIdle = false
    if (runtime.ok && runtime.ids.length > 0) {
      const id = runtime.ids[0] as string
      const first = getContext(id)
      if (first) {
        await first.addCookies([
          {
            name: 'fp_e2e',
            value: 'persisted',
            domain: 'example.com',
            path: '/',
            expires: Math.floor(Date.now() / 1_000) + 3_600
          }
        ])
        const other = runtime.ids[1] ? getContext(runtime.ids[1] as string) : undefined
        cookieIsolated =
          !!other &&
          !(await other.cookies('https://example.com')).some((cookie) => cookie.name === 'fp_e2e')
        await first.close() // 等价于用户关闭该环境的最后一个浏览器窗口
        const afterClose = await win.webContents.executeJavaScript(
          `window.api.envStatus().then((r) => r)`
        )
        windowCloseIdle = afterClose.ok && afterClose.data[id] === 'idle'
        const restarted = await win.webContents.executeJavaScript(
          `window.api.envStart({ id: ${JSON.stringify(id)} })`
        )
        const second = getContext(id)
        cookiePersisted =
          restarted.ok &&
          !!second &&
          (await second.cookies('https://example.com')).some(
            (cookie) => cookie.name === 'fp_e2e' && cookie.value === 'persisted'
          )
      }
    }
    const holdMs = Math.max(0, Number(process.env['E2E_RUNTIME_HOLD_MS'] ?? '0'))
    if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs))
    const stopped = await win.webContents.executeJavaScript(
      `(async () => {
        const ids = ${JSON.stringify(runtime.ids ?? [])}
        await Promise.all(ids.map((id) => window.api.envStop({ id })))
        return window.api.envStatus()
      })()`
    )
    const allIdle = stopped.ok && Object.values(stopped.data).every((status) => status === 'idle')
    runtimeOk =
      runtime.ok &&
      runtime.status.ok &&
      runtime.ids.every((id: string) => runtime.status.data[id] === 'running') &&
      windowCloseIdle &&
      cookiePersisted &&
      cookieIsolated &&
      allIdle
    console.log(
      'E2E_RUNTIME',
      JSON.stringify({
        count,
        launchMs: runtime.launchMs,
        started: runtime.ok,
        windowCloseIdle,
        cookiePersisted,
        cookieIsolated,
        allIdle
      })
    )
  }
  const pingOk = res.ping.ok && res.ping.data.pong === true && res.ping.data.sqlite === true
  const crudOk =
    res.created.ok &&
    res.del.ok &&
    res.list1.ok &&
    res.list1.data.length === 1 &&
    res.list2.ok &&
    res.list2.data.length === 0 &&
    res.status.ok &&
    Object.values(res.status.data).every((s) => s === 'idle')
  const proxyValidationOk = !res.invalidProxy.ok && res.invalidProxy.error.code === 'VALIDATION'
  console.log(
    'E2E_RESULT',
    pingOk && crudOk && proxyValidationOk && kernelFailureOk && runtimeOk ? 'PASS' : 'FAIL'
  )
  app.exit(pingOk && crudOk && proxyValidationOk && kernelFailureOk && runtimeOk ? 0 : 1)
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.fingerprint-browser.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 骨架自检通道（01-T5/T6 验收）
  defineIpc(IPC.appPing, () => ({
    pong: true as const,
    version: app.getVersion(),
    arch: process.arch,
    sqlite: sqliteAvailable()
  }))

  // 统一接线：已定义通道走处理器，未定义通道返回 NOT_IMPLEMENTED 占位
  // 存储层需在 registerIpc() 前就绪（db/index.ts 约定）
  // 冒烟模式用临时 userData，不碰用户真实数据（需在任何存储初始化前设置）
  if (process.env['E2E_SMOKE'] === '1') {
    app.setPath('userData', join(tmpdir(), `fp-smoke-${Date.now()}`))
  }

  const storage = setupStorage()
  if (storage.reset) {
    // §9：库损坏已自动重建 → 启动期通知，渲染层挂载后拉取（07-T9）
    pushNotice('db_reset', '数据库曾损坏，已自动重建；环境列表为空属预期')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    pushNotice('weak_encryption', '系统安全加密不可用，代理密码将以混淆方式存储（§8）')
  }
  // 运行状态初始化（§5：不落库，启动时全部 idle）+ 孤儿 Chromium 清理（06-T1/T5）
  initStatuses(
    getEnvDao()
      .listEnvs()
      .map((r) => r.id)
  )
  void cleanupOrphanChromium()
  registerKernelIpc()
  registerProxyIpc()
  registerEnvManagerIpc()
  registerIpc()

  // 退出前先逐环境优雅停止（06-T7），再落盘（05-WAL checkpoint）
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) {
      closeStorage()
      return
    }
    if (getActiveEnvIds().length === 0) {
      closeStorage()
      return
    }
    e.preventDefault()
    quitting = true
    void stopAllRunning().finally(() => {
      closeStorage()
      app.quit()
    })
  })

  if (process.env['E2E_SMOKE'] === '1') {
    void runSmoke()
    return
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
