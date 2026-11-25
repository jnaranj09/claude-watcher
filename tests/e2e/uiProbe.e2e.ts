// Guard `ui-probe` (design.md "UI pipeline" stage 7): the layout probe, the action probe and the
// reduced-motion pass, on the board and every state the header opens, at each probed width
// (projects `w900`, the narrowest supported width, and `w1400`, the main desktop width; the width
// reaches the app through tests/e2e/probeFixtures.ts). Seed: a fresh, empty data folder, so every
// list dialog shows its empty state.
//
// LAYOUT (each state, each width): axe (WCAG 2.0–2.2 A/AA; `target-size` must have run), no
// horizontal overflow (`scrollWidth > innerWidth`, or a visible box past the window's edge), every
// interactive control at least TARGET × TARGET px (a checkbox or radio inside its `<label>` is
// measured by the label, the box a click lands on), every text field, select and checkbox with an
// accessible name (a placeholder is no name), and each list dialog's empty-state sentence.
// TARGET is 24 px, WCAG 2.2 AA 2.5.8 (owner decision): the guard's default 44 px would fail by
// design, since Button's fixed heights are 32 (md), 28 (sm) and 20 (xs) px (design.md "Banned
// primitives"). The input `font-size` ≥ 16 px check is N/A: a desktop Electron app, there is no
// iOS zoom on focus to prevent.
//
// ACTION PROBE: every action control of a state has an entry in ACTIONS: `view` (pressing it must
// change the page's accessibility snapshot), `request` (also: with its channel failing, an error
// Callout or toast (`role="alert"`) must show; with its channel slow, the control gets
// `aria-busy`, keeps its box, and two clicks in one task (before React re-renders, what a fast
// double press can do) send ONE request) or `skip` with a reason. A control with no entry fails,
// and so does an entry with no control. A press that opens a dialog STATES lacks fails.
//
// REDUCED MOTION: with `prefers-reduced-motion: reduce` emulated (checked through matchMedia), no
// infinite animation runs on the board, in any state, or on a needs-you card. The card comes from
// a launch of a stand-in claude (CLAUDE_WATCHER_CLAUDE_BIN, probeFixtures.ts) and a `Stop` hook
// POST, as tests/e2e/native-engine.e2e.ts drives a real one; CI has no claude.
//
// ALLOWED: state → problem → reason (and the widths it shows at). It only shrinks: an entry whose
// problem is gone fails as stale.
import AxeBuilder from '@axe-core/playwright'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { CH, type Channel } from '../../src/shared/ipc/contract'
import { countIpc, expect, failIpc, postHook, slowIpc, test, waitForBoard } from './probeFixtures'
import { hookPathOf, waitForClaudeDescendant } from './support/proc'

const TARGET = 24
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

interface State {
  name: string
  /** `data-testid` of the state's `role="dialog"` element; null for the board. */
  dialog: string | null
  open: (page: Page) => Promise<void>
  /** The empty-state sentence a list shows on the empty seed. */
  empty?: string
}

async function fromMenu(page: Page, path: readonly string[]): Promise<void> {
  await page.getByTestId('app-menu').click()
  for (const id of path) await page.getByTestId(id).click()
}

const menuState = (name: string, prefix: string, path: string[], empty?: string): State => ({
  name,
  dialog: `${prefix}-overlay`,
  open: (page) => fromMenu(page, path),
  ...(empty === undefined ? {} : { empty })
})

