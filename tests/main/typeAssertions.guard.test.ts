// Type assertions (technical-taste §5b-9): after a boundary the TYPE is the proof, so an `as` that
// forces a value through is a hole in it. Every non-test file keeps its count of `as X` / `<X>x`
// (`as const` is not an assertion) at or below the budget here, matched EXACTLY so the budget can
// only fall. A new cast: use a parse or a type guard instead. A cast that is truly needed goes in a
// small, named, tested helper, and its budget changes in the same commit with the reason.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { SRC, assertionCount, parseSource, sourceFiles, srcRel } from './sourceScan'

/** Measured 2026-10-01: 47 casts in 30 files. */
const BUDGET: Record<string, number> = {
  'main/api/openapi.ts': 6,
  'main/api/registry.ts': 1,
  'main/hooks/backgroundTasks.ts': 1,
  'main/index.ts': 1,
  'main/ipc/registerPtyIpc.ts': 2,
  'main/ipc/registerTerminalIpc.ts': 1,
  'main/kde/attentionReminders.ts': 1,
  'main/pty/claudeTranscript.ts': 1,
  'main/pty/runningElsewhere.ts': 1,
  'main/rules/ruleTimers.ts': 1,
  'main/themes/themeCompose.ts': 1,
  'renderer/src/SmokeCockpit.tsx': 4,
  'renderer/src/audio/attentionSound.ts': 2,
  'renderer/src/components/AppMenu/AppMenu.tsx': 1,
  'renderer/src/components/FilterBar/FilterBar.tsx': 1,
  'renderer/src/components/NewSessionMenu/NewSessionButton.tsx': 1,
  'renderer/src/components/NewSessionMenu/NewSessionMenu.tsx': 2,
  'renderer/src/components/ScopeFilter/ScopeFilter.tsx': 2,
  'renderer/src/components/Select/Select.tsx': 1,
  'renderer/src/components/SessionCard/SessionCard.tsx': 1,
  'renderer/src/components/Settings/Settings.tsx': 1,
  'renderer/src/components/TagPicker/TagPicker.tsx': 1,
  'renderer/src/components/TemplatesDialog/templateForm.ts': 1,
  'renderer/src/components/Toaster/Toaster.tsx': 1,
  'renderer/src/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx': 1,
  'renderer/src/lib/namePromptFlow.ts': 1,
  'renderer/src/shortcuts/expand.ts': 2,
  'renderer/src/stores/toastStore.ts': 1,
  'renderer/src/terminal/EmbeddedTerminal.tsx': 1,
  'renderer/src/terminal/TerminalContextMenu.tsx': 1,
  'shared/schemas/theme.ts': 2,
  'shared/theme/themeDocs.ts': 2
}

const count = (text: string, file = 'main/x.ts'): number =>
  assertionCount(parseSource(join(SRC, file), text))

describe('assertionCount', () => {
  it('counts `as X` and `<X>x`', () => {
    expect(count('const a = b as Foo\nconst c = <Foo>d\n')).toBe(2)
  })

  it('does not count `as const` or an import/export rename', () => {
    expect(count("import { a as b } from 'x'\nexport { b as c }\nconst d = [1] as const\n")).toBe(0)
  })

  it('counts `as unknown as X` as two', () => {
    expect(count('const a = b as unknown as Foo\n')).toBe(2)
  })
})

describe('type-assertion budget', () => {
  it('every file is at its exact budget', () => {
    const actual: Record<string, number> = {}
    for (const f of sourceFiles()) {
      const n = assertionCount(parseSource(f))
      if (n > 0) actual[srcRel(f)] = n
    }
    expect(actual).toEqual(BUDGET)
  })
})
