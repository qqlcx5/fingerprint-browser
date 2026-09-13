import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LINUX_AUTOSTART_FILENAME,
  buildLinuxDesktopEntry,
  linuxAutostartPath,
  linuxLaunchExec,
  quoteDesktopExec,
} from './autostart-linux'

test('linuxAutostartPath falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
  const path = linuxAutostartPath({}, '/home/alice')
  assert.equal(path, `/home/alice/.config/autostart/${LINUX_AUTOSTART_FILENAME}`)
})

test('linuxAutostartPath honors XDG_CONFIG_HOME', () => {
  const path = linuxAutostartPath({ XDG_CONFIG_HOME: '/custom/cfg' }, '/home/alice')
  assert.equal(path, `/custom/cfg/autostart/${LINUX_AUTOSTART_FILENAME}`)
})

test('linuxAutostartPath ignores a blank XDG_CONFIG_HOME', () => {
  const path = linuxAutostartPath({ XDG_CONFIG_HOME: '   ' }, '/home/alice')
  assert.equal(path, `/home/alice/.config/autostart/${LINUX_AUTOSTART_FILENAME}`)
})

test('linuxLaunchExec prefers APPIMAGE over execPath', () => {
  assert.equal(
    linuxLaunchExec({ APPIMAGE: '/opt/Anta-Harness.AppImage' }, '/tmp/.mount_x/anta-harness'),
    '/opt/Anta-Harness.AppImage',
  )
})

test('linuxLaunchExec falls back to execPath when APPIMAGE is absent', () => {
  assert.equal(linuxLaunchExec({}, '/usr/bin/anta-harness'), '/usr/bin/anta-harness')
})

test('quoteDesktopExec wraps in double quotes and escapes special chars', () => {
  assert.equal(quoteDesktopExec('/opt/Anta Harness/app'), '"/opt/Anta Harness/app"')
  assert.equal(quoteDesktopExec('/a\\b'), '"/a\\\\b"')
  assert.equal(quoteDesktopExec('/a"b'), '"/a\\"b"')
})

test('buildLinuxDesktopEntry produces a valid, complete desktop entry', () => {
  const entry = buildLinuxDesktopEntry({ exec: '/opt/Anta-Harness.AppImage', icon: '/opt/icon.png' })
  const lines = entry.split('\n')

  assert.equal(lines[0], '[Desktop Entry]')
  assert.ok(lines.includes('Type=Application'))
  assert.ok(lines.includes('Name=Anta Harness'))
  assert.ok(lines.includes('Exec="/opt/Anta-Harness.AppImage"'))
  assert.ok(lines.includes('Icon=/opt/icon.png'))
  assert.ok(lines.includes('Terminal=false'))
  assert.ok(lines.includes('X-GNOME-Autostart-enabled=true'))
  // Trailing newline so the file ends cleanly.
  assert.ok(entry.endsWith('\n'))
})
