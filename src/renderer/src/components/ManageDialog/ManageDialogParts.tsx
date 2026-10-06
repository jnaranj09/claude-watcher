// ManageDialog — the ONE shell for every two-column dialog (Templates, Workspaces, Shortcuts, Tags,
// Rules, Past sessions, and Settings — spec 2026-09-29). .claude/rules/design.md required the dialogs to share
// one layout, but nothing shared code: each module carried its own copy of the overlay, the panel
// and all four button styles, and the rule told the next author to copy them again. These parts
// ARE that layout now, so the rule holds by structure (spec §0, T-15).
//
// Compound components over one context (vercel-composition-patterns): the dialog creates
// `{ state, actions, meta }` with `useManageDialog()`; every part reads what it needs through
// `useManageDialogContext()`. Components only in this file (react-refresh) — the compound object
// is `ManageDialog.ts`.
import {
  Children,
  isValidElement,
  useEffect,
  useEffectEvent,
  useRef,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import {
  ManageDialogContext,
  useManageDialogContext,
  type ManageDialogContextValue
} from './manageDialogState'
import { useOverflowEnd } from './useOverflowEnd'
import styles from './ManageDialog.module.css'
import { Button, type ButtonSize } from '../Button/Button'
import { Callout } from '../Callout/Callout'
import { workspaceTintClass, type WorkspaceTone } from '../WorkspaceTint/workspaceTint'
import { leavingProps, useLeaving } from '../Presence/leaving'

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
  /** `wide` fits a form with long rows (Rules: trigger, conditions, actions). */
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
  // Overlay motion (spec 2026-10-04 §6): leaving = playing its exit inside <Presence>.
  const leaving = useLeaving()

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      actions.close()
    }
  }

  return (
    <div
      className={styles.overlay}
      data-motion="dialog"
      {...leavingProps(leaving)}
      role="dialog"
      aria-modal="true"
      aria-label={meta.title}
      data-testid={`${meta.testIdPrefix}-overlay`}
      onKeyDown={handleKeyDown}
    >
      <div
        className={cx(styles.panel, size === 'wide' && styles.panelWide)}
        data-manage-panel=""
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
  /** Buttons left of ✕. Nothing uses it today: `+ New` in the rail is the create control. */
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
        <Button
          variant="secondary"
          size="sm"
          icon="round"
          buttonRef={closeRef}
          testId={`${testIdPrefix}-close`}
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={() => actions.close()}
        >
          ✕
        </Button>
      </div>
    </div>
  )
}

/** Escape peels ONE layer (UX-DR14): with Delete armed it disarms and stops here, wherever focus
 *  is inside the right column. Unarmed, it bubbles on to the Frame, which closes the dialog. */
function useDisarmOnEscape(): (e: KeyboardEvent<HTMLElement>) => void {
  const { state, actions } = useManageDialogContext()
  return (e) => {
    if (e.key === 'Escape' && state.armed) {
      e.stopPropagation()
      actions.disarm()
    }
  }
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
  const handleKeyDown = useDisarmOnEscape()
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

/** The right column for a surface with NOTHING to submit — Settings, whose controls persist on
 *  change. Same scroll region as `Form` (one CSS rule), same Escape-disarm, but a `<div>`. */
export function ManageDialogPane({
  testId,
  children
}: {
  testId?: string
  children: ReactNode
}): JSX.Element {
  const handleKeyDown = useDisarmOnEscape()
  return (
    <div className={styles.pane} data-testid={testId} onKeyDown={handleKeyDown}>
      {children}
    </div>
  )
}

/** The right column while NOTHING is open (spec 2026-09-29): one quiet sentence, never an empty
 *  form. No button — `+ New` in the rail is the one create control. */
export function ManageDialogPlaceholder({
  testId,
  children
}: {
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className={styles.placeholder} data-testid={testId}>
      <p className={styles.placeholderText}>{children}</p>
    </div>
  )
}

/** The form's ONE `flex-end` action row: `[Delete] [Save]` (design.md). */
export function ManageDialogFooter({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.footer} data-manage-footer="">
      {children}
    </div>
  )
}

