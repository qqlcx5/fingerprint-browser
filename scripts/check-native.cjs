// 01-T6 验收脚本：在 Electron 运行时验证 better-sqlite3 原生模块可用
// 用法：pnpm exec electron scripts/check-native.cjs
const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (x TEXT)')
    db.prepare('INSERT INTO t (x) VALUES (?)').run('ok')
    const row = db.prepare('SELECT sqlite_version() AS v').get()
    console.log('NATIVE_OK sqlite_version=' + row.v)
    db.close()
    process.exit(0)
  } catch (e) {
    console.error('NATIVE_FAIL ' + e.message)
    process.exit(1)
  }
})
