// ManageDialog — the STATE CONTRACT every part reads (spec 2026-09-11 §0.2). A generic
// `{ state, actions, meta }` interface (vercel-composition-patterns `state-context-interface`):
// the dialog that owns a ManageDialog creates it with `useManageDialog()` and hands it to
// <ManageDialog.Provider>; each part reads it with React 19 `use()`, so selection, the armed
// Delete and the one error line are never threaded through props.
//
// Its own `.ts` file so `ManageDialogParts.tsx` exports components only
// (react-refresh/only-export-components).
import { createContext, use, useMemo, useRef, useState, type RefObject } from 'react'

export interface ManageDialogState {
  /** The row the form edits, or null for the empty New form. A dialog with its own "new draft"
   *  sentinel (Shortcuts: `'new'`) stores that here too. */
  selectedId: string | null
  /** True between the first press of Delete and the second (`Confirm delete`). */
  armed: boolean
  /** The ONE error line's operator copy, or null. Never a raw `error.message` (design.md). */
  error: string | null
}

export interface ManageDialogActions {
  /** Select a row (null = the New form). Also disarms Delete and clears the error line: both
   *  belonged to the row that was open, not to the one being opened. */
  select: (id: string | null) => void
  /** The first press of Delete. Clears the error line — arming starts a new flow. */
  arm: () => void
  disarm: () => void
  setError: (message: string | null) => void
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
}

/** Create the shell's state for one dialog. Spread the result into <ManageDialog.Provider>. */
export function useManageDialog(options: UseManageDialogOptions): ManageDialogContextValue {
  const { title, testIdPrefix, onClose } = options
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const actions = useMemo<ManageDialogActions>(
    () => ({
      select: (id) => {
        setSelectedId(id)
        setArmed(false)
        setError(null)
      },
      arm: () => {
        setArmed(true)
        setError(null)
      },
      disarm: () => setArmed(false),
      setError: (message) => setError(message),
      close: () => onClose()
    }),
    [onClose]
  )

  return {
    state: { selectedId, armed, error },
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
