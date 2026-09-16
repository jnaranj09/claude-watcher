// Story 2.4 — the minimal Settings surface (AC-4).
//
// FIVE controls, IN ORDER: a SOUND on/off toggle, then (spec 2026-09-10) two ATTENTION-REMINDER
// dropdowns — how many times a still-blocked session is re-notified, and the first reminder's
// delay — then a TERMINAL FONT-SIZE control, then (spec 2026-09-15) the PROGRAMMATIC API block:
// an on/off toggle, the listener's port, and — only while it is on — the bearer token with Copy
// and an arm-in-place Regenerate, plus the Swagger docs URL. The reminder rows sit after Attention
// sound (spec §4): sound and reminders are both attention settings, so they read together;
// font-size is unrelated and comes last. Story 2.4 froze this panel at exactly two (F3 /
// UX-DR30); a third "background work gives up after" window was added with the background-work
// latch and then removed, because claude ANNOUNCES the end of background work itself — a
// finished task wakes the session, which fires a fresh `Stop` carrying an empty
// `background_tasks`, and the card corrects itself ~4s later (probe-verified, claude 2.1.250).
// There was nothing left to time out. The reminder rows use `Select`
// (`components/Select/Select.tsx`), never a native `<select>` (banned — design.md). The
// global-hotkey-binding row stays CUT (FR-8 dropped 2026-06-19). Reachable
// from the header ☰ menu's `Settings…` row (2026-09-14; it was a `⚙` gear, EXPERIENCE.md:33), which
// App.tsx renders as `SettingsPanel` under the single-modal rule. The `Settings` gear below is kept
// only for the `#terminals` proof view. Reads the live projection off the
// renderer settings store and writes back via window.settings.set(...) through
// `persistSettingsPatch` (optimistic + persist). Changes take effect IMMEDIATELY (AC-5): the
// sound module reads the live `soundEnabled` on each attention event; `terminalFontSize` is
// persisted now and Epic-3's terminal will consume it (no terminal to preview yet — F5).
//
// Accessibility floor (Task 6.3): every control is labeled (label + control, never color-only)
// and is keyboard-operable — a real <label> for the sound checkbox and the font-size range, and
// a <span> + `ariaLabel` for the two reminder `Select` rows (a `<label for>` cannot address
// `Select`'s button — design.md).
// [Source: story 2.4 Task 6; AC-4; F3/F5; .claude/rules/state.md; src/renderer/src/styles/
//  tokens.ts (design tokens — no new colors); ColumnHeader.tsx (component/CSS-module pattern)]
import { useEffect, useState, type JSX } from 'react'
import {
  useSettings,
  selectSoundEnabled,
  selectTerminalFontSize,
  selectReminderCount,
  selectReminderFirstDelayMinutes,
  selectApiEnabled,
  selectApiPort,
  persistSettingsPatch
} from '../../stores/settingsStore'
import {
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  REMINDER_COUNT_MAX,
  REMINDER_FIRST_DELAY_OPTIONS,
  API_PORT_MIN,
  API_PORT_MAX
} from '../../../../shared/schemas/settings'
import { Select, type SelectOption } from '../Select/Select'
import { TextInput } from '../TextInput/TextInput'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { reminderSummary } from './reminderSummary'
import styles from './Settings.module.css'

/** Attention reminders — `Off`, then 1..REMINDER_COUNT_MAX. A Select value is a string. */
const REMINDER_COUNT_OPTIONS: readonly SelectOption<string>[] = Array.from(
  { length: REMINDER_COUNT_MAX + 1 },
  (_, n) => ({ value: String(n), label: n === 0 ? 'Off' : String(n) })
)
/** Attention reminders — the first-delay choices, exactly the ones the schema accepts. */
const REMINDER_DELAY_OPTIONS: readonly SelectOption<string>[] = REMINDER_FIRST_DELAY_OPTIONS.map(
  (m) => ({ value: String(m), label: `${m} min` })
)

/** The API block's ManageDialog has nothing to close — it renders no Frame and no ✕ (see the
 *  block's comment). A module-level noop keeps `useManageDialog`'s actions memo stable. */
const NO_CLOSE = (): void => {}

/**
 * Programmatic API — map a token-bridge rejection to OPERATOR copy. The raw `error.message` is
 * never rendered (design.md: map the code first). Main rejects a regenerate it could not persist
 * with `token_write_failed`; anything else (an old build with no handler, a read failure) falls
 * back to the caller's own sentence.
 */
function tokenErrorCopy(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : ''
  return code.includes('token_write_failed') ? 'Could not save the new token.' : fallback
}

/** The settings PANEL (the surface body). Split out from the gear button so it can be
 *  rendered/tested in isolation. Binds every control to the settings store + persists on
 *  change. */