/** The board, every dialog the header menu opens, and what the header's own buttons open. */
const STATES: readonly State[] = [
  {
    name: 'board',
    dialog: null,
    // After a reload the board shows its skeleton until the engine says it started.
    open: (page) => expect(page.getByTestId('empty-board')).toBeVisible({ timeout: 10000 }),
    empty: 'No sessions yet.'
  },
  {
    name: 'new-session',
    dialog: 'new-session-menu',
    open: (page) => page.getByTestId('header-new-session').click()
  },
  {
    name: 'goals',
    dialog: 'goals-overlay',
    open: (page) => page.getByTestId('header-goals').click()
  },
  menuState('settings', 'settings', ['app-menu-settings']),
  menuState(
    'shortcuts',
    'shortcuts',
    ['app-menu-shortcuts'],
    'No shortcuts yet. Add one and give it an alias like ht.'
  ),
  menuState('tags', 'tags', ['app-menu-tags', 'tags-menu-manage-tags'], 'No tags yet'),
  menuState('rules', 'tags', ['app-menu-tags', 'tags-menu-manage-rules'], 'No rules yet'),
  menuState(
    'memory',
    'memory',
    ['app-menu-memory'],
    'Nothing saved yet. Memory fills as sessions run.'
  ),
  menuState(
    'sessions-active',
    'sessions',
    ['app-menu-sessions', 'sessions-menu-active'],
    'No sessions are running.'
  ),
  menuState(
    'sessions-past',
    'sessions',
    ['app-menu-sessions', 'sessions-menu-past'],
    'No past sessions yet.'
  ),
  menuState(
    'sessions-templates',
    'sessions',
    ['app-menu-sessions', 'sessions-menu-templates'],
    'No templates yet'
  ),
  menuState('sessions-import', 'sessions', ['app-menu-sessions', 'sessions-menu-import'])
]

/** Every header-menu row: a submenu, or the state it opens (its path's last id). */
const MENU_SUBMENUS = ['app-menu-tags', 'app-menu-sessions']

/** The skip reason of a page, category or rail row that is already the current one: pressing it
 *  is a no-op by design (design.md "One selected look"). */
const CURRENT_ROW = 'already the current row; pressing it changes nothing by design'

type Action =
  | { kind: 'view' }
  | { kind: 'request'; channel: Channel; prepare?: (page: Page) => Promise<void> }
  | { kind: 'skip'; why: string }

const VIEW: Action = { kind: 'view' }
/** A switch or checkbox that writes one setting (`settings:set`). */
const SETTING: Action = { kind: 'request', channel: CH.settingsSet }

/** Each state's action controls (by `data-testid`, else `<role or tag>:<name>`). */
const ACTIONS: Record<string, Record<string, Action>> = {
  board: {
    'workspace-switcher': VIEW,
    'header-goals': VIEW,
    'header-new-session': VIEW,
    'app-menu': VIEW,
    'new-session': VIEW,
    'empty-board-past-sessions': VIEW
  },
  'new-session': {
    'menu-pick-folder': {
      kind: 'skip',
      why: 'opens the native folder picker, then launches claude; launch.e2e.ts drives it'
    },
    'menu-manage': VIEW
  },
  goals: {
    'goals-close': VIEW,
    'goal-select-daily': { kind: 'skip', why: CURRENT_ROW },
    'goal-new': VIEW
  },
  settings: {
    'settings-close': VIEW,
    'button:Notifications': { kind: 'skip', why: CURRENT_ROW },
    'button:Appearance': VIEW,
    'button:Terminal': VIEW,
    'button:Memory': VIEW,
    'button:Keyboard': VIEW,
    'button:API': VIEW,
    'settings-sound-toggle': SETTING,
    'settings-notifications-toggle': SETTING,
    'settings-reminder-count': VIEW,
    'settings-reminder-first-delay': VIEW
  },
  shortcuts: {
    'shortcut-scope-filter': VIEW,
    'shortcut-include-global': SETTING,
    'shortcuts-close': VIEW,
    'shortcut-new': VIEW
  },
  tags: {
    'tag-scope-filter': VIEW,
    'tag-include-global': SETTING,
    'tags-close': VIEW,
    'tags-page-tags': { kind: 'skip', why: CURRENT_ROW },
    'tags-page-rules': VIEW,
    'tag-new': VIEW
  },
  rules: {
    'rule-scope-filter': VIEW,
    'rule-include-global': SETTING,
    'tags-close': VIEW,
    'tags-page-tags': VIEW,
    'tags-page-rules': { kind: 'skip', why: CURRENT_ROW },
    'rule-new': VIEW
  },
  memory: {
    'memory-scope-filter': VIEW,
    'memory-include-global': SETTING,
    'memory-show-stale': VIEW,
    'memory-close': VIEW,
    'memory-page-specific': { kind: 'skip', why: CURRENT_ROW },
    'memory-page-fact': VIEW,
    'memory-page-episode': VIEW,
    'memory-page-command': VIEW,
    'memory-new': VIEW
  },
  'sessions-active': {
    'active-session-scope-filter': VIEW,
    'sessions-close': VIEW,
    'sessions-page-active': { kind: 'skip', why: CURRENT_ROW },
    'sessions-page-past': VIEW,
    'sessions-page-templates': VIEW,
    'sessions-page-import': VIEW,
    'active-filter-toggle': VIEW
  },
  'sessions-past': {
    'past-session-scope-filter': VIEW,
    'sessions-close': VIEW,
    'sessions-page-active': VIEW,
    'sessions-page-past': { kind: 'skip', why: CURRENT_ROW },
    'sessions-page-templates': VIEW,
    'sessions-page-import': VIEW,
    'past-filter-toggle': VIEW
  },
  'sessions-templates': {
    'template-scope-filter': VIEW,
    'template-include-global': SETTING,
    'sessions-close': VIEW,
    'sessions-page-active': VIEW,
    'sessions-page-past': VIEW,
    'sessions-page-templates': { kind: 'skip', why: CURRENT_ROW },
    'sessions-page-import': VIEW,
    'template-new': VIEW
  },
  'sessions-import': {
    'sessions-close': VIEW,
    'sessions-page-active': VIEW,
    'sessions-page-past': VIEW,
    'sessions-page-templates': VIEW,
    'sessions-page-import': { kind: 'skip', why: CURRENT_ROW },
    'import-workspace': VIEW,
    'import-submit': {
      kind: 'request',
      channel: CH.pastSessionImport,
      prepare: (page) =>
        page.getByTestId('import-session-id').fill('00000000-0000-4000-8000-000000000000')
    }
  }
}

