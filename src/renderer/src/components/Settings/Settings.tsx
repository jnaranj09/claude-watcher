// Story 2.4 — the minimal Settings surface (AC-4).
//
// FOUR controls, IN ORDER: a SOUND on/off toggle, then (spec 2026-09-10) two ATTENTION-REMINDER
// dropdowns — how many times a still-blocked session is re-notified, and the first reminder's
// delay — then a TERMINAL FONT-SIZE control. The reminder rows sit directly after Attention
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
import { useState, type JSX } from 'react'
import {
  useSettings,
  selectSoundEnabled,
  selectTerminalFontSize,
  selectReminderCount,
  selectReminderFirstDelayMinutes,
  persistSettingsPatch
} from '../../stores/settingsStore'
import {
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  REMINDER_COUNT_MAX,
  REMINDER_FIRST_DELAY_OPTIONS
} from '../../../../shared/schemas/settings'
import { Select, type SelectOption } from '../Select/Select'
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

/** The settings PANEL (the surface body). Split out from the gear button so it can be
 *  rendered/tested in isolation. Binds every control to the settings store + persists on
 *  change. */
export function SettingsPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const soundEnabled = useSettings(selectSoundEnabled)
  const terminalFontSize = useSettings(selectTerminalFontSize)
  const reminderCount = useSettings(selectReminderCount)
  const reminderFirstDelayMinutes = useSettings(selectReminderFirstDelayMinutes)

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
