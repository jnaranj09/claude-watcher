// Layers (technical-taste §5b-16): `shared` imports no app layer; `renderer` and `preload` never
// import `main`; `main` never imports `renderer` or `preload`. The tree was clean only by
// convention — this guard turns the next cross-layer import red. The bridge mod (`src/mod/<name>/`)
// runs inside claude's engine: it imports only its own folder and `claude-code`, and no app layer
// imports it (spec 2026-10-18 §1.3).
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { SRC, importSpecifiers, layerViolations, parseSource, sourceFiles } from './sourceScan'

const at = (rel: string, text: string): string[] =>
  layerViolations(join(SRC, rel), importSpecifiers(parseSource(join(SRC, rel), text)))

describe('layer guard', () => {
  it('flags shared importing main', () => {
    expect(at('shared/a.ts', "import { x } from '../main/profile'\n")).toEqual([
      'shared/a.ts → main/profile'
    ])
  })

  it('flags a type-only electron import in the renderer', () => {
    expect(at('renderer/src/a.ts', "import type { BrowserWindow } from 'electron'\n")).toEqual([
      'renderer/src/a.ts → electron'
    ])
  })

  it('flags a re-export and a dynamic import across layers', () => {
    expect(
      at('shared/b.ts', "export * from '../renderer/x'\nvoid import('../preload/y')\n")
    ).toEqual(['shared/b.ts → renderer/x', 'shared/b.ts → preload/y'])
  })

  it('allows every layer to import shared, and main to import electron', () => {
    expect(
      at('main/a.ts', "import { app } from 'electron'\nimport '../shared/ipc/contract'\n")
    ).toEqual([])
    expect(at('renderer/src/a.ts', "import '../../shared/ipc/contract'\n")).toEqual([])
  })

  it('flags a bridge mod file importing outside its own folder', () => {
    expect(
      at('mod/watcher-bridge/hooks/a.ts', "import { x } from '../../../main/profile'\n")
    ).toEqual(['mod/watcher-bridge/hooks/a.ts → main/profile'])
    expect(at('mod/watcher-bridge/hooks/a.ts', "import { x } from '../../other-mod/x'\n")).toEqual([
      'mod/watcher-bridge/hooks/a.ts → mod/other-mod/x'
    ])
  })

  it('flags a bridge mod file importing a package other than the engine', () => {
    expect(at('mod/watcher-bridge/hooks/a.ts', "import 'node:fs'\n")).toEqual([
      'mod/watcher-bridge/hooks/a.ts → node:fs'
    ])
  })

  it('allows a bridge mod file to import its own folder and the engine', () => {
    expect(
      at(
        'mod/watcher-bridge/hooks/register.ts',
        "import type { Register } from 'claude-code'\nimport { buildReport } from './report'\n"
      )
    ).toEqual([])
  })

  it('flags an app layer importing the bridge mod', () => {
    expect(
      at('main/a.ts', "import { buildReport } from '../mod/watcher-bridge/hooks/report'\n")
    ).toEqual(['main/a.ts → mod/watcher-bridge/hooks/report'])
    expect(at('shared/a.ts', "import '../mod/watcher-bridge/hooks/report'\n")).toEqual([
      'shared/a.ts → mod/watcher-bridge/hooks/report'
    ])
  })

  it('the real tree has no cross-layer import', () => {
    const hits = sourceFiles({ declarations: true }).flatMap((f) =>
      layerViolations(f, importSpecifiers(parseSource(f)))
    )
    expect(hits).toEqual([])
  })
})