interface Allowed {
  why: string
  /** The widths it shows at; both when absent. */
  widths?: readonly number[]
}

/** Problems that existed when this spec landed (2026-11-24), each with its reason. */
const NO_LANG: Allowed = {
  why: '`src/renderer/index.html` has no `lang` on <html> (one-line app fix, not done yet)'
}
const NAME_MISMATCH: Allowed = {
  why: 'a control whose aria-label does not contain its visible text (to fix per control)'
}
const SWITCH_TRACK: Allowed = {
  why: 'the Switch track is 34 × 20 px (`components/Switch`); the row text beside it is no <label>'
}
const CHECKBOX_ROW: Allowed = {
  why: 'a Checkbox with its <label> text is 18 px tall (`components/Checkbox`)'
}
const TOGGLE_BUSY: Allowed = {
  why: 'a settings switch or checkbox flips at once and rolls back on a refusal; it has no busy state'
}
const TOGGLE_DOUBLE: Allowed = {
  why: 'a settings toggle: each press is its own change (the second undoes the first), so two presses send two writes'
}
/** The request-probe entries of one settings toggle. */
const toggle = (key: string): Record<string, Allowed> => ({
  [`action-busy:${key}`]: TOGGLE_BUSY,
  [`action-double:${key}`]: TOGGLE_DOUBLE
})
const DIALOG = { 'axe:html-has-lang': NO_LANG, 'axe:label-content-name-mismatch': NAME_MISMATCH }

const ALLOWED: Record<string, Record<string, Allowed>> = {
  board: { 'axe:html-has-lang': NO_LANG },
  'new-session': { 'axe:html-has-lang': NO_LANG },
  goals: { 'axe:html-has-lang': NO_LANG },
  settings: {
    ...DIALOG,
    'target:settings-sound-toggle': SWITCH_TRACK,
    'target:settings-notifications-toggle': SWITCH_TRACK,
    ...toggle('settings-sound-toggle'),
    ...toggle('settings-notifications-toggle')
  },
  shortcuts: {
    ...DIALOG,
    'target:shortcut-include-global': CHECKBOX_ROW,
    ...toggle('shortcut-include-global')
  },
  tags: { ...DIALOG, 'target:tag-include-global': CHECKBOX_ROW, ...toggle('tag-include-global') },
  rules: {
    ...DIALOG,
    'target:rule-include-global': CHECKBOX_ROW,
    ...toggle('rule-include-global')
  },
  memory: {
    ...DIALOG,
    'target:memory-include-global': CHECKBOX_ROW,
    'target:memory-show-stale': CHECKBOX_ROW,
    ...toggle('memory-include-global')
  },
  'sessions-active': DIALOG,
  'sessions-past': DIALOG,
  'sessions-templates': {
    ...DIALOG,
    'target:template-include-global': CHECKBOX_ROW,
    ...toggle('template-include-global')
  },
  'sessions-import': DIALOG
}

