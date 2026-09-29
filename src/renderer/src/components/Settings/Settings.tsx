// Settings — the app's preferences, on the ONE two-column shell (spec 2026-09-29 §3): a rail of
// categories (Notifications, Appearance, Terminal, Keyboard, API) and the chosen category's
// controls on the right. Every control persists on change through `persistSettingsPatch`
// (optimistic + persist), so there is no Save. It opens on Notifications and never shows a
// placeholder. The panel's ONE error line carries the standing theme error whatever category is
// open. Dropdowns are `Select` (a native <select> is banned — design.md); labels of a Select are
// <span>s with `ariaLabel`. Reached from the ☰ menu's `Settings…` row (App.tsx renders
// `SettingsPanel` from `settingsDialogOpen`); the `Settings` gear below only serves `#terminals`.
import { useEffect, useState, type JSX } from 'react'
import {
  useSettings,
  selectSoundEnabled,
  selectNotificationsEnabled,
  selectTerminalFontSize,
  selectReminderCount,
  selectReminderFirstDelayMinutes,
  selectApiEnabled,
  selectApiPort,
  selectThemeId,
  selectWallpaperByTheme,
  selectExpanderKey,
  persistSettingsPatch
} from '../../stores/settingsStore'
import {
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_MAX,
  REMINDER_COUNT_MAX,
  REMINDER_FIRST_DELAY_OPTIONS,
  API_PORT_MIN,
  API_PORT_MAX,
  expanderChord
} from '../../../../shared/schemas/settings'
import { useTheme, selectThemeBundle } from '../../stores/themeStore'
import type { ThemeSummary } from '../../../../shared/schemas/theme'
import { DEFAULT_THEME_ID } from '../../../../shared/schemas/theme'
import { brokenThemesLine, themeErrorCopy } from '../../lib/themeCopy'
import { Select, type SelectOption } from '../Select/Select'
import { TextInput } from '../TextInput/TextInput'
import { ManageDialog, useManageDialog } from '../ManageDialog/ManageDialog'
import { Button } from '../Button/Button'
import { KeyChordRecorder } from '../ShortcutsDialog/KeyChordRecorder'
import { reminderSummary } from './reminderSummary'
import {
  FIRST_SETTINGS_CATEGORY,
  SETTINGS_CATEGORIES,
  type SettingsCategoryId
} from './settingsCategories'
import { useServerHealth } from '../../hooks/useServerHealth'
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

