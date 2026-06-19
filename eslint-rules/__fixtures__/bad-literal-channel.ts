// Fixture for `no-literal-channels` (AC-4) — the BAD case.
// Every IPC call below uses a NON-CONTRACT channel (raw string literal, a
// runtime-built string, a less-common channel-first method, or computed member
// access), so the rule MUST report on each. This file is intentionally
// non-conformant; it is never imported by the app.
import { ipcMain, ipcRenderer } from 'electron'

// --- plain string-literal channels ---
ipcMain.handle('smoke:config', () => ({}))
ipcMain.on('pty:start', () => {})
ipcRenderer.invoke('settings:get')
ipcRenderer.send('pty:input', 'x')
ipcRenderer.on('pty:data', () => {})

// --- Review 2026-06-18 patch coverage: previously-bypassing forms ---
// less-common channel-first methods
ipcRenderer.once('pty:exit', () => {})
ipcMain.handleOnce('watch:snapshot', () => ({}))
ipcRenderer.removeAllListeners('pty:data')
// computed (bracket) member access
ipcMain['on']('pty:resize', () => {})
// runtime-built channel: concatenation and interpolation
ipcRenderer.invoke('settings' + ':set')
const action = 'set'
ipcRenderer.send(`settings:${action}`, 1)