// ── In-page measurement ───────────────────────────────────────────────────────────────────────

const CONTROLS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="combobox"]'
].join(', ')

/** Selector of the state's root: its dialog, or the whole page for the board. */
const rootOf = (state: State): string =>
  state.dialog === null ? 'body' : `[data-testid="${state.dialog}"]`

interface Measured {
  /** The keys of the state's action controls: every control but a text field. */
  controls: string[]
  problems: string[]
  details: string[]
}

/** Runs in the page: the state's controls and its layout problems. It is serialized into the
 *  page, so every helper lives inside it, one small function per check. */
function measureInPage(arg: {
  root: string
  controls: string
  target: number
  mark: string | null
}): Measured {
  const root = document.querySelector(arg.root)
  if (root === null) throw new Error(`no ${arg.root} on the page`)
  const problems: string[] = []
  const details: string[] = []
  const report = (problem: string, detail = problem): void => {
    problems.push(problem)
    details.push(detail)
  }
  const shown = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return (
      r.width > 0 &&
      r.height > 0 &&
      el.checkVisibility({ visibilityProperty: true }) &&
      el.closest('[aria-hidden="true"], [inert]') === null
    )
  }
  const nameOf = (el: Element): string =>
    (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const keyOf = (el: Element): string =>
    el.getAttribute('data-testid') ??
    `${el.getAttribute('role') ?? el.tagName.toLowerCase()}:${nameOf(el)}`
  /** A checkbox or radio is measured by its label: the label is what the pointer hits. */
  const hitBox = (el: Element): DOMRect => {
    const isChoice = el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)
    return ((isChoice ? el.closest('label') : null) ?? el).getBoundingClientRect()
  }
  const checkTarget = (el: Element, key: string): void => {
    const box = hitBox(el)
    if (box.width >= arg.target && box.height >= arg.target) return
    report(`target:${key}`, `target:${key} ${Math.round(box.width)}x${Math.round(box.height)}`)
  }
  const isField = (el: Element): boolean =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    /^(combobox|textbox)$/.test(el.getAttribute('role') ?? '')
  const labelledByText = (el: Element): string =>
    (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join('')
  const labelsText = (el: Element): string =>
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
      ? [...(el.labels ?? [])].map((l) => l.textContent?.trim() ?? '').join('')
      : ''
  const checkLabel = (el: Element, key: string): void => {
    if (!isField(el)) return
    const name =
      (el.getAttribute('aria-label') ?? '') +
      labelledByText(el) +
      labelsText(el) +
      (el.getAttribute('title') ?? '')
    if (name.trim() === '') report(`unlabeled:${key}`)
  }
  const past = (el: Element): boolean => {
    const r = el.getBoundingClientRect()
    return shown(el) && (r.right > window.innerWidth + 1 || r.left < -1)
  }
  /** Only the outermost element past the edge is reported, not each of its children. */
  const checkOverflow = (el: Element): void => {
    if (!past(el) || (el.parentElement !== null && past(el.parentElement))) return
    const owner = el.closest('[data-testid]')
    const key = `${owner?.getAttribute('data-testid') ?? 'root'}>${el.tagName.toLowerCase()}`
    report(`overflow:${key}`, `overflow:${key} ${Math.round(el.getBoundingClientRect().right)}px`)
  }
  const textField = (el: Element): boolean =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|reset)$/.test(el.type))

  for (const old of document.querySelectorAll('[data-probe-target]'))
    old.removeAttribute('data-probe-target')
  const controls = [...root.querySelectorAll(arg.controls)].filter(shown)
  for (const el of controls) {
    const key = keyOf(el)
    if (arg.mark === key) el.setAttribute('data-probe-target', '')
    checkTarget(el, key)
    checkLabel(el, key)
  }
  const width = document.documentElement.scrollWidth
  if (width > window.innerWidth) report('overflow:document', `overflow:document ${width}px`)
  for (const el of root.querySelectorAll('*')) checkOverflow(el)
  return { controls: controls.filter((el) => !textField(el)).map(keyOf), problems, details }
}

/** `measureInPage` is serialized into the page: everything it reads comes in `arg`. */
function measure(page: Page, root: string, mark: string | null = null): Promise<Measured> {
  return page.evaluate(measureInPage, { root, controls: CONTROLS, target: TARGET, mark })
}