export interface ManageDialogDeleteProps {
  /** The SECOND press. The first press only arms. */
  onConfirm: () => void
  /** Which Delete this is when one surface shows two (the Active page: `'bulk'` in the rail, the
   *  footer's default `'form'`). Only the armed one reads `Confirm delete`. */
  armKey?: string | undefined
  testId: string
  /** The armed button's test id, when a test must tell the two presses apart
   *  (Workspaces: `workspace-delete-<id>` → `workspace-delete-confirm`). Defaults to `testId`. */
  armedTestId?: string
  disabled?: boolean
  /** The resting label. Defaults to `Delete`. Rename it only for another DESTRUCTIVE two-press
   *  action that is not itself a delete — Settings' `Regenerate` token is the one so far. */
  label?: string | undefined
  /** The armed label. Defaults to `Confirm delete`; pair it with `label`. */
  confirmLabel?: string | undefined
  /** In flight (Settings' Regenerate): disabled + `aria-busy`, the ARMED look kept, and neither a
   *  blur nor a click disarms or re-fires it. A refusal leaves it armed (one press retries); the
   *  host disarms on success (`select(null)`, Settings' `disarm()`). */
  busy?: boolean | undefined
  /** A result shown in place of the label (Regenerate: `✓ New token`) while `feedbackShown`. */
  feedback?: ReactNode | undefined
  feedbackShown?: boolean | undefined
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
  disabled = false,
  label = 'Delete',
  confirmLabel = 'Confirm delete',
  busy = false,
  feedback,
  feedbackShown,
  armKey = 'form'
}: ManageDialogDeleteProps): JSX.Element {
  const { state, actions } = useManageDialogContext()
  const armed = state.armedKey === armKey
  // An armed Delete that unmounts (the Active bulk bar once its rows end) must not leave the arm
  // behind: React never calls the unmounting button's onBlur, and the next Delete with this key
  // would come back already reading `Confirm delete` (final review 2).
  const disarmIfArmed = useEffectEvent((): void => {
    if (armed) actions.disarm()
  })
  useEffect(() => () => disarmIfArmed(), [])

  function handleClick(): void {
    if (busy) return
    if (armed) onConfirm()
    else actions.arm(armKey)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Escape' && armed) {
      e.stopPropagation()
      actions.disarm()
    }
  }

  return (
    <Button
      variant="danger"
      armed={armed}
      testId={armed ? (armedTestId ?? testId) : testId}
      disabled={disabled}
      busy={busy}
      feedback={feedback}
      feedbackShown={feedbackShown}
      onClick={handleClick}
      onBlur={() => {
        // Disabling a focused button can blur it: an in-flight confirm must stay armed.
        if (!busy) actions.disarm()
      }}
      onKeyDown={handleKeyDown}
    >
      {armed ? confirmLabel : label}
    </Button>
  )
}

export interface ManageDialogSaveProps {
  testId: string
  disabled: boolean
  /** Omit inside a <ManageDialog.Form> — the button then submits it. Pass it where there is no
   *  form. */
  onClick?: () => void
  /** The label. Defaults to `Save`. */
  children?: ReactNode
  /** The save in flight: disabled + `aria-busy` (useAsyncAction's `busy`). */
  busy?: boolean | undefined
  feedback?: ReactNode | undefined
  feedbackShown?: boolean | undefined
}

