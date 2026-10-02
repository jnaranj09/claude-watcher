// Every main IPC listener goes through `createRendererIpc` (src/main/ipc/trustedIpc.ts), which
// answers only the app's own renderer (technical-taste §5b-22). So only `main/index.ts`, which
// builds that wrapper, may hold Electron's `ipcMain` — under any local name. A namespace, default
// or `require('electron')` import would hand out `ipcMain` as a property, so main never uses one.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { SRC, electronImports, parseSource, sourceFiles, srcRel } from './sourceScan'

const scan = (text: string): ReturnType<typeof electronImports> =>
  electronImports(parseSource(join(SRC, 'main/x.ts'), text))

describe('electronImports', () => {
  it('sees ipcMain under an alias, and ignores type-only imports', () => {
    expect(
      scan(
        "import { app, ipcMain as m } from 'electron'\nimport type { IpcMain } from 'electron'\nimport { type IpcMainEvent } from 'electron'\n"
      )
    ).toEqual({ named: ['app', 'ipcMain'], whole: 0 })
  })

  it('counts namespace, default and require imports as whole-module', () => {
    expect(
      scan(
        "import * as e from 'electron'\nimport electron from 'electron'\nconst x = require('electron')\n"
      )
    ).toEqual({ named: [], whole: 3 })
  })
})

describe('ipcMain import guard', () => {
  it('only main/index.ts imports ipcMain, and no main file imports electron whole', () => {
    const offenders = sourceFiles()
      .filter((f) => srcRel(f).startsWith('main/'))
      .flatMap((f) => {
        const r = electronImports(parseSource(f))
        const rel = srcRel(f)
        const hits: string[] = []
        if (r.named.includes('ipcMain') && rel !== 'main/index.ts') hits.push(`${rel} ipcMain`)
        if (r.whole > 0) hits.push(`${rel} whole-module electron import`)
        return hits
      })
    expect(offenders).toEqual([])
  })
})
