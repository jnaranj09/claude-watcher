import { shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { CH } from '../../shared/ipc/contract'
import { SettingsPatchSchema } from '../../shared/schemas/settings'
import { TelemetryAcknowledgeSchema, TELEMETRY_VERSION } from '../../shared/schemas/telemetry'
import type { SettingsStore } from '../persistence/settings'
import type { WorkspacesStore } from '../persistence/workspaces'
import { createWorkspacesIpcHandlers } from '../persistence/workspacesIpc'
import type { TemplatesStore } from '../persistence/templates'
import { createTemplatesIpcHandlers } from '../persistence/templatesIpc'
import type { ShortcutsStore } from '../persistence/shortcuts'
import { createShortcutsIpcHandlers } from '../persistence/shortcutsIpc'
import type { PastSessionsStore } from '../persistence/pastSessions'
import { createPastSessionsIpcHandlers } from '../persistence/pastSessionsIpc'
import type { TagsStore } from '../persistence/tags'
import { createTagsIpcHandlers } from '../persistence/tagsIpc'
import type { RulesStore } from '../persistence/rules'
import { createRulesIpcHandlers } from '../persistence/rulesIpc'
import type { TelemetryStore } from '../persistence/telemetry'
import type { RulesEngine } from '../rules/rulesEngine'
import type { AttentionTracker } from '../c9watch/attention'
import type { LaunchedSet } from '../pty/launchedSet'
import type { ApiTokenStore } from '../api/apiToken'
import type { ApiLifecycle } from '../api/apiLifecycle'
import type { ThemeScanner } from '../themes/themeScanner'
import type { ThemeLifecycle } from '../themes/themeLifecycle'
import { chosenWallpaper, themeNeedsReapply } from '../themes/themeApplyTrigger'
import { openThemesFolder } from '../themes/openThemesFolder'
import type { LaunchBoardSeam } from '../window/watchFeed'
import type { TrustedIpc } from './trustedIpc'

/** What the store-backed registrars read from the app. Every store, the theme pieces, the API
 *  token store and lifecycle are built by index.ts after app-ready, so they are GETTERS (or the
 *  `require*` functions that throw when mis-ordered); the per-window maps are owned by index.ts. */
export interface StoreIpcDeps {
  ipc: TrustedIpc
  getSettingsStore: () => SettingsStore | null
  getThemeScanner: () => ThemeScanner | null
  getThemeLifecycle: () => ThemeLifecycle | null
  getApiTokenStore: () => ApiTokenStore | null
  getApiLifecycle: () => ApiLifecycle | null
  getTelemetryStore: () => TelemetryStore | null
  requireWorkspacesStore: () => WorkspacesStore
  requireTemplatesStore: () => TemplatesStore
  requirePastSessionsStore: () => PastSessionsStore
  requireShortcutsStore: () => ShortcutsStore
  requireTagsStore: () => TagsStore
  requireRulesStore: () => RulesStore
  launchBoardSeams: Map<Electron.WebContents, LaunchBoardSeam>
  ruleEngines: Map<Electron.WebContents, RulesEngine>
  trackers: Map<Electron.WebContents, AttentionTracker>
  launchedSet: LaunchedSet
}

/** One registrar per store; index.ts calls each ONCE, in its own place in the ready block. */
export interface StoreIpc {
  registerSettingsIpc(): void
  registerThemesIpc(): void
  registerApiIpc(): void
  registerTemplatesIpc(): void
  registerPastSessionsIpc(): void
  registerTagsIpc(): void
  registerRulesIpc(): void
  registerWorkspacesIpc(): void
  registerShortcutsIpc(): void
  registerTelemetryIpc(): void
}

export function createStoreIpc(deps: StoreIpcDeps): StoreIpc {
  const {
    ipc,
    getSettingsStore,
    getThemeScanner,
    getThemeLifecycle,
    getApiTokenStore,
    getApiLifecycle,
    getTelemetryStore,
    requireWorkspacesStore,
    requireTemplatesStore,
    requirePastSessionsStore,
    requireShortcutsStore,
    requireTagsStore,
    requireRulesStore,
    launchBoardSeams,
    ruleEngines,
    trackers,
    launchedSet
  } = deps

  // Story 2.4 — register the settings IPC ONCE (mirrors registerPtyIpc): `settings:get` returns
  // the value directly; `settings:set` PARSE-AND-THROW-TYPEs the untrusted patch at the boundary
  // (zod-boundaries.md: renderer→main = THROW), then the store merges + re-validates + persists
  // and returns the new validated Settings. CH.* consts only — never a string literal.
  function registerSettingsIpc(): void {
    // settings:get — return the current validated settings (the value directly, no envelope).
    ipc.handle(CH.settingsGet, () => {
      const settingsStore = getSettingsStore()
      if (settingsStore === null) {
        // Defensive: handlers register after the store is built; if a get races construction,
        // fail loudly rather than ship garbage (the renderer's get() catch falls back to defaults).
        throw new Error('settings store not initialized')
      }
      return settingsStore.get()
    })

    // settings:set — UNTRUSTED cross-process input. Parse-and-throw-typed at THIS boundary
    // (a malformed patch rejects the invoke). Never log the value — the throw IS the signal.
    // `raw` is annotated `unknown` (Electron types it contextually as `any`) so the trust
    // boundary is explicit at the signature — the value is untrusted until SettingsPatchSchema
    // validates it. [.claude/rules/zod-boundaries.md IPC-arg row]
    ipc.handle(CH.settingsSet, (_evt, raw: unknown) => {
      const settingsStore = getSettingsStore()
      if (settingsStore === null) throw new Error('settings store not initialized')
      const patch = SettingsPatchSchema.parse(raw)
      const before = settingsStore.get()
      const next = settingsStore.set(patch)
      // Programmatic API — the listener FOLLOWS the setting: start when it is switched on, stop when
      // it is switched off, restart when the port moves. `apply` is idempotent, so the patches that
      // changed only the font size start and stop nothing (a needless restart would drop every open
      // SSE stream out from under its client). It never throws — a failed bind is logged by code and
      // leaves the lifecycle stopped, so the settings write still returns.
      getApiLifecycle()?.apply(next)
      // Custom themes — persist FIRST (the setting is the operator's choice), then apply. The
      // outcome reaches the renderer as the pushed bundle, whose id says whether the chosen theme
      // or Default landed. Only a changed theme or a changed pick for it applies: a font-size patch
      // must not re-read the disk.
      if (themeNeedsReapply(before, next))
        getThemeLifecycle()?.apply(next.themeId, chosenWallpaper(next))
      return next
    })
  }

  // Custom themes — register ONCE. `themes:list` rescans on every call (D-3: no watcher);
  // `theme:reload` re-applies the CHOSEN id; `themes:open-folder` opens the folder after a
  // `mkdir -p` so there is always something to open. Handler bodies are one line each; the logic
  // lives in themes/themeScanner.ts + themes/themeLifecycle.ts (unit-tested).
  function registerThemesIpc(): void {
    ipc.handle(CH.themesList, () => {
      const themeScanner = getThemeScanner()
      if (themeScanner === null) throw new Error('theme scanner not initialized')
      return themeScanner.scan()
    })
    ipc.handle(CH.themeReload, () => {
      const themeLifecycle = getThemeLifecycle()
      const settingsStore = getSettingsStore()
      if (themeLifecycle === null || settingsStore === null)
        throw new Error('theme lifecycle not initialized')
      const s = settingsStore.get()
      return themeLifecycle.apply(s.themeId, chosenWallpaper(s))
    })
    // Answers at once, never awaiting the opener — see openThemesFolder.ts (Linux never settles it).
    ipc.handle(CH.themesOpenFolder, () => {
      const themeScanner = getThemeScanner()
      if (themeScanner === null) throw new Error('theme scanner not initialized')
      openThemesFolder(themeScanner.dir(), {
        mkdir: (dir) => mkdirSync(dir, { recursive: true }),
        openPath: (dir) => shell.openPath(dir)
      })
    })
  }

  // Programmatic API — the token bridge, registered ONCE (mirrors registerSettingsIpc). Read-only
  // for the renderer except Regenerate: the token is not in settings.json (the renderer reads that
  // whole blob) but in its own 0600 file, so this is the only way the Settings panel can show it.
  // NEITHER handler logs the token — it IS the secret.
  function registerApiIpc(): void {
    ipc.handle(CH.apiTokenGet, () => {
      const apiTokenStore = getApiTokenStore()
      if (apiTokenStore === null) throw new Error('api token store not initialized')
      return { token: apiTokenStore.current() }
    })
    ipc.handle(CH.apiTokenRegenerate, () => {
      const apiTokenStore = getApiTokenStore()
      if (apiTokenStore === null) throw new Error('api token store not initialized')
      // A regenerate is a REVOCATION. When the write fails the store throws `token_write_failed` and
      // keeps the previous token; that throw PROPAGATES to the renderer (which maps the code to
      // operator copy) rather than being swallowed — handing back a token that exists only in this
      // process would tell the operator a revocation happened that the next start undoes.
      return { token: apiTokenStore.regenerate() }
    })
  }

  // Session templates — register ONCE (mirrors registerSettingsIpc). Handler bodies live in
  // persistence/templatesIpc.ts (unit-tested); this only binds them to CH.* channels.
  function registerTemplatesIpc(): void {
    // Called AFTER the store is built, so the handlers can be bound once instead of rebuilt on
    // every invoke. requireTemplatesStore() stays — it throws a clear error if ever mis-ordered.
    const handlers = createTemplatesIpcHandlers(requireTemplatesStore())
    ipc.handle(CH.templatesList, () => handlers.list())
    ipc.handle(CH.templatesSave, (_evt, raw: unknown) => handlers.save(raw))
    ipc.handle(CH.templatesDelete, (_evt, raw: unknown) => handlers.remove(raw))
  }

  // Past sessions — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
  // persistence/pastSessionsIpc.ts (unit-tested); this only binds `list`/`forget` to CH.* channels.
  // `session:archive`, `session:delete` and `past-sessions:open` get their bridges now but their
  // main handlers are wired later — they need the launch service and the reducer.
  function registerPastSessionsIpc(): void {
    const handlers = createPastSessionsIpcHandlers(requirePastSessionsStore())
    ipc.handle(CH.pastSessionsList, () => handlers.list())
    ipc.handle(CH.pastSessionsForget, (_evt, raw: unknown) => handlers.forget(raw))
    // CH.pastSessionOpen is bound in registerLaunchIpc (it needs the launch service) — Task 9.
  }

  // Tags — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
  // persistence/tagsIpc.ts (unit-tested). After a catalog change, every window strips the tags its
  // cards can no longer see — a deleted tag leaves each card with a `session.updated` without it
  // (spec §1.4).
  function registerTagsIpc(): void {
    const store = requireTagsStore()
    const handlers = createTagsIpcHandlers(store)
    const pruneEverywhere = (): void => {
      for (const seam of launchBoardSeams.values()) seam.pruneTags((id) => store.get(id))
    }
    ipc.handle(CH.tagsList, () => handlers.list())
    ipc.handle(CH.tagsSave, (_evt, raw: unknown) => {
      const result = handlers.save(raw)
      pruneEverywhere()
      return result
    })
    ipc.handle(CH.tagsDelete, (_evt, raw: unknown) => {
      const tags = handlers.remove(raw)
      pruneEverywhere()
      return tags
    })
  }

  // Rules — register ONCE (mirrors registerTagsIpc). Handler bodies live in persistence/rulesIpc.ts
  // (unit-tested). A change reaches every window's engine: a saved rule re-arms its timers from NOW
  // (T-13 — nothing fires at save), a deleted one cancels them. A move changes no timer.
  function registerRulesIpc(): void {
    const handlers = createRulesIpcHandlers(requireRulesStore())
    ipc.handle(CH.rulesList, () => handlers.list())
    ipc.handle(CH.rulesSave, (_evt, raw: unknown) => {
      const result = handlers.save(raw)
      for (const engine of ruleEngines.values()) engine.onRuleSaved(result.saved.id)
      return result
    })
    ipc.handle(CH.rulesDelete, (_evt, raw: unknown) => {
      const view = handlers.remove(raw)
      for (const engine of ruleEngines.values()) engine.onRulesRemoved()
      return view
    })
    ipc.handle(CH.rulesMove, (_evt, raw: unknown) => handlers.move(raw))
  }

  // Workspaces — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
  // persistence/workspacesIpc.ts (unit-tested); this only binds them to CH.* channels.
  function registerWorkspacesIpc(): void {
    const handlers = createWorkspacesIpcHandlers(requireWorkspacesStore())
    ipc.handle(CH.workspacesList, () => handlers.list())
    ipc.handle(CH.workspacesSave, (_evt, raw: unknown) => handlers.save(raw))
    ipc.handle(CH.workspacesDelete, (_evt, raw: unknown) => handlers.remove(raw))
    ipc.handle(CH.workspacesSetActive, (_evt, raw: unknown) => handlers.setActive(raw))
  }

  // Phrase shortcuts — register ONCE (mirrors registerTemplatesIpc). Handler bodies live in
  // persistence/shortcutsIpc.ts (unit-tested); this only binds them to CH.* channels. There is
  // deliberately no channel for DELIVERING a phrase — a matched chord posts it on the terminal's
  // existing MessagePort `{type:'input'}` frame.
  function registerShortcutsIpc(): void {
    // Called AFTER the store is built, so the handlers are bound once instead of rebuilt on every
    // invoke. requireShortcutsStore() stays — it throws a clear error if ever mis-ordered.
    const handlers = createShortcutsIpcHandlers(requireShortcutsStore())
    ipc.handle(CH.shortcutsList, () => handlers.list())
    ipc.handle(CH.shortcutsSave, (_evt, raw: unknown) => handlers.save(raw))
    ipc.handle(CH.shortcutsDelete, (_evt, raw: unknown) => handlers.remove(raw))
  }

  // Story 3.5 (SM-2) — register the telemetry-acknowledge IPC ONCE (mirrors registerSettingsIpc:
  // single-registration, app-global, parse-and-throw on the arg). Channels are CH.* consts only —
  // never a string literal (no-literal-channels). The arg is UNTRUSTED cross-process input →
  // TelemetryAcknowledgeSchema.parse(raw) throws a typed error on a bad arg (zod-boundaries.md
  // IPC-arg row). MAIN computes the duration (it owns tracker.enteredColumnAt). Never logs the
  // value — log path+code only (Guardrail #6; the arg carries sessionId which is an opaque UUID
  // but the rule is uniform). The invoke returns void. [story 3.5 Task 3.3 / FROZEN-3]
  function registerTelemetryIpc(): void {
    ipc.handle(CH.telemetryAcknowledge, (evt, raw: unknown) => {
      // PARSE-AND-THROW at the untrusted cross-process input boundary (zod-boundaries.md IPC-arg
      // row). A malformed arg rejects the invoke — the throw is the signal, nothing is logged here.
      const { sessionId, acknowledgedAt } = TelemetryAcknowledgeSchema.parse(raw)

      // Defensive: telemetryStore is null until app-ready (race); skip gracefully.
      // [mirrors the settingsStore === null guard in registerSettingsIpc]
      const telemetryStore = getTelemetryStore()
      if (telemetryStore === null) {
        console.warn('[c9watch][telemetry] code=telemetry_store_not_initialized')
        return
      }

      // Fetch the per-window tracker via the event sender (the tracker is per-window, keyed by wc).
      const wc = evt.sender
      const tracker = trackers.get(wc)
      if (tracker === undefined) {
        // Window has no tracker (e.g. smoke mode / destroyed window). Skip gracefully.
        console.warn('[c9watch][telemetry] code=telemetry_no_tracker sessionId=' + sessionId)
        return
      }

      // Story 3.5 FROZEN-4: if the session is NOT in a waiting column at the moment the
      // acknowledge lands (it already left needs-you/idle, or is unknown to the tracker),
      // write NO telemetry event — the wait is unmeasurable. Do NOT build a grace-period.
      const column = tracker.columnOf(sessionId)
      if (column !== 'needs-you' && column !== 'idle') {
        // Session not in a waiting column — skip (not waiting, unknown, or working). Code-only log.
        console.warn(`[c9watch][telemetry] code=telemetry_skip_not_waiting sessionId=${sessionId}`)
        return
      }

      const enteredColumnAt = tracker.enteredColumnAt(sessionId)
      if (enteredColumnAt === undefined) {
        // Should not happen if columnOf returned a value, but be defensive.
        console.warn(
          `[c9watch][telemetry] code=telemetry_skip_no_entered_at sessionId=${sessionId}`
        )
        return
      }

      // Compute the wait duration. A negative waitMs is a clock/edge anomaly — SKIP (FROZEN-4).
      const waitMs = acknowledgedAt - enteredColumnAt
      if (waitMs < 0) {
        console.warn(
          `[c9watch][telemetry] code=telemetry_skip_negative_wait sessionId=${sessionId}`
        )
        return
      }

      // Build + record the event. The launched flag comes from the per-run launched-set (SM-1 basis).
      // All fields are already validated (sessionId from parse, column from tracker, waitMs >= 0).
      try {
        telemetryStore.record({
          version: TELEMETRY_VERSION,
          kind: 'idle-wait',
          sessionId,
          column,
          enteredColumnAt,
          acknowledgedAt,
          waitMs,
          launched: launchedSet.has(sessionId)
        })
      } catch (err) {
        // The store's record() never throws itself (never-crash), but be defensive on the outer
        // path too. Code-only log — never log the event value (Guardrail #6).
        console.warn(
          '[c9watch][telemetry] code=telemetry_record_error',
          err instanceof Error ? err.message : 'unknown'
        )
      }
    })
  }

  return {
    registerSettingsIpc,
    registerThemesIpc,
    registerApiIpc,
    registerTemplatesIpc,
    registerPastSessionsIpc,
    registerTagsIpc,
    registerRulesIpc,
    registerWorkspacesIpc,
    registerShortcutsIpc,
    registerTelemetryIpc
  }
}