export function ManageDialogSave({
  testId,
  disabled,
  onClick,
  children = 'Save',
  busy = false,
  feedback,
  feedbackShown
}: ManageDialogSaveProps): JSX.Element {
  return (
    <Button
      variant="primary"
      type={onClick === undefined ? 'submit' : 'button'}
      testId={testId}
      disabled={disabled}
      busy={busy}
      feedback={feedback}
      feedbackShown={feedbackShown}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** The dialog's ONE message slot (design.md, spec 2026-10-01): an error (alert, stays until the
 *  next action) or a success (SUCCESS_MS). Both are a `Callout` block; never both. The error keeps
 *  the caller's test id; the success is `<testIdPrefix>-success`.
 *  The slot is ALWAYS in the page: it is the polite live region (a status inserted together with
 *  its text is announced unreliably), and it reserves one callout's height, so a message that
 *  comes and goes never moves the centred dialog under the pointer. */
export function ManageDialogMessage({ testId }: { testId: string }): JSX.Element {
  const { state, meta } = useManageDialogContext()
  return (
    <div className={styles.message} role="status" data-testid={`${meta.testIdPrefix}-message`}>
      {state.error !== null ? (
        <Callout tone="danger" title={state.error} testId={testId} />
      ) : state.success !== null ? (
        <Callout
          tone="success"
          title={state.success}
          announce={false}
          testId={`${meta.testIdPrefix}-success`}
        />
      ) : null}
    </div>
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
  /** Rules' ↑ / ↓ in the 56px `RowActions` slot: two `xs` icon squares fit, two `md` do not. */
  size?: ButtonSize | undefined
  icon?: boolean | undefined
  children: ReactNode
  /** In flight (Browse…, Reload themes, a rule move): disabled + `aria-busy`. */
  busy?: boolean | undefined
  /** A result in place of the label (`✓ Copied`, `✓ Reloaded`) while `feedbackShown`. */
  feedback?: ReactNode | undefined
  feedbackShown?: boolean | undefined
}

/** The secondary button (Browse…, Cancel, Edit, Add shortcut) — `Button` `secondary`. */
export function ManageDialogGhostButton({
  testId,
  onClick,
  disabled = false,
  size,
  icon,
  children,
  busy = false,
  feedback,
  feedbackShown
}: ManageDialogGhostButtonProps): JSX.Element {
  return (
    <Button
      variant="secondary"
      size={size}
      icon={icon}
      testId={testId}
      disabled={disabled}
      busy={busy}
      feedback={feedback}
      feedbackShown={feedbackShown}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** The `rail | form` grid — `pages | rail | form` when a <Pages> column leads it, `pages | form`
 *  without a rail (Import). The rail sets its own width (List `size`), the form takes the rest. */
export function ManageDialogColumns({ children }: { children: ReactNode }): JSX.Element {
  return <div className={styles.columns}>{children}</div>
}

export interface ManageDialogPagesProps<P extends string> {
  /** Names the nav for assistive tech: `Sessions pages`, `Tags pages`. */
  label: string
  pages: readonly { id: P; label: string }[]
  current: P
  onSelect: (page: P) => void
  /** Each row's test id is `<testIdPrefix>-<id>`. */
  testIdPrefix: string
}

/** The page column (spec 2026-10-03 C): a dialog's SIBLING pages as text rows at the far left —
 *  never tabs (they read as the header's workspace switcher), never a second dialog. A `nav`, not
 *  a tablist; the current row carries `aria-current="page"` and the one selected look of a rail
 *  row (design.md). */
export function ManageDialogPages<P extends string>({
  label,
  pages,
  current,
  onSelect,
  testIdPrefix
}: ManageDialogPagesProps<P>): JSX.Element {
  return (
    <nav className={styles.pages} aria-label={label} data-manage-pages="">
      {/* Rail rows (`.row` + `.rowSelect`): the current page has the ONE selected look, the same
          as a Settings category (design.md "One selected look"). */}
      {pages.map((p) => (
        <div key={p.id} className={styles.row} data-selected={p.id === current}>
          <button
            type="button"
            className={styles.rowSelect}
            data-testid={`${testIdPrefix}-${p.id}`}
            aria-current={p.id === current ? 'page' : undefined}
            onClick={() => onSelect(p.id)}
          >
            {p.label}
          </button>
        </div>
      ))}
    </nav>
  )
}

export interface ManageDialogListProps {
  /** `wide` (260px) fits a second line of detail in each row (Workspaces' default folder). */
  size?: 'standard' | 'wide'
  children: ReactNode
}

/** The left rail: an optional search field, <Rows>, then a bottom slot (<New> or <ListBottom>).
 *  Three regions, `--gap-group` apart. */
export function ManageDialogList({
  size = 'standard',
  children
}: ManageDialogListProps): JSX.Element {
  return <div className={cx(styles.list, size === 'wide' && styles.listWide)}>{children}</div>
}

/** The scrolling row list. Rows are its DIRECT children — the list is flat in every scope, never
 *  sectioned (design.md "Scoped lists"). Fades at its end while more rows are below (rule 8). */
export function ManageDialogRows({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useOverflowEnd(ref)
  return (
    <div className={styles.rows} ref={ref} data-manage-rows="">
      {children}
    </div>
  )
}

export interface ManageDialogRowProps {
  /** What `select` receives, and what `state.selectedId` is compared with. */
  id: string
  /** On the row wrapper — the direct child of <Rows>. */
  testId: string
  /** On the select button, when a test clicks it by id (`workspace-select-<id>`). */
  selectTestId?: string
  /** Extra attributes for the select button (`data-template-id`). */
  dataAttributes?: Readonly<Record<`data-${string}`, string>>
  /** The row's label, plus at most one <ManageDialog.RowCheck> (drawn before the select button)
   *  and one <ManageDialog.RowActions> — DIRECT children of this row, not wrapped in a Fragment or
   *  a wrapper component (see `ManageDialogRowActions`). */
  children: ReactNode
  /** A workspace row (the Workspaces dialog): the row is tinted with that colour, and its hover /
   *  selected states move to the border (spec 2026-09-29). */
  tint?: WorkspaceTone
}

/**
 * One row: a select button (the label) and, when the row has <RowActions>, a fixed-width action
 * slot BESIDE it. The actions cannot live inside the button — a <button> inside a <button> is
 * invalid HTML — so the row picks them out of its children and renders them in the slot.
 *
 * The wrapper `<div>` carries `testId` (as `data-testid`) and `data-selected`; `dataAttributes`
 * (e.g. `data-template-id`) land on the inner select `<button>`, not the wrapper. In jsdom,
 * `.click()` on the wrapper does not select the row — tests must click the select button
 * (`selectTestId`, or the button carrying `dataAttributes`).
 */
export function ManageDialogRow({
  id,
  testId,
  selectTestId,
  dataAttributes = {},
  children,
  tint
}: ManageDialogRowProps): JSX.Element {
  const { state, actions } = useManageDialogContext()
  const parts = Children.toArray(children)
  const rowActions = parts.filter(isRowActions)
  const rowChecks = parts.filter((p) => isValidElement(p) && p.type === ManageDialogRowCheck)
  const label = parts.filter((part) => !isRowActions(part) && !rowChecks.includes(part))
  return (
    <div
      className={cx(styles.row, tint !== undefined && workspaceTintClass(tint))}
      data-testid={testId}
      data-selected={state.selectedId === id}
      data-tone={tint}
    >
      {rowChecks}
      <button
        type="button"
        className={styles.rowSelect}
        data-testid={selectTestId}
        data-manage-row-select=""
        aria-current={state.selectedId === id ? 'page' : undefined}
        {...dataAttributes}
        onClick={() => actions.select(id)}
      >
        {label}
      </button>
      {rowActions.length > 0 && (
        <div className={styles.rowActions} data-testid="manage-row-actions">
          {rowActions}
        </div>
      )}
    </div>
  )
}

/**
 * Per-row actions with NO form equivalent (Rules' ↑/↓). Never a Delete or a rename — the form owns
 * those, and a second control for the same job is the defect design.md forbids. Revealed on row
 * hover / focus-within, in a fixed-width slot, so rows never go ragged.
 *
 * Must be a DIRECT child of `Row` — `Row` finds it by element identity
 * (`node.type === ManageDialogRowActions`), so wrapping it in a Fragment or a wrapper component
 * defeats that check silently: it is not picked out of `children`, and instead renders inside the
 * row's own select button (a button nested inside a button).
 */
export function ManageDialogRowActions({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>
}

export interface ManageDialogRowCheckProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Names the box for assistive tech: `Select <name>`. */
  label: string
  testId: string
}

/**
 * A row's checkbox (the Active sessions page's bulk select, spec 2026-10-03 D). A DIRECT child of
 * `Row`, which lifts it out of the select button and draws it BEFORE the button — a control inside
 * a <button> is invalid HTML — so checking a row and opening it stay two separate controls.
 */
export function ManageDialogRowCheck({
  checked,
  onChange,
  label,
  testId
}: ManageDialogRowCheckProps): JSX.Element {
  return (
    <input
      type="checkbox"
      className={styles.rowCheck}
      data-testid={testId}
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

function isRowActions(node: ReactNode): boolean {
  return isValidElement(node) && node.type === ManageDialogRowActions
}

/** The rail's bottom slot (spec 2026-10-02-region-spacing): pinned to the BOTTOM of the rail,
 *  `--gap-group` under the list, its own items `--gap-field` apart. `+ New` renders in one; a rail
 *  with another bottom action (Past sessions' Resume by id) puts it here with a <ListNote>. */
export function ManageDialogListBottom({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className={styles.listBottom} data-manage-list-bottom="">
      {children}
    </div>
  )
}

/** The bottom slot for a DIFFERENT region under the list (a footnote, a bulk bar): the same slot,
 *  behind a divider (design.md rule 7). `+ New` alone uses the plain `ListBottom`. */
export function ManageDialogListBottomDivided({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className={cx(styles.listBottom, styles.listBottomDivided)}
      data-manage-list-bottom=""
      data-manage-list-divided=""
    >
      {children}
    </div>
  )
}

/** A footnote under the bottom slot's action (Past sessions' cap) — meta size, secondary text. */
export function ManageDialogListNote({
  testId,
  children
}: {
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <p className={styles.listNote} data-testid={testId}>
      {children}
    </p>
  )
}

/** `+ New` — opens the empty New form (`startNew`), in the rail's bottom slot. */
export function ManageDialogNew({ testId }: { testId: string }): JSX.Element {
  const { actions } = useManageDialogContext()
  return (
    <ManageDialogListBottom>
      <Button variant="secondary" testId={testId} onClick={() => actions.startNew()}>
        + New
      </Button>
    </ManageDialogListBottom>
  )
}
