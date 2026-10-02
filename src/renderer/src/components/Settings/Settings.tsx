// Settings — the app's preferences, on the ONE two-column shell (spec 2026-09-29 §3): a rail of
// categories (Notifications, Appearance, Terminal, Keyboard, API) and the chosen category's
// controls on the right. Every control persists on change through `persistSetting` (over
// `persistSettingsPatch`: optimistic + persist + rollback), so there is no Save. It opens on
// Notifications and never shows a placeholder. The panel's ONE error line carries the standing theme error whatever category is
// open. Dropdowns are `Select` (a native <select> is banned — design.md); labels of a Select are
// <span>s with `ariaLabel`. Reached from the ☰ menu's `Settings…` row (App.tsx renders
// `SettingsPanel` from `settingsDialogOpen`); the `Settings` gear below only serves `#terminals`.
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
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
  selectTerminalScheme,
  selectTerminalMenuTrigger,
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
import { SUCCESS_MS } from '../ManageDialog/manageDialogState'
import { Callout } from '../Callout/Callout'
import { Button } from '../Button/Button'
import { KeyChordRecorder } from '../ShortcutsDialog/KeyChordRecorder'
import { reminderSummary } from './reminderSummary'
import {
  FIRST_SETTINGS_CATEGORY,
  SETTINGS_CATEGORIES,
  type SettingsCategoryId
} from './settingsCategories'
import { useServerHealth } from '../../hooks/useServerHealth'
import { useFlash } from '../../hooks/useFlash'
import { useAsyncAction } from '../../hooks/useAsyncAction'
import type {
  SettingsPatch,
  TerminalMenuTrigger,
  TerminalScheme
} from '../../../../shared/schemas/settings'
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

