// Session-naming — the session NAME dialog.
//
// Rendered when `boardStore.sessionNamePrompt` is non-null: the operator picked a directory and
// must name the session before anything spawns. Before submit NOTHING has been launched, so
// cancelling is a complete no-op (no PTY, no card, no view change). After submit the prompt stays
// open and `busy` until main answers (action feedback, spec 2026-09-29 §2.2); a Cancel then hands
// the result to the caller's late-result path (lib/namePromptFlow.ts).
//
// DELIBERATELY GENERIC (the deferred rename pass reuses this component unchanged): it takes an
// initial value plus `onSubmit`/`onCancel` and knows NOTHING about launching, IPC, or the store.
// The caller owns what submitting means. `title`/`confirmLabel`/`hint` are overridable so rename
// can read "Rename session" / "Rename" without forking the component.
//
// Design: mirrors StopConfirm.tsx (UX-DR14 / DESIGN.md Dialogs) — centered overlay over
// `--scrim`, `bg-surface-raised` panel, `role="dialog"` + `aria-modal="true"`, focus-on-mount via
// useEffect. TWO deliberate differences from StopConfirm:
//   - The DEFAULT-FOCUSED control is the INPUT, not Cancel, and its text is SELECTED on mount so
//     typing replaces the prefill. StopConfirm default-focuses Cancel because its primary action
//     is destructive; naming is not, so a reflexive Enter should create.
//   - Submit is DISABLED while the trimmed value is empty — a blank name never reaches the IPC
//     seam (main's SessionNameSchema would reject it anyway; this is the earlier of the two gates).
//
// Enter submits via the native <form> submit. Esc is handled by App.tsx's global keydown chain,
// matching how StopConfirm/QuitGuard cancel (see App.tsx Esc disambiguation).
//
// NEVER logs the typed name or the cwd — both are operator content (zod-boundaries.md).
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { SESSION_NAME_MAX_LENGTH } from '../../../../shared/schemas/launch'
import { Button } from '../Button/Button'
import { TextInput } from '../TextInput/TextInput'
import styles from './SessionNameDialog.module.css'

export interface SessionNameDialogProps {
  /** The value the input starts at (the cwd basename on create; the current name on rename). */
  initialName: string
  /** Submit handler. Receives the TRIMMED name and is only ever called with a non-empty string. */
  onSubmit: (name: string) => void
  /** Cancel handler (Cancel button; App.tsx routes Esc here too). */
  onCancel: () => void
  /** Secondary line under the title — the picked directory on create. Omitted → not rendered. */
  hint?: string
  /** One line under the field: the rename dialog says when the name reaches claude. Omitted →
   *  not rendered. */
  helper?: string
  /** Dialog title. Defaults to the create-time wording. */
  title?: string
  /** Primary button label. Defaults to the create-time wording. */
  confirmLabel?: string
  /** Action feedback (spec 2026-09-29 §2.2): the caller's launch/rename is in flight. The confirm
   *  is busy and reads `busyLabel`; Enter does nothing; Cancel stays live (the caller's late-result
   *  path takes over). */
  busy?: boolean
  /** The confirm's label while busy (`Starting…` / `Renaming…`). */
  busyLabel?: string
  /** The caller's mapped refusal copy — never a thrown message. Shown on the ONE error line. */
  error?: string | null
  /** Called on every edit, so the caller clears `error` (R26: editing clears the error line). */
  onEdit?: () => void
}

export function SessionNameDialog({
  initialName,
  onSubmit,
  onCancel,
  hint,
  helper,
  title = 'Name this session',
  confirmLabel = 'Create',
  busy = false,
  busyLabel,
  error = null,
  onEdit
}: SessionNameDialogProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [value, setValue] = useState(initialName)

  // Focus the input AND select its text on mount, so typing replaces the prefill instead of
  // appending to it (the prefill is a suggestion, not a prefix). Runs once — a re-render must
  // not steal the caret back mid-typing.
  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [])

  // The submitted value is always the TRIMMED one, so what the operator sees on the card matches
  // what main stores (SessionNameSchema trims before its length checks).
  const trimmed = value.trim()
  // Mirror BOTH of main's bounds, not just emptiness. The `maxLength` attribute below constrains
  // only what the operator TYPES — it does NOT truncate a programmatically-set value, so an
  // over-long PREFILL (a directory whose basename exceeds the cap) would otherwise sail past this
  // gate, be rejected by main's SessionNameSchema, and fail silently after the modal had closed.
  const tooLong = trimmed.length > SESSION_NAME_MAX_LENGTH
  const canSubmit = trimmed.length > 0 && !tooLong

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    // Guard the Enter path too: a <form> submits on Enter regardless of the button's disabled
    // state in some browsers, so the emptiness check lives here as well as on the button.
    if (!canSubmit || busy) return
    onSubmit(trimmed)
  }

  // The ONE error line: an over-long prefill first (typing is capped, so only a prefill gets
  // there), else the caller's mapped refusal.
  const errorText = tooLong
    ? `Too long — ${trimmed.length}/${SESSION_NAME_MAX_LENGTH} characters.`
    : error

  return (
    <div
      className={styles.overlay}
      data-testid="session-name-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <form className={styles.panel} data-testid="session-name-panel" onSubmit={handleSubmit}>
        <div className={styles.header}>
          <span className={styles.title} data-testid="session-name-title">
            {title}
          </span>
        </div>

        {hint !== undefined && (
          <p className={styles.body} data-testid="session-name-hint">
            {hint}
          </p>
        )}

        <TextInput
          inputRef={inputRef}
          testId="session-name-input"
          // Its OWN accessible name — not the dialog title, which is already announced by the
          // dialog container's aria-label.
          ariaLabel="Session name"
          invalid={tooLong}
          value={value}
          maxLength={SESSION_NAME_MAX_LENGTH}
          onChange={(next) => {
            setValue(next)
            onEdit?.()
          }}
        />

        {helper !== undefined && (
          <p className={styles.helper} data-testid="session-name-helper">
            {helper}
          </p>
        )}

        {/* The over-long case is only reachable via an over-long PREFILL (typing is capped by
            maxLength); without it the Create button would sit disabled with no stated reason.
            Otherwise the caller's mapped launch/rename refusal. */}
        {errorText !== null && (
          <p className={styles.error} data-testid="session-name-error" role="alert">
            {errorText}
          </p>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" testId="session-name-cancel" onClick={onCancel}>
            Cancel
          </Button>
          {/* `submit`: Enter in the field creates through the native <form>. Disabled while the
              trimmed name is empty or too long — a blank name never reaches the IPC seam. */}
          <Button
            variant="primary"
            type="submit"
            testId="session-name-confirm"
            disabled={!canSubmit}
            busy={busy}
          >
            {busy && busyLabel !== undefined ? busyLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
