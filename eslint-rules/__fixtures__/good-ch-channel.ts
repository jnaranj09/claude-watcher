// Fixture for `no-literal-channels` (AC-4) — the GOOD case.
// Every IPC call routes its channel through a CH.* const from the typed
// contract, so the rule reports ZERO violations here. This is the conformant
// pattern the whole codebase must follow.
import { ipcMain, ipcRenderer } from 'electron'
import { CH } from '../../src/shared/ipc/contract'

ipcMain.handle(CH.smokeConfig, () => ({}))
ipcMain.on(CH.ptyStart, () => {})
ipcRenderer.invoke(CH.settingsGet)
ipcRenderer.send(CH.ptyInput, 'x')
ipcRenderer.on(CH.ptyData, () => {})
