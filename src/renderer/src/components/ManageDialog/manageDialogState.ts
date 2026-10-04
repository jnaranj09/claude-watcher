// ManageDialog — the STATE CONTRACT every part reads (spec 2026-09-11 §0.2). A generic
// `{ state, actions, meta }` interface (vercel-composition-patterns `state-context-interface`):
// the dialog that owns a ManageDialog creates it with `useManageDialog()` and hands it to
// <ManageDialog.Provider>; each part reads it with React 19 `use()`, so selection, the armed
// Delete and the one error line are never threaded through props.
//
// Its own `.ts` file so `ManageDialogParts.tsx` exports components only
// (react-refresh/only-export-components).
import { createContext, use, useMemo, useRef, useState, type RefObject } from 'react'
import { useFlash } from '../../hooks/useFlash'

/** How long the message slot's success shows (spec 2026-10-01): one short sentence, read. */
export const SUCCESS_MS = 2500

export interface ManageDialogState {
  /** The row the form edits, or null (nothing open, or the New form — see `creating`). */
  selectedId: string | null
  /** True while the New form is open (`+ New`). `selectedId: null` + `creating: false` is
   *  NOTHING open — the right column shows `ManageDialog.Placeholder` (spec 2026-09-29 §1). */
  creating: boolean
  /** True between the first press of a Delete and the second (`Confirm delete`). */
  armed: boolean
  /** WHICH Delete is armed: the footer's `'form'` (the default), or a key a page names when it has
   *  a second Delete on screen (the Active page's bulk bar: `'bulk'`). Null when none is. */
  armedKey: string | null
  /** The ONE error line's operator copy, or null. Never a raw `error.message` (design.md). */
  error: string | null
  /** The message slot's success copy, shown for SUCCESS_MS. Every other action clears it, so a
   *  dialog calls `showSuccess` AFTER the `select` that follows its save. */
  success: string | null
}

export interface ManageDialogActions {
  /** Open a row, or close what was open (null → the placeholder). Ends creating, disarms Delete
   *  and clears the error line: both belonged to the row that was open, not to the one being
   *  opened. */
  select: (id: string | null) => void
  /** `+ New`: open the empty New form. Disarms Delete and clears the error line. */
  startNew: () => void
  /** The first press of a Delete (`key` names which; default `'form'`). Clears the error line —
   *  arming starts a new flow. */
  arm: (key?: string) => void
  disarm: () => void
  /** Any value clears the success: a refusal replaces it, and an edit (`setError(null)`) ends it. */
  setError: (message: string | null) => void
  /** A save, delete or forget that landed: the slot shows `text` for SUCCESS_MS, replacing an error. */
  showSuccess: (text: string) => void
  close: () => void
}

export interface ManageDialogMeta {
  /** The dialog's name: the header's heading and the overlay's aria-label. */
  title: string
  /** Prefix of the shell's own test ids: `<prefix>-overlay`, `<prefix>-panel`, `<prefix>-close`. */
  testIdPrefix: string
  /** The header's ✕. A dialog with no field to focus on mount focuses this (Workspaces). */
  closeRef: RefObject<HTMLButtonElement | null>
}

export interface ManageDialogContextValue {
  state: ManageDialogState
  actions: ManageDialogActions
  meta: ManageDialogMeta
}

export const ManageDialogContext = createContext<ManageDialogContextValue | null>(null)

export interface UseManageDialogOptions {
  title: string
  testIdPrefix: string
  onClose: () => void
  /** The row open on mount. Settings opens on its first category; Manage dialogs open on nothing. */
  initialSelectedId?: string | null
  /** `select` keeps the error line. Settings: its rail rows are PAGES of one surface, so a
   *  refusal (a port out of range, an unreadable themes folder) still describes the panel after a
   *  category switch. A Manage dialog's rows are separate records, whose errors do not carry. */
  keepErrorOnSelect?: boolean
}

/** Create the shell's state for one dialog. Spread the result into <ManageDialog.Provider>. */
export function useManageDialog(options: UseManageDialogOptions): ManageDialogContextValue {
  const {
    title,
    testIdPrefix,
    onClose,
    initialSelectedId = null,
    keepErrorOnSelect = false
  } = options
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [creating, setCreating] = useState(false)
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, flashSuccess, clearSuccess] = useFlash<string>(SUCCESS_MS)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const actions = useMemo<ManageDialogActions>(
    () => ({
      select: (id) => {
        clearSuccess()
        setSelectedId(id)
        setCreating(false)
        setArmedKey(null)
        if (!keepErrorOnSelect) setError(null)
      },
      startNew: () => {
        clearSuccess()
        setSelectedId(null)
        setCreating(true)
        setArmedKey(null)
        setError(null)
      },
      arm: (key = 'form') => {
        clearSuccess()
        setArmedKey(key)
        setError(null)
      },
      disarm: () => setArmedKey(null),
      setError: (message) => {
        clearSuccess()
        setError(message)
      },
      showSuccess: (text) => {
        setError(null)
        flashSuccess(text)
      },
      close: () => onClose()
    }),
    [onClose, keepErrorOnSelect, clearSuccess, flashSuccess]
  )

  return {
    state: { selectedId, creating, armed: armedKey !== null, armedKey, error, success },
    actions,
    meta: { title, testIdPrefix, closeRef }
  }
}

/** Read the shell's state from inside any part (or any dialog code under the Provider). */
export function useManageDialogContext(): ManageDialogContextValue {
  const value = use(ManageDialogContext)
  if (value === null) {
    throw new Error('ManageDialog parts must render inside <ManageDialog.Provider>')
  }
  return value
}
