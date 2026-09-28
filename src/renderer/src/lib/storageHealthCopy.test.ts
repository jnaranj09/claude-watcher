// UX-06 — every Manage dialog maps `store_write_failed` to the same sentence, found inside the
// Electron-wrapped invoke rejection (the templateErrorMessage precedent). The Workspaces dialog's
// mapper is private to its .tsx and is pinned in WorkspacesDialog.test.tsx instead.
import { describe, expect, it } from 'vitest'
import { STORE_WRITE_FAILED_COPY } from './storageHealthCopy'
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
