// ManageDialog — the ONE shell for the Manage dialogs (Templates, Workspaces, Shortcuts, and the
// Tags / Rules dialogs of spec 2026-09-11). .claude/rules/design.md required the dialogs to share
// one layout, but nothing shared code: each module carried its own copy of the overlay, the panel
// and all four button styles, and the rule told the next author to copy them again. These parts
// ARE that layout now, so the rule holds by structure (spec §0, T-15).
//
// Compound components over one context (vercel-composition-patterns): the dialog creates
// `{ state, actions, meta }` with `useManageDialog()`; every part reads what it needs through
// `useManageDialogContext()`. Components only in this file (react-refresh) — the compound object
// is `ManageDialog.ts`.
import type { FormEvent, JSX, KeyboardEvent, ReactNode } from 'react'
import {
  ManageDialogContext,
  useManageDialogContext,
  type ManageDialogContextValue
} from './manageDialogState'
import styles from './ManageDialog.module.css'

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter((c): c is string => typeof c === 'string' && c.length > 0).join(' ')
}

export interface ManageDialogProviderProps extends ManageDialogContextValue {
  children: ReactNode
}

export function ManageDialogProvider({
  state,
  actions,
  meta,
  children
}: ManageDialogProviderProps): JSX.Element {
  return <ManageDialogContext value={{ state, actions, meta }}>{children}</ManageDialogContext>
}

export interface ManageDialogFrameProps {
  /** `wide` fits a list with several columns (Shortcuts: name · chord · phrase · edit). */
  size?: 'standard' | 'wide'
  children: ReactNode
}

/** The overlay (z-index 60, role=dialog) + the panel. Escape closes the dialog — but only an
 *  Escape nothing inside claimed: an armed Delete stops its own Escape before it gets here. */
export function ManageDialogFrame({
  size = 'standard',
  children
}: ManageDialogFrameProps): JSX.Element {
  const { actions, meta } = useManageDialogContext()

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      actions.close()
    }
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      data-testid={`${meta.testIdPrefix}-overlay`}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cx(styles.panel, size === 'wide' && styles.panelWide)}
        data-testid={`${meta.testIdPrefix}-panel`}
      >
        {children}
      </div>
    </div>
  )
}

export interface ManageDialogHeaderProps {
  /** Beside the title — the ScopeFilter, when the list spans workspaces. */
  children?: ReactNode
  /** One line under the title saying what the items DO (Shortcuts). */
  subtitle?: ReactNode
  /** Buttons left of ✕ (Shortcuts' `Add shortcut`). */
  buttons?: ReactNode
}