/** Wait for every finite animation (a dialog's entry) to end, so boxes are measured at rest. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  )
}

async function openState(page: Page, state: State): Promise<Locator> {
  await state.open(page)
  const root = page.locator(rootOf(state))
  await expect(root).toBeVisible()
  await settle(page)
  return root
}

/** The `data-testid`s of every open dialog (a leaving one is not open). */
function openDialogs(page: Page): Promise<string[]> {
  return page
    .locator('[role="dialog"]:not([data-leaving]), [role="alertdialog"]:not([data-leaving])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? '(no test id)'))
}

const KNOWN_DIALOGS = new Set(STATES.flatMap((s) => (s.dialog === null ? [] : [s.dialog])))

const unknownDialogs = async (page: Page): Promise<string[]> =>
  (await openDialogs(page)).filter((d) => !KNOWN_DIALOGS.has(d))

async function axeProblems(page: Page): Promise<{ problems: string[]; ran: string[] }> {
  // Legacy mode: Electron refuses the blank page axe opens to merge frame results.
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).setLegacyMode().analyze()
  const ran = [...result.violations, ...result.passes, ...result.incomplete, ...result.inapplicable]
  return { problems: result.violations.map((v) => `axe:${v.id}`), ran: ran.map((r) => r.id) }
}

/** `found` against ALLOWED for `state` at `width`, limited to the problems `inScope` owns. */
function verdict(
  state: string,
  width: number,
  found: readonly string[],
  inScope: (problem: string) => boolean
): { unlisted: string[]; stale: string[] } {
  const listed = Object.entries(ALLOWED[state] ?? {}).filter(
    ([p, a]) => inScope(p) && (a.widths === undefined || a.widths.includes(width))
  )
  const names = new Set(listed.map(([p]) => p))
  return {
    unlisted: [...new Set(found)].filter((p) => !names.has(p)),
    stale: [...names].filter((p) => !found.includes(p))
  }
}

const LAYOUT = /^(axe|overflow|target|unlabeled):/
const isLayout = (p: string): boolean => LAYOUT.test(p)

/** The page's accessibility snapshot: Playwright's aria snapshot, plus `aria-current`, which a
 *  screen reader announces but the aria snapshot leaves out (a page switch between two pages that
 *  show the same empty sentence changes only that). */
async function a11ySnapshot(page: Page): Promise<string> {
  const current = await page
    .locator('[aria-current]')
    .evaluateAll((els) => els.map((e) => `${e.textContent}=${e.getAttribute('aria-current')}`))
  return `${await page.locator('body').ariaSnapshot()}\n${current.join('\n')}`
}

/** Press `target`; true when the page's accessibility snapshot changed within 2 s. */
async function pressChanges(page: Page, target: Locator): Promise<boolean> {
  const before = await a11ySnapshot(page)
  await target.click()
  return expect
    .poll(() => a11ySnapshot(page), { timeout: 2000 })
    .not.toBe(before)
    .then(
      () => true,
      () => false
    )
}

/** Back to a fresh start. A dialog state reloads the renderer. The board cannot: after a reload
 *  it keeps its loading skeleton (the engine's started signal went out once, at start), so it
 *  closes what the last press opened instead: Escape for a dialog or menu, then a click on the
 *  empty board for a popover Escape does not reach. */
