// Story 2.4 — the minimal Settings surface (AC-4).
//
// TWO controls: a SOUND on/off toggle and a TERMINAL FONT-SIZE control. Story 2.4 froze this
// panel at exactly two (F3 / UX-DR30) and it is back at two: a third "background work gives up
// after" window was added with the background-work latch and then removed, because claude
// ANNOUNCES the end of background work itself — a finished task wakes the session, which fires a
// fresh `Stop` carrying an empty `background_tasks`, and the card corrects itself ~4s later
// (probe-verified, claude 2.1.250). There is nothing left to time out. The
// global-hotkey-binding row stays CUT (FR-8 dropped 2026-06-19). Reachable
// from the header via a `⚙` gear button (EXPERIENCE.md:33). Reads the live projection off the
// renderer settings store and writes back via window.settings.set(...) through
// `persistSettingsPatch` (optimistic + persist). Changes take effect IMMEDIATELY (AC-5): the
// sound module reads the live `soundEnabled` on each attention event; `terminalFontSize` is
// persisted now and Epic-3's terminal will consume it (no terminal to preview yet — F5).
//
// Accessibility floor (Task 6.3): every control has a real <label> (label + control, never
// color-only) and is keyboard-operable (native checkbox / range / number inputs).
// [Source: story 2.4 Task 6; AC-4; F3/F5; .claude/rules/state.md; src/renderer/src/styles/
//  tokens.ts (design tokens — no new colors); ColumnHeader.tsx (component/CSS-module pattern)]
import { useState, type JSX } from 'react'
import {
  useSettings,
  selectSoundEnabled,
  selectTerminalFontSize,
  persistSettingsPatch
} from '../../stores/settingsStore'
import { TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX } from '../../../../shared/schemas/settings'
import styles from './Settings.module.css'

/** The settings PANEL (the surface body). Split out from the gear button so it can be
 *  rendered/tested in isolation. Binds every control to the settings store + persists on
 *  change. */
export function SettingsPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const soundEnabled = useSettings(selectSoundEnabled)
  const terminalFontSize = useSettings(selectTerminalFontSize)

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

        {/* Control 2 — TERMINAL FONT-SIZE (a labeled range + readout; keyboard-operable). */}
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