export function ManageDialogHeader({
  children,
  subtitle,
  buttons
}: ManageDialogHeaderProps): JSX.Element {
  const { actions, meta } = useManageDialogContext()
  // R1: destructure meta here and use these names in JSX, not `meta.title` / `meta.testIdPrefix` /
  // `meta.closeRef` — reading those directly trips react-hooks/refs (closeRef in `meta` makes the
  // linter treat every `meta.*` read as a ref read).
  const { title, testIdPrefix, closeRef } = meta
  return (
    <div className={styles.header} data-subtitled={subtitle !== undefined}>
      <div className={styles.headerText}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{title}</h2>
          {children}
        </div>
        {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <div className={styles.headerActions}>
        {buttons}
        <button
          ref={closeRef}
          type="button"
          className={styles.closeButton}
          data-testid={`${testIdPrefix}-close`}
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={() => actions.close()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

export interface ManageDialogFormProps {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  testId?: string
  children: ReactNode
}

export function ManageDialogForm({
  onSubmit,
  testId,
  children
}: ManageDialogFormProps): JSX.Element {
  const { state, actions } = useManageDialogContext()

  // Escape peels ONE layer (UX-DR14): with Delete armed it disarms and stops here, wherever focus
  // is inside the form. Unarmed, it bubbles on to the Frame, which closes the dialog.
  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>): void {
    if (e.key === 'Escape' && state.armed) {
      e.stopPropagation()
      actions.disarm()
    }
  }

  return (
    <form
      className={styles.form}
      data-testid={testId}
      onSubmit={onSubmit}
      onKeyDown={handleKeyDown}
    >
      {children}
    </form>
  )
}

/** The form's ONE `flex-end` action row: `[Delete] [Save]` (design.md). */
export function ManageDialogFooter({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.footer}>{children}</div>
}

export interface ManageDialogDeleteProps {
  /** The SECOND press. The first press only arms. */
  onConfirm: () => void
  testId: string
  /** The armed button's test id, when a test must tell the two presses apart
   *  (Workspaces: `workspace-delete-<id>` → `workspace-delete-confirm`). Defaults to `testId`. */
  armedTestId?: string
  disabled?: boolean
}

/**
 * The arm-in-place Delete, owned ONCE (design.md): one button, two presses. `Delete` (red outline
 * at rest, filled on hover/focus) → `Confirm delete` (solid red). Blur disarms. Escape disarms and
 * STOPS — it must not also close the dialog. It never disarms itself after `onConfirm`: a refused
 * delete stays armed so a second press retries, and a successful one leaves via `select(null)`.
 */
export function ManageDialogDelete({
  onConfirm,
  testId,
  armedTestId,
  disabled = false
}: ManageDialogDeleteProps): JSX.Element {
  const { state, actions } = useManageDialogContext()
  const { armed } = state

  function handleClick(): void {
    if (armed) onConfirm()
    else actions.arm()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Escape' && armed) {
      e.stopPropagation()
      actions.disarm()
    }
  }

  return (
    <button
      type="button"
      className={armed ? styles.dangerButton : styles.deleteButton}
      data-testid={armed ? (armedTestId ?? testId) : testId}
      disabled={disabled}
      onClick={handleClick}
      onBlur={() => actions.disarm()}
      onKeyDown={handleKeyDown}
    >
      {armed ? 'Confirm delete' : 'Delete'}
    </button>
  )
}

export interface ManageDialogSaveProps {
  testId: string
  disabled: boolean
  /** Omit inside a <ManageDialog.Form> — the button then submits it. Pass it where there is no
   *  form (Shortcuts' editor card). */
  onClick?: () => void
  /** The label. Defaults to `Save`. */
  children?: ReactNode
}

export function ManageDialogSave({
  testId,
  disabled,
  onClick,
  children = 'Save'
}: ManageDialogSaveProps): JSX.Element {
  return (
    <button
      type={onClick === undefined ? 'submit' : 'button'}
      className={styles.primaryButton}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** The dialog's ONE error line (design.md): role=alert, shared by every flow in the dialog. */
export function ManageDialogError({ testId }: { testId: string }): JSX.Element | null {
  const { state } = useManageDialogContext()
  if (state.error === null) return null
  return (
    <p className={styles.error} data-testid={testId} role="alert">
      {state.error}
    </p>
  )
}

/** A field label. A `<label for>` can only name a real form control; a `Select` is a
 *  button-and-listbox, so its label is a `<span>` and the Select carries `ariaLabel` (design.md). */
export function ManageDialogLabel({
  htmlFor,
  children
}: {
  htmlFor?: string
  children: ReactNode
}): JSX.Element {
  if (htmlFor === undefined) return <span className={styles.label}>{children}</span>
  return (
    <label className={styles.label} htmlFor={htmlFor}>
      {children}
    </label>
  )
}

/** A muted helper line under a field — never an error (that is the one `Error` line). */
export function ManageDialogHint({
  testId,
  children
}: {
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <p className={styles.hint} data-testid={testId}>
      {children}
    </p>
  )
}

export interface ManageDialogGhostButtonProps {
  testId: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}

/** The secondary button style (Browse…, Cancel, Edit, Add shortcut). */
export function ManageDialogGhostButton({
  testId,
  onClick,
  disabled = false,
  children
}: ManageDialogGhostButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={styles.ghostButton}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
