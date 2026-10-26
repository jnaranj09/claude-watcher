// ManageDialog — the STATE CONTRACT every part reads (spec 2026-09-11 §0.2). A generic
// `{ state, actions, meta }` interface (vercel-composition-patterns `state-context-interface`):
// the dialog that owns a ManageDialog creates it with `useManageDialog()` and hands it to
// <ManageDialog.Provider>; each part reads it with React 19 `use()`, so selection, the armed
// Delete and the error are never threaded through props.
//
// A dialog's action RESULT is a toast (spec 2026-10-26 dialog toasts): `setError` and
// `showSuccess` push ONE toast keyed `dialog:<testIdPrefix>`, so a new result replaces the last.
// The error toast fades when the error clears and when the dialog closes (its exit starts) or
// unmounts; a success fades on its own timer.
//
// Its own `.ts` file so `ManageDialogParts.tsx` exports components only
// (react-refresh/only-export-components).
import { createContext, use, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { toast, toastStore } from '../../stores/toastStore'
import { useLeaving } from '../Presence/leaving'

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
  /** The current error's operator copy (the one its error toast shows), or null. Never a raw
   *  `error.message` (design.md). A form reads it to hold back its own hint while it shows. */
  error: string | null
}

export interface ManageDialogActions {
  /** Open a row, or close what was open (null → the placeholder). Ends creating, disarms Delete
   *  and clears the error (its toast fades): both belonged to the row that was open, not to the
   *  one being opened. */
  select: (id: string | null) => void
  /** `+ New`: open the empty New form. Disarms Delete and clears the error (its toast fades). */
  startNew: () => void
  /** The first press of a Delete (`key` names which; default `'form'`). Clears the error (its
   *  toast fades) — arming starts a new flow. */
  arm: (key?: string) => void
  disarm: () => void
  /** A refusal pushes the dialog's error toast (replacing its last toast), every time — the same
   *  text again shows again after the operator's ✕. `null` (an edit, R26) fades the error toast
   *  and leaves a success to its timer. */
  setError: (message: string | null) => void
  /** A save, delete or forget that landed: the dialog's success toast `text`, replacing its error
   *  toast. Call it AFTER the `select` that follows the save. */
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
  /** `select` keeps the error (and its toast). Settings: its rail rows are PAGES of one surface,
   *  so a refusal (a save main refused) still describes the panel after a category switch. A
   *  Manage dialog's rows are separate records, whose errors do not carry. */
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
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const key = `dialog:${testIdPrefix}`

  const actions = useMemo<ManageDialogActions>(() => {
    const clearError = (): void => {
      setError(null)
      toastStore.getState().dismissKey(key, 'error')
    }
    return {
      select: (id) => {
        setSelectedId(id)
        setCreating(false)
        setArmedKey(null)
        if (!keepErrorOnSelect) clearError()
      },
      startNew: () => {
        setSelectedId(null)
        setCreating(true)
        setArmedKey(null)
        clearError()
      },
      arm: (armKey = 'form') => {
        setArmedKey(armKey)
        clearError()
      },
      disarm: () => setArmedKey(null),
      setError: (message) => {
        if (message === null) {
          clearError()
          return
        }
        // Pushed even when `error` already holds this text: the operator may have ✕'d its toast.
        setError(message)
        toast.error(message, { key })
      },
      showSuccess: (text) => {
        setError(null)
        toast.success(text, { key })
      },
      close: () => onClose()
    }
  }, [onClose, keepErrorOnSelect, key])

  // The error toast describes this dialog's form: it goes when the dialog's exit starts (a
  // pointer close keeps it mounted, `data-leaving`, for MOTION_EXIT_MS) and when it unmounts (a
  // keyboard close, a page that goes). A success stays and fades on its own timer.
  const leaving = useLeaving()
  useEffect(() => {
    if (leaving) toastStore.getState().dismissKey(key, 'error')
  }, [leaving, key])
  useEffect(() => () => toastStore.getState().dismissKey(key, 'error'), [key])

  return {
    state: { selectedId, creating, armed: armedKey !== null, armedKey, error },
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