/** Terminal colours (spec 2026-09-30) — follow the theme, or a built-in palette. */
const TERMINAL_SCHEME_OPTIONS: readonly SelectOption<TerminalScheme>[] = [
  { value: 'theme', label: 'Follow theme' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

/** Which click opens the terminal Copy/Paste menu. */
const TERMINAL_MENU_TRIGGER_OPTIONS: readonly SelectOption<TerminalMenuTrigger>[] = [
  { value: 'right-click', label: 'Right-click' },
  { value: 'shift-right-click', label: 'Shift + Right-click' },
  { value: 'ctrl-right-click', label: 'Ctrl + Right-click' }
]

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

  // ── Action feedback (spec 2026-09-29 §2.1) ────────────────────────────────────────────────
  // Every change says it landed: a compact `Saved` callout beside the pane heading for SUCCESS_MS. When main refuses
  // one, persistSettingsPatch has already rolled the store back to main's value (the control
  // snaps back) and the error line names what did not save — until the next change that lands.
  // The flash holds the CATEGORY it was saved on, so it never follows a switch to another page.
  const [savedOn, flashSaved, clearSaved] = useFlash<SettingsCategoryId>(SUCCESS_MS)
  // The refusal goes on the panel's ONE error state (apiActions.setError), so a newer error — a bad
  // port, a failed copy — always replaces it. A later save clears the line only while it still
  // holds the refusal it wrote, never a newer, different error. Both refs are read in callbacks
  // only: `errorNow` mirrors the dialog's error after each render (the latest-value pattern).
  const errorNow = useRef<string | null>(null)
  const saveErrorShown = useRef<string | null>(null)
  useLayoutEffect(() => {
    errorNow.current = dialog.state.error
  })
  // Each result text is a constant on its button (`feedback`); these only say WHEN it shows.
  const [copied, flashCopied] = useFlash<true>()
  const [reloaded, flashReloaded] = useFlash<true>()
  const [newToken, flashNewToken] = useFlash<true>()

  /** The ONE wrapper every control persists through. `what` is operator copy (`the API port`),
   *  never a value. Never rejects. */
  function persistSetting(patch: SettingsPatch, what: string): Promise<void> {
    const savedFrom = category
    return persistSettingsPatch(patch).then(
      () => {
        if (saveErrorShown.current !== null && errorNow.current === saveErrorShown.current) {
          apiActions.setError(null)
        }
        saveErrorShown.current = null
        flashSaved(savedFrom)
      },
      () => {
        const message = `Could not save ${what}.`
        saveErrorShown.current = message
        errorNow.current = message
        clearSaved()
        apiActions.setError(message)
      }
    )
  }
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
  const terminalScheme = useSettings(selectTerminalScheme)
  const terminalMenuTrigger = useSettings(selectTerminalMenuTrigger)
  const bundle = useTheme(selectThemeBundle)
  const [summaries, setSummaries] = useState<ThemeSummary[]>([])
  // Until the first list answers, a non-default theme has no name to show: the trigger says
  // `Loading…`, never the raw folder id (spec 2026-09-29 §2.1).
  const [themesLoaded, setThemesLoaded] = useState(false)
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
        if (!alive) return
        setSummaries(result)
        setThemesLoaded(true)
      })
      .catch(() => {
        console.warn('[claude-watcher][themes] code=list_failed')
        if (!alive) return
        setThemesLoaded(true)
        apiActions.setError('Could not read the themes folder.')
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
    themeOptions.push({ value: themeId, label: themesLoaded ? themeId : 'Loading…' })
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
    void persistSetting({ themeId: next }, 'the theme').finally(() => setThemeSwitching(false))
  }

  async function reloadThemes(): Promise<void> {
    try {
      await window.themes.reload()
      flashReloaded(true)
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
    void persistSetting({ apiEnabled: next }, 'the Local API setting')
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
    if (next !== apiPort) void persistSetting({ apiPort: next }, 'the API port')
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
      flashNewToken(true)
    } catch (error: unknown) {
      console.warn('[claude-watcher][api] code=token_regenerate_failed')
      apiActions.setError(tokenErrorCopy(error, 'Could not regenerate the API token.'))
    }
  }

  // A failed copy says so: it used to be an unhandled rejection (and copied '' before the read).
  function copyToken(value: string): void {
    void window.clipboard.writeText(value).then(
      () => flashCopied(true),
      () => {
        console.warn('[claude-watcher][api] code=token_copy_failed') // never the token
        apiActions.setError('Could not copy the token.')
      }
    )
  }

  // One in flight at a time each — a second press starts nothing (Regenerate used to mint twice).
  // Declared AFTER the three functions they wrap, so nothing is read before it is defined.
  const reload = useAsyncAction(reloadThemes)
  const openFolder = useAsyncAction(openThemesFolder)
  const regenerate = useAsyncAction(regenerateToken)

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
            <div className={styles.paneHeading}>
              <h3 className={styles.categoryTitle}>{categoryLabel}</h3>
              {/* The slot is the live region, always in the page, so `Saved` is announced when it
                  appears; the callout inside it does not announce a second time. */}
              <span className={styles.savedSlot} role="status" data-testid="settings-saved">
                {savedOn === category && (
                  <Callout tone="success" size="compact" title="Saved" announce={false} />
                )}
              </span>
            </div>
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
                        void persistSetting(
                          { soundEnabled: e.target.checked },
                          'the attention sound'
                        )
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
                        void persistSetting(
                          { notificationsEnabled: e.target.checked },
                          'desktop notifications'
                        )
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
                        if (Number.isInteger(n))
                          void persistSetting({ reminderCount: n }, 'the reminders')
                      }}
                      ariaLabel="Reminders"
                      testId="settings-reminder-count"
                      align="end"
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
                            void persistSetting(
                              { reminderFirstDelayMinutes: minutes },
                              'the first reminder delay'
                            )
                          }
                        }}
                        ariaLabel="First reminder after"
                        testId="settings-reminder-first-delay"
                        align="end"
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
                      align="end"
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
                          void persistSetting(
                            { wallpaperByTheme: { ...wallpaperByTheme, [themeId]: next } },
                            'the wallpaper'
                          )
                        }
                        ariaLabel="Wallpaper"
                        testId="settings-wallpaper"
                        align="end"
                      />
                    </div>
                  </div>
                )}
                <div className={styles.themeActions}>
                  <ManageDialog.GhostButton
                    testId="settings-theme-reload"
                    busy={reload.busy}
                    feedback="✓ Reloaded"
                    feedbackShown={reloaded !== null}
                    onClick={() => void reload.run()}
                  >
                    Reload themes
                  </ManageDialog.GhostButton>
                  <ManageDialog.GhostButton
                    testId="settings-theme-open-folder"
                    busy={openFolder.busy}
                    onClick={() => void openFolder.run()}
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
                {/* Terminal colours (spec 2026-09-30): follow the theme, or a built-in dark / light
                    palette whatever the app theme is. Every open terminal re-themes live. */}
                <div className={styles.row}>
                  <span className={styles.label}>Terminal colours</span>
                  <div className={styles.controlGroup}>
                    <Select
                      value={terminalScheme}
                      options={TERMINAL_SCHEME_OPTIONS}
                      onChange={(next) =>
                        void persistSetting({ terminalScheme: next }, 'the terminal colours')
                      }
                      ariaLabel="Terminal colours"
                      testId="settings-terminal-scheme"
                      align="end"
                    />
                  </div>
                </div>
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
                          void persistSetting({ terminalFontSize: next }, 'the terminal font size')
                        }
                      }}
                    />
                    <span className={styles.fontSizeValue} data-testid="settings-font-size-value">
                      {terminalFontSize}px
                    </span>
                  </div>
                </div>

                <div className={styles.row}>
                  <span className={styles.label}>Copy/paste menu opens with</span>
                  <div className={styles.controlGroup}>
                    <Select
                      value={terminalMenuTrigger}
                      options={TERMINAL_MENU_TRIGGER_OPTIONS}
                      onChange={(next) =>
                        void persistSetting(
                          { terminalMenuTrigger: next },
                          'the copy/paste menu click'
                        )
                      }
                      ariaLabel="Copy/paste menu opens with"
                      testId="settings-terminal-menu-trigger"
                      align="end"
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Change this if claude runs its full-screen renderer with mouse support: there,
                  right-click already pastes. Shift + Right-click is never sent to claude.
                </p>
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
                        void persistSetting({ expanderKey: chord.slice(-1) }, 'the shortcut chord')
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
                        {/* Not rendered until main answered with the token: before, it copied ''. */}
                        {token !== null && (
                          <ManageDialog.GhostButton
                            testId="settings-api-copy"
                            feedback="✓ Copied"
                            feedbackShown={copied !== null}
                            onClick={() => copyToken(token)}
                          >
                            Copy
                          </ManageDialog.GhostButton>
                        )}
                        {/* Destructive: it invalidates every client holding the old token, so it arms
                            in place through the ONE component that owns those classes (design.md).
                            Busy while main mints: a second press cannot mint a second token. */}
                        <ManageDialog.Delete
                          testId="settings-api-regenerate"
                          label="Regenerate"
                          confirmLabel="Confirm regenerate"
                          busy={regenerate.busy}
                          feedback="✓ New token"
                          feedbackShown={newToken !== null}
                          onConfirm={() => void regenerate.run()}
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
        <ManageDialog.Message testId="settings-error" />
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