async function resetView(page: Page, state: State): Promise<void> {
  if (state.dialog !== null) {
    await page.reload()
    await waitForBoard(page)
    return
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
  await page.getByText('No sessions yet.', { exact: true }).click()
  await expect(page.locator('[role="dialog"]:not([data-leaving])')).toHaveCount(0)
  await expect(page.locator('[role="menu"]:not([data-leaving])')).toHaveCount(0)
}

/** Back to a fresh start and open `state` with `key` marked, its entry's `prepare` run first. */
async function freshTarget(page: Page, state: State, key: string): Promise<Locator> {
  await resetView(page, state)
  await openState(page, state)
  const action = ACTIONS[state.name]?.[key]
  if (action?.kind === 'request' && action.prepare !== undefined) await action.prepare(page)
  await measure(page, rootOf(state), key)
  const target = page.locator('[data-probe-target]')
  await expect(target).toHaveCount(1)
  return target
}

/** The request probe of one control: a failing and a slow channel. */
async function requestProblems(
  app: ElectronApplication,
  page: Page,
  state: State,
  key: string,
  channel: Channel
): Promise<string[]> {
  const problems: string[] = []
  let target = await freshTarget(page, state, key)
  await failIpc(app, channel)
  await target.click()
  const alerted = await expect(page.locator('[role="alert"]').first())
    .toBeVisible({ timeout: 5000 })
    .then(
      () => true,
      () => false
    )
  if (!alerted) problems.push(`action-error:${key}`)

  target = await freshTarget(page, state, key)
  await slowIpc(app, channel)
  const before = await target.boundingBox()
  // Two clicks in ONE task: React has not re-rendered (no `disabled` yet) when the second lands.
  await target.evaluate((el: HTMLElement) => {
    el.click()
    el.click()
  })
  await expect.poll(() => countIpc(app, channel)).toBeGreaterThan(0)
  const busy = await expect(target)
    .toHaveAttribute('aria-busy', 'true', { timeout: 2000 })
    .then(
      () => true,
      () => false
    )
  if (!busy) problems.push(`action-busy:${key}`)
  const after = await target.boundingBox()
  if (before?.width !== after?.width || before?.height !== after?.height)
    problems.push(`action-size:${key}`)
  if ((await countIpc(app, channel)) !== 1) problems.push(`action-double:${key}`)
  return problems
}

// ── Specs ─────────────────────────────────────────────────────────────────────────────────────

test('the probe lists every header-menu row', async ({ page }) => {
  await page.getByTestId('app-menu').click()
  for (const id of MENU_SUBMENUS) await page.getByTestId(id).hover()
  const rows = await page
    .locator('[data-testid="app-menu-list"] [role="menuitem"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  const probed = new Set([
    ...MENU_SUBMENUS,
    'app-menu-settings',
    'app-menu-shortcuts',
    'tags-menu-manage-tags',
    'tags-menu-manage-rules',
    'app-menu-memory',
    'sessions-menu-active',
    'sessions-menu-past',
    'sessions-menu-templates',
    'sessions-menu-import'
  ])
  expect(rows.length).toBeGreaterThan(5)
  expect(rows.filter((r) => !probed.has(r ?? ''))).toEqual([])
})

/** The keys of `state`'s controls whose entry is not `skip`: the ones the action probe presses. */
const pressed = (state: State): string[] =>
  Object.entries(ACTIONS[state.name] ?? {})
    .filter(([, a]) => a.kind !== 'skip')
    .map(([k]) => k)

/** `state`'s request controls and their channels. */
const requests = (state: State): [string, Channel][] =>
  Object.entries(ACTIONS[state.name] ?? {}).flatMap(([k, a]) =>
    a.kind === 'request' ? [[k, a.channel] as [string, Channel]] : []
  )

/** The request-probe problems of one control. */
const requestScope =
  (key: string) =>
  (p: string): boolean =>
    p.endsWith(`:${key}`) && /^action-(error|busy|size|double):/.test(p)

const emptySentences = (state: State): string[] => (state.empty === undefined ? [] : [state.empty])

/** Press each of `keys` on a fresh `state`: the keys whose press changed nothing, and the
 *  unknown dialogs the presses opened. */
async function pressAll(
  page: Page,
  state: State,
  keys: readonly string[]
): Promise<{ silent: string[]; opened: string[] }> {
  const silent: string[] = []
  const opened: string[] = []
  for (const key of keys) {
    const target = await freshTarget(page, state, key)
    if (!(await pressChanges(page, target))) silent.push(`action-change:${key}`)
    opened.push(...(await unknownDialogs(page)))
  }
  return { silent, opened }
}

