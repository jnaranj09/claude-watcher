// UX-06 — every Manage dialog maps `store_write_failed` to the same sentence, found inside the
// Electron-wrapped invoke rejection (the templateErrorMessage precedent). The Workspaces dialog's
// mapper is private to its .tsx and is pinned in WorkspacesDialog.test.tsx instead.
import { describe, expect, it } from 'vitest'
import {
  GOALS_FILE_FAILED_COPY,
  STORE_WRITE_FAILED_COPY,
  storageProblemMessage
} from './storageHealthCopy'
import { templateErrorMessage } from '../components/TemplatesDialog/templateForm'
import { tagErrorMessage } from '../components/TagsDialog/tagForm'
import { ruleErrorMessage } from '../components/RulesDialog/ruleForm'
import { SHORTCUT_ERROR_COPY, shortcutErrorCode } from '../components/ShortcutsDialog/shortcutForm'

const wrapped = new Error("Error invoking remote method 'x:save': Error: store_write_failed")

describe('store_write_failed copy (UX-06)', () => {
  it('templates, tags, rules and shortcuts all say the disk refused it', () => {
    expect(templateErrorMessage(wrapped)).toBe(STORE_WRITE_FAILED_COPY)
    expect(tagErrorMessage(wrapped)).toBe(STORE_WRITE_FAILED_COPY)
    expect(ruleErrorMessage(wrapped)).toBe(STORE_WRITE_FAILED_COPY)
    expect(SHORTCUT_ERROR_COPY[shortcutErrorCode(wrapped)]).toBe(STORE_WRITE_FAILED_COPY)
  })
})

describe('memory database problems (memory)', () => {
  it('a refused write says the change was not kept (SQLite rolled it back)', () => {
    expect(storageProblemMessage({ store: 'memory', code: 'write_failed' })).toBe(
      'A change to memory could not be saved to disk, so it was not kept.'
    )
  })

  it('an unopened file says memory is off for this run', () => {
    expect(storageProblemMessage({ store: 'memory', code: 'read_failed' })).toBe(
      'The memory file could not be opened, so memory is off for this run.'
    )
  })

  it('a damaged file names memory in lowercase mid-sentence', () => {
    expect(storageProblemMessage({ store: 'memory', code: 'corrupt_reset' })).toBe(
      'The memory file was damaged, so memory started empty. The old file was kept beside it in the data folder, renamed with .corrupt.'
    )
  })
})

describe('GOALS.md export failures (goals_file)', () => {
  it('say which file and where to look, not the store sentence', () => {
    expect(storageProblemMessage({ store: 'goals_file', code: 'write_failed' })).toBe(
      GOALS_FILE_FAILED_COPY
    )
  })
})