/** `#terminals`' gear passes no onClose in tests; a module constant keeps the actions memo
 *  stable. (The header ✕ always renders; with NO_CLOSE it does nothing — the real app always
 *  passes `onClose`.) */
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
  const notificationsEnabled = useSettings(selectNotificationsEnabled)
  const terminalFontSize = useSettings(selectTerminalFontSize)
  const reminderCount = useSettings(selectReminderCount)
  const reminderFirstDelayMinutes = useSettings(selectReminderFirstDelayMinutes)

  // ONE ManageDialog for the whole panel (spec 2026-09-29 §3): the category rail is its selection
  // (opens on the first category, so there is never a placeholder), Regenerate is its one armable
  // control, and its error line is the panel's one error line.
  const dialog = useManageDialog({
    title: 'Settings',
    testIdPrefix: 'settings',
    onClose: onClose ?? NO_CLOSE,
    initialSelectedId: FIRST_SETTINGS_CATEGORY,
    // A category switch disarms Regenerate but keeps the error line: it describes the panel.
    keepErrorOnSelect: true
  })
  const { actions: apiActions } = dialog
  const category = (dialog.state.selectedId ?? FIRST_SETTINGS_CATEGORY) as SettingsCategoryId
  const categoryLabel =
    SETTINGS_CATEGORIES.find((c) => c.id === category)?.label ?? SETTINGS_CATEGORIES[0]?.label
  const expanderKey = useSettings(selectExpanderKey)

  // ── Programmatic API (spec 2026-09-15) ────────────────────────────────────────────────────
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

  // ── Custom themes (spec 2026-09-20) ───────────────────────────────────────────────────────
  const themeId = useSettings(selectThemeId)
  const bundle = useTheme(selectThemeBundle)
  const [summaries, setSummaries] = useState<ThemeSummary[]>([])
  // Bumped by Reload to re-run the listing effect below — the effect itself owns the ONE
  // fetch-then-setState call site (react-hooks/set-state-in-effect: setState must land inside a
  // `.then()`/`.catch()` literally in the effect body, never via a named async helper called
  // from it — the Settings token-read effect above is the precedent).
  const [themeListGeneration, setThemeListGeneration] = useState(0)

  // Rescan on open (D-3) and after a Reload (bumps `themeListGeneration`). Never throws past
  // here: a failed list keeps Default selectable and puts mapped copy on the one error line.
  useEffect(() => {
    let alive = true
    window.themes
      .list()
      .then((result) => {
        if (alive) setSummaries(result)
      })
      .catch(() => {
        console.warn('[claude-watcher][themes] code=list_failed')
        if (alive) apiActions.setError('Could not read the themes folder.')
      })
    return () => {
      alive = false
    }
  }, [apiActions, themeListGeneration])

  // Default first, then the loadable ones ordered by NAME (the picker's own label).
  const loadable = summaries
    .filter((s) => s.error === undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
  const themeOptions: SelectOption<string>[] = [
    { value: DEFAULT_THEME_ID, label: 'Default' },
    ...loadable.map((s) => ({ value: s.id, label: s.name }))
  ]
  // The picker never sits on a value it does not offer (design.md): a chosen theme that is
  // broken or gone stays listed under its own id so the operator sees what is set.
  if (!themeOptions.some((o) => o.value === themeId)) {
    themeOptions.push({ value: themeId, label: themeId })
  }
  const brokenLine = brokenThemesLine(summaries)
  const chosenSummary = summaries.find((s) => s.id === themeId)
  const chosenName = chosenSummary?.name ?? themeId
  // Theme wallpapers (spec 2026-09-24): offered only for the theme that actually LOADED (the
  // bundle names it) and only with a real choice — design.md: a control the operator cannot use
  // is not rendered. The value is what landed (`bundle.wallpaperId`), so a stale pick that fell
  // back shows the wallpaper on screen, never a value the list does not offer.
  const wallpaperByTheme = useSettings(selectWallpaperByTheme)
  const wallpaperOptions: SelectOption<string>[] =
    bundle.id === themeId && bundle.wallpaperId !== null
      ? (chosenSummary?.wallpapers ?? []).map((w) => ({ value: w.id, label: w.name }))
      : []
  const appliedWallpaper = bundle.wallpaperId
  // D-7: the setting is kept; the bundle's id says what actually landed. Finding 1(b): name the
  // REASON too, not just "could not be loaded" — the chosen theme's own summary now carries the
  // same code a full package validation (manifest + CSS + assets, themeScanner.ts scan()) would
  // have found, whether the mismatch was discovered at startup or after a Reload.
  const chosenReason = chosenSummary?.error !== undefined ? themeErrorCopy(chosenSummary) : null
  // R12 (related) — a pick in flight: the setting changes at once (optimistic), the bundle lands
  // when main answers. Main applies BEFORE it answers the settings write, so once the write
  // resolves the bundle says the real outcome; until then a mismatch is not a failure.
  const [themeSwitching, setThemeSwitching] = useState(false)
  const themeError =
    bundle.id !== themeId && !themeSwitching
      ? `Theme "${chosenName}" could not be loaded, using Default${chosenReason !== null ? ` — ${chosenReason}` : ''}`
      : null
  // R12 — the theme error is a STANDING condition, derived on every render and shown on the ONE
  // error line in place of the API/theme-action error (`themeError ?? state.error`). It used to be
  // copied INTO that state, where any flow that cleared the line (a good port, the API switched
  // off, a regenerate) wiped it while the theme was still broken.
  const errorLine = themeError ?? dialog.state.error

  function pickTheme(next: string): void {
    setThemeSwitching(true)
    void persistSettingsPatch({ themeId: next }).finally(() => setThemeSwitching(false))
  }

  async function reloadThemes(): Promise<void> {
    try {
      await window.themes.reload()
    } catch {
      console.warn('[claude-watcher][themes] code=reload_failed')
      apiActions.setError('Could not reload themes.')
    }
    setThemeListGeneration((g) => g + 1)
  }

  // Never rendered thrown (design.md): a failed open is mapped copy on the shared error line,
  // same treatment as `reloadThemes` and every other async call in this file — never a silent
  // unhandled rejection.
  async function openThemesFolder(): Promise<void> {
    try {
      await window.themes.openFolder()
    } catch {
      console.warn('[claude-watcher][themes] code=open_folder_failed')
      apiActions.setError('Could not open the themes folder.')
    }
  }

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
  const apiHealth = useServerHealth()?.api
  const apiDown =
    apiHealth === 'port_in_use'
      ? `The API is not running: port ${apiPort} is used by another program. Choose another port.`
      : apiHealth === 'failed'
        ? `The API is not running: it could not listen on port ${apiPort}. Choose another port.`
        : null

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
      // `aria-invalid` is never the ONLY signal (design.md / UX-DR29): the block's one error line
      // has to say what is wrong, and it names the range so the fix needs no guessing.
      apiActions.setError(`Port must be between ${API_PORT_MIN} and ${API_PORT_MAX}.`)
      return
    }
    setPortInvalid(false)
    apiActions.setError(null)
    // Back to "no edit in flight": the field follows the stored port again, which
    // `persistSettingsPatch` has already updated optimistically.
    setPortDraft(null)
    if (next !== apiPort) void persistSettingsPatch({ apiPort: next })
  }

  // Main mints AND persists the new token; a rejection means the OLD one is still the live
  // credential, so the field must keep showing it rather than a token nothing accepts.
  //
  // `ManageDialog.Delete` never disarms ITSELF — a refused action stays armed so a second press
  // retries it, and the host dialog disarms on the way out (the Manage dialogs do it via
  // `select(null)`). This block has no such exit, so it disarms here, on the SUCCESS path only:
  // without it the button keeps reading `Confirm regenerate` and the next single press mints
  // another token with no arming step.
  async function regenerateToken(): Promise<void> {
    try {
      const result = await window.api.regenerateToken()
      setToken(result.token)
      apiActions.setError(null)
      apiActions.disarm()
    } catch (error: unknown) {
      console.warn('[claude-watcher][api] code=token_regenerate_failed')
      apiActions.setError(tokenErrorCopy(error, 'Could not regenerate the API token.'))
    }
  }

  return (
    <ManageDialog.Provider {...dialog} state={{ ...dialog.state, error: errorLine }}>
      <ManageDialog.Frame>
        <ManageDialog.Header />
        <ManageDialog.Columns>
          <ManageDialog.List>
            <ManageDialog.Rows>
              {SETTINGS_CATEGORIES.map((c) => (
                <ManageDialog.Row key={c.id} id={c.id} testId={`settings-category-${c.id}`}>
                  {c.label}
                </ManageDialog.Row>
              ))}
            </ManageDialog.Rows>
          </ManageDialog.List>
          <ManageDialog.Pane testId={`settings-pane-${category}`}>
            <h3 className={styles.categoryTitle}>{categoryLabel}</h3>
            {category === 'notifications' && (
              <>
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

                {/* UX-13 — desktop POPUPS on/off (the first alert and every reminder). The sound above is
                    its own toggle. Main reads the setting live on every alert. */}
                <div className={styles.row}>
                  <label className={styles.label} htmlFor="settings-notifications-enabled">
                    Desktop notifications
                  </label>
                  <div className={styles.controlGroup}>
                    <input
                      id="settings-notifications-enabled"
                      type="checkbox"
                      data-testid="settings-notifications-toggle"
                      checked={notificationsEnabled}
                      onChange={(e) => {
                        void persistSettingsPatch({ notificationsEnabled: e.target.checked })
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
                          const minutes = REMINDER_FIRST_DELAY_OPTIONS.find(
                            (m) => String(m) === next
                          )
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
              </>
            )}
            {category === 'appearance' && (
              <>
                {/* Custom themes — the picker (a Select; never a native <select>), a Wallpaper picker when
                    the applied theme lists 2+ (spec 2026-09-24), the two actions, the
                    broken-themes helper line (D-8: never a disabled row) and the transparency hint. */}
                <div className={styles.row}>
                  <span className={styles.label}>Theme</span>
                  <div className={styles.controlGroup}>
                    <Select
                      value={themeId}
                      options={themeOptions}
                      onChange={pickTheme}
                      ariaLabel="Theme"
                      testId="settings-theme"
                    />
                  </div>
                </div>
                {wallpaperOptions.length >= 2 && appliedWallpaper !== null && (
                  <div className={styles.row}>
                    <span className={styles.label}>Wallpaper</span>
                    <div className={styles.controlGroup}>
                      <Select
                        value={appliedWallpaper}
                        options={wallpaperOptions}
                        onChange={(next) =>
                          void persistSettingsPatch({
                            wallpaperByTheme: { ...wallpaperByTheme, [themeId]: next }
                          })
                        }
                        ariaLabel="Wallpaper"
                        testId="settings-wallpaper"
                      />
                    </div>
                  </div>
                )}
                <div className={styles.themeActions}>
                  <ManageDialog.GhostButton
                    testId="settings-theme-reload"
                    onClick={() => void reloadThemes()}
                  >
                    Reload themes
                  </ManageDialog.GhostButton>
                  <ManageDialog.GhostButton
                    testId="settings-theme-open-folder"
                    onClick={() => void openThemesFolder()}
                  >
                    Open themes folder
                  </ManageDialog.GhostButton>
                </div>
                {brokenLine !== null && (
                  <p className={styles.hint} data-testid="settings-theme-broken">
                    {brokenLine}
                  </p>
                )}
                {bundle.terminal.allowTransparency === true && (
                  <p className={styles.hint} data-testid="settings-theme-transparency">
                    Transparency applies to terminals opened from now on.
                  </p>
                )}
              </>
            )}
            {category === 'terminal' && (
              <>
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
              </>
            )}
            {category === 'keyboard' && (
              <>
                <div className={styles.row}>
                  <span className={styles.label}>Open shortcuts with</span>
                  <div className={styles.controlGroup}>
                    <KeyChordRecorder
                      value={expanderChord(expanderKey)}
                      onChange={(chord) => {
                        // The chord is `Ctrl+Alt+<letter>`; the letter is the last character.
                        void persistSettingsPatch({ expanderKey: chord.slice(-1) })
                      }}
                    />
                  </div>
                </div>
                <p className={styles.hint}>Opens the shortcut box inside the focused terminal.</p>
              </>
            )}
            {category === 'api' && (
              <>
                {/* Control 5 — the PROGRAMMATIC API, off by default. The token, its buttons and the docs
                    URL are only rendered while it is on (design.md: a control the operator must not use
                    is not rendered). */}
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
                    {/* R11 — a listener that did not bind has no Docs URL to offer. The next change
                        in this panel retries the bind. */}
                    {apiDown !== null ? (
                      <p className={styles.hint} data-testid="settings-api-down">
                        {apiDown}
                      </p>
                    ) : (
                      <p className={styles.hint}>
                        Docs: <span data-testid="settings-api-docs-url">{docsUrl}</span>
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </ManageDialog.Pane>
        </ManageDialog.Columns>
        <ManageDialog.Error testId="settings-error" />
      </ManageDialog.Frame>
    </ManageDialog.Provider>
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
      <Button
        variant="ghost"
        size="sm"
        icon
        testId="settings-open"
        aria-label="Open settings"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        ⚙
      </Button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  )
}