for (const state of STATES) {
  test(`layout probe: ${state.name}`, async ({ page, probeWidth }) => {
    const root = await openState(page, state)
    const m = await measure(page, rootOf(state))
    const axe = await axeProblems(page)
    expect(axe.ran).toContain('target-size')
    const found = [...m.problems, ...axe.problems]
    const { unlisted, stale } = verdict(state.name, probeWidth, found, isLayout)
    expect(unlisted, m.details.join('\n')).toEqual([])
    expect(stale, 'fixed: delete these ALLOWED entries').toEqual([])
    for (const sentence of emptySentences(state))
      await expect(root.getByText(sentence, { exact: true })).toBeVisible()
  })

  test(`action probe: ${state.name}`, async ({ page, probeWidth }) => {
    test.setTimeout(240000)
    await openState(page, state)
    const { controls } = await measure(page, rootOf(state))
    const listed = Object.keys(ACTIONS[state.name] ?? {})
    expect(
      controls.filter((c) => !listed.includes(c)),
      'controls with no ACTIONS entry'
    ).toEqual([])
    expect(
      listed.filter((k) => !controls.includes(k)),
      'ACTIONS entries with no control'
    ).toEqual([])
    const { silent, opened } = await pressAll(page, state, pressed(state))
    expect(opened, 'a press opened a dialog STATES lacks').toEqual([])
    const { unlisted, stale } = verdict(state.name, probeWidth, silent, (p) =>
      p.startsWith('action-change:')
    )
    expect(unlisted).toEqual([])
    expect(stale, 'fixed: delete these ALLOWED entries').toEqual([])
  })

  for (const [key, channel] of requests(state)) {
    test(`request probe: ${state.name} ${key}`, async ({ app, page, probeWidth }) => {
      const found = await requestProblems(app, page, state, key, channel)
      const { unlisted, stale } = verdict(state.name, probeWidth, found, requestScope(key))
      expect(unlisted).toEqual([])
      expect(stale, 'fixed: delete these ALLOWED entries').toEqual([])
    })
  }
}

// ── Non-vacuity: a probe fragment with one of each fault ─────────────────────────────────────

test('the probe reports a small button, a wide box, an unlabeled field and a silent button', async ({
  page
}) => {
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.setAttribute('data-testid', 'probe-fragment')
    box.innerHTML = [
      '<button data-testid="probe-small" style="width:20px;height:20px;padding:0">s</button>',
      '<div data-testid="probe-wide" style="width:2000px;height:10px"></div>',
      '<input data-testid="probe-unlabeled" type="text" placeholder="a placeholder is no name">',
      '<button data-testid="probe-logs" style="width:80px;height:32px">logs</button>',
      '<button data-testid="probe-text" style="width:80px;height:32px">before</button>'
    ].join('')
    document.body.prepend(box)
    box.querySelector('[data-testid="probe-logs"]')?.addEventListener('click', () => {
      console.log('probe: pressed')
    })
    const text = box.querySelector('[data-testid="probe-text"]')
    text?.addEventListener('click', () => {
      if (text !== null) text.textContent = 'after'
    })
  })
  const { problems } = await measure(page, '[data-testid="probe-fragment"]')
  expect(problems).toEqual(
    expect.arrayContaining([
      'target:probe-small',
      'overflow:probe-wide>div',
      'unlabeled:probe-unlabeled'
    ])
  )
  expect(problems.filter((p) => p.includes('probe-logs') || p.includes('probe-text'))).toEqual([])
  expect(await pressChanges(page, page.getByTestId('probe-logs'))).toBe(false)
  expect(await pressChanges(page, page.getByTestId('probe-text'))).toBe(true)
})

// ── Reduced motion ─────────────────────────────────────────────────────────────────────────────

/** Animations that loop forever and are running now. */
const infiniteAnimations = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity
      )
      .map((a) => (a instanceof CSSAnimation ? a.animationName : a.constructor.name))
  )

test('no animation loops under reduced motion, a needs-you card included', async ({
  app,
  page,
  appEnv,
  launchSession
}) => {
  test.setTimeout(120000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true
  )
  for (const state of STATES) {
    await openState(page, state)
    expect(await infiniteAnimations(page), state.name).toEqual([])
    await resetView(page, state)
  }

  await launchSession(page)
  await page.getByTestId('focused-back').click()
  const card = page.locator('[data-column] [data-session-id]')
  await expect(card).toHaveCount(1, { timeout: 10000 })
  const sessionId = (await card.getAttribute('data-session-id')) ?? ''
  const pid = app.process().pid ?? 0
  await waitForClaudeDescendant(pid, 20000)
  const status = await postHook(hookPathOf(pid, sessionId), {
    session_id: sessionId,
    transcript_path: `${appEnv.pickDir}/${sessionId}.jsonl`,
    cwd: appEnv.pickDir,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Needs you: pick one of the two options.'
  })
  expect(status).toBe(200)
  await expect(
    page.locator(`[data-column="needs-you"] [data-session-id="${sessionId}"]`)
  ).toBeVisible()
  expect(await infiniteAnimations(page)).toEqual([])
})