export function SettingsPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const soundEnabled = useSettings(selectSoundEnabled)
  const terminalFontSize = useSettings(selectTerminalFontSize)
  const reminderCount = useSettings(selectReminderCount)
  const reminderFirstDelayMinutes = useSettings(selectReminderFirstDelayMinutes)

  // ── Programmatic API (spec 2026-09-15) ────────────────────────────────────────────────────
  // The block's own ManageDialog state: it supplies the armed `Regenerate` and the one error
  // line. `onClose` is NO_CLOSE — the block renders no Frame and no ✕, so `close()` is never
  // reachable, and a module constant keeps `actions` memo-stable for the effect below.
  const apiDialog = useManageDialog({
    title: 'API',
    testIdPrefix: 'settings-api',
    onClose: NO_CLOSE
  })
  const { actions: apiActions } = apiDialog
  const apiEnabled = useSettings(selectApiEnabled)
  const apiPort = useSettings(selectApiPort)
  // The port is edited as TEXT and committed on blur, so a half-typed `9` never reaches the
  // listener. `null` means "no edit in flight" and the field simply shows the stored port — that
  // way the stored value can change under the field with no effect syncing a copy of it
  // (react-hooks/set-state-in-effect).
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const [portInvalid, setPortInvalid] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const portValue = portDraft ?? String(apiPort)

  // The token is MAIN's — read it whenever the block is on. Turning the block OFF clears it in
  // the toggle's own handler, not here: an effect must not setState synchronously.
  useEffect(() => {
    if (!apiEnabled) return
    let alive = true
    window.api
      .getToken()
      .then((result) => {
        if (alive) setToken(result.token)
      })
      .catch((error: unknown) => {
        // Log the CODE, never the value (zod-boundaries.md) — a token is a credential.
        console.warn('[claude-watcher][api] code=token_get_failed')
        if (alive) apiActions.setError(tokenErrorCopy(error, 'Could not read the API token.'))
      })
    return () => {
      alive = false
    }
  }, [apiEnabled, apiActions])

  // The COMMITTED port, never the draft: this is the URL the running listener answers on.
  const docsUrl = `http://127.0.0.1:${apiPort}/docs`

  function setApiEnabled(next: boolean): void {
    // Switching OFF drops the token and the block's error line: there is nothing to show, and no
    // stale credential is left sitting in renderer state.
    if (!next) {
      setToken(null)
      apiActions.setError(null)
    }
    void persistSettingsPatch({ apiEnabled: next })
  }

  function commitPort(): void {
    const next = Number(portValue)
    if (!Number.isInteger(next) || next < API_PORT_MIN || next > API_PORT_MAX) {
      setPortInvalid(true)
      return
    }
    setPortInvalid(false)
    // Back to "no edit in flight": the field follows the stored port again, which
    // `persistSettingsPatch` has already updated optimistically.
    setPortDraft(null)
    if (next !== apiPort) void persistSettingsPatch({ apiPort: next })
  }

  // Main mints AND persists the new token; a rejection means the OLD one is still the live
  // credential, so the field must keep showing it rather than a token nothing accepts.
  async function regenerateToken(): Promise<void> {
    try {
      const result = await window.api.regenerateToken()
      setToken(result.token)
      apiActions.setError(null)
    } catch (error: unknown) {
      console.warn('[claude-watcher][api] code=token_regenerate_failed')
      apiActions.setError(tokenErrorCopy(error, 'Could not regenerate the API token.'))
    }
  }

  return (
    <div
      className={styles.overlay}
      data-testid="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className={styles.panel} data-testid="settings-panel">
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          {onClose && (
            <button
              type="button"
              className={styles.closeButton}
              data-testid="settings-close"
              onClick={onClose}
              aria-label="Close settings"
            >
              ✕
            </button>
          )}
        </div>

        {/* Control 1 — SOUND on/off (a labeled native checkbox; keyboard-operable). */}
        <div className={styles.row}>
          <label className={styles.label} htmlFor="settings-sound-enabled">
            Attention sound
          </label>
          <div className={styles.controlGroup}>
            <input
              id="settings-sound-enabled"
              type="checkbox"
              data-testid="settings-sound-toggle"
              checked={soundEnabled}
              onChange={(e) => {
                // Persist + apply immediately. The sound module reads the live flag (AC-5).
                void persistSettingsPatch({ soundEnabled: e.target.checked })
              }}
            />
          </div>
        </div>

        {/* Control 2 — ATTENTION REMINDERS: how many times a session still blocked on a
            permission prompt or a question is re-notified (spec 2026-09-10). 0 = Off. Sits
            directly after Attention sound (spec §4) — both are attention settings. The label
            is a <span>: a <label for> cannot address the Select's button (design.md). */}
        <div className={styles.row}>
          <span className={styles.label}>Reminders</span>
          <div className={styles.controlGroup}>
            <Select
              value={String(reminderCount)}
              options={REMINDER_COUNT_OPTIONS}
              onChange={(next) => {
                const n = Number(next)
                if (Number.isInteger(n)) void persistSettingsPatch({ reminderCount: n })
              }}
              ariaLabel="Reminders"
              testId="settings-reminder-count"
            />
          </div>
        </div>

        {/* Control 3 — the first reminder's delay; every later gap doubles. NOT rendered when
            reminders are Off (design.md: a control the operator must not use is not rendered). */}
        {reminderCount > 0 && (
          <div className={styles.row}>
            <span className={styles.label}>First reminder after</span>
            <div className={styles.controlGroup}>
              <Select
                value={String(reminderFirstDelayMinutes)}
                options={REMINDER_DELAY_OPTIONS}
                onChange={(next) => {
                  const minutes = REMINDER_FIRST_DELAY_OPTIONS.find((m) => String(m) === next)
                  if (minutes !== undefined) {
                    void persistSettingsPatch({ reminderFirstDelayMinutes: minutes })
                  }
                }}
                ariaLabel="First reminder after"
                testId="settings-reminder-first-delay"
              />
            </div>
          </div>
        )}

        <p className={styles.hint} data-testid="settings-reminder-summary">
          {reminderSummary(reminderCount, reminderFirstDelayMinutes)}
        </p>

        {/* Control 4 — TERMINAL FONT-SIZE (a labeled range + readout; keyboard-operable). */}
        <div className={styles.row}>
          <label className={styles.label} htmlFor="settings-terminal-font-size">
            Terminal font size
          </label>
          <div className={styles.controlGroup}>
            <input
              id="settings-terminal-font-size"
              type="range"
              data-testid="settings-font-size"
              min={TERMINAL_FONT_SIZE_MIN}
              max={TERMINAL_FONT_SIZE_MAX}
              step={1}
              value={terminalFontSize}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next)) {
                  void persistSettingsPatch({ terminalFontSize: next })
                }
              }}
            />
            <span className={styles.fontSizeValue} data-testid="settings-font-size-value">
              {terminalFontSize}px
            </span>
          </div>
        </div>

        {/* Control 5 — the PROGRAMMATIC API, off by default. The token, its buttons and the docs
            URL are only rendered while it is on (design.md: a control the operator must not use
            is not rendered). The Provider wraps ONLY this block: `ManageDialog.Delete` and
            `.Error` read the ManageDialog context and THROW without one, and SettingsPanel is
            not a Manage dialog. The Provider itself renders `<ManageDialogContext>` and nothing
            else — no overlay, no role=dialog, no Escape handler — so the panel is still the only
            dialog here, and `title`/`testIdPrefix` are inert (only Frame/Header/Close read them).
            `state.armed` is ONE flag per Provider and Regenerate is the block's only armable
            control; a second one would need its own Provider. */}
        <ManageDialog.Provider {...apiDialog}>
          <div className={styles.row}>
            <label className={styles.label} htmlFor="settings-api-enabled">
              Local API
            </label>
            <div className={styles.controlGroup}>
              <input
                id="settings-api-enabled"
                type="checkbox"
                data-testid="settings-api-enabled"
                checked={apiEnabled}
                onChange={(e) => setApiEnabled(e.target.checked)}
              />
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label} htmlFor="settings-api-port">
              API port
            </label>
            <div className={styles.controlGroup}>
              <span className={styles.portField}>
                <TextInput
                  id="settings-api-port"
                  testId="settings-api-port"
                  value={portValue}
                  invalid={portInvalid}
                  onChange={(next) => {
                    setPortDraft(next)
                    setPortInvalid(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPort()
                  }}
                  inputMode="numeric"
                  onBlur={commitPort}
                />
              </span>
            </div>
          </div>

          {apiEnabled && (
            <>
              <div className={styles.row}>
                <label className={styles.label} htmlFor="settings-api-token">
                  Token
                </label>
                <div className={styles.controlGroup}>
                  {/* readOnly, not disabled — a disabled field cannot be selected, and a token
                      you cannot select is one you cannot copy by hand. */}
                  <span className={styles.tokenField}>
                    <TextInput
                      id="settings-api-token"
                      testId="settings-api-token"
                      value={token ?? ''}
                      onChange={() => {}}
                      readOnly
                    />
                  </span>
                  <ManageDialog.GhostButton
                    testId="settings-api-copy"
                    onClick={() => void window.clipboard.writeText(token ?? '')}
                  >
                    Copy
                  </ManageDialog.GhostButton>
                  {/* Destructive: it invalidates every client holding the old token, so it arms
                      in place through the ONE component that owns those classes (design.md). */}
                  <ManageDialog.Delete
                    testId="settings-api-regenerate"
                    label="Regenerate"
                    confirmLabel="Confirm regenerate"
                    onConfirm={() => void regenerateToken()}
                  />
                </div>
              </div>
              <p className={styles.hint}>
                Docs: <span data-testid="settings-api-docs-url">{docsUrl}</span>
              </p>
            </>
          )}
          <ManageDialog.Error testId="settings-api-error" />
        </ManageDialog.Provider>
      </div>
    </div>
  )
}

/**
 * The header entry point: a `⚙` gear button that toggles the SettingsPanel. Mount this in the
 * app header (App.tsx). Self-contained open/close state (a tiny local view-state — not in the
 * store, since it is purely transient UI). [EXPERIENCE.md:33 — Settings via header ⚙]
 * Since 2026-09-14 only the `#terminals` proof view mounts it; the real header reaches Settings
 * through the ☰ menu (AppMenu) and App.tsx renders `SettingsPanel` from `settingsDialogOpen`.
 */
export function Settings(): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={styles.openButton}
        data-testid="settings-open"
        aria-label="Open settings"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        ⚙
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  )
}
