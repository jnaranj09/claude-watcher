// Layers (technical-taste §5b-16): `shared` imports no app layer; `renderer` and `preload` never
// import `main`; `main` never imports `renderer` or `preload`. The tree was clean only by
// convention — this guard turns the next cross-layer import red.
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

  it('the real tree has no cross-layer import', () => {
    const hits = sourceFiles({ declarations: true }).flatMap((f) =>
      layerViolations(f, importSpecifiers(parseSource(f)))
    )
    expect(hits).toEqual([])
  })
})
