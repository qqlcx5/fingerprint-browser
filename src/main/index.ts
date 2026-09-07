import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { createRequire } from 'module'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'
import { defineIpc, registerIpc } from './ipc'
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
  await win.loadFile(join(__dirname, '../renderer/index.html'))
  const res = await win.webContents.executeJavaScript(
    `(async () => {
      const ping = await window.api.ping()
      const list = await window.api.envList()
      return { ping, list }
    })()`
  )
  console.log('E2E_PING', JSON.stringify(res.ping))
  console.log('E2E_LIST', JSON.stringify(res.list))
  const pingOk = res.ping.ok && res.ping.data.pong === true && res.ping.data.sqlite === true
  const listOk = !res.list.ok && res.list.error.code === 'NOT_IMPLEMENTED'
  console.log('E2E_RESULT', pingOk && listOk ? 'PASS' : 'FAIL')
  app.exit(pingOk && listOk ? 0 : 1)
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
  registerIpc()

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
