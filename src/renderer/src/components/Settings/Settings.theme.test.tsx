// Settings UI tests, part 2: the Theme group (spec 2026-09-20) in the Appearance category. jsdom
// `unit` project. Renders the SettingsPanel against a stubbed window.settings, window.themes and
// window.api: the theme list on open, choosing a theme, terminal colours, Reload, Open folder and
// the wallpaper controls. The rest of the panel is in Settings.test.tsx.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { SettingsPanel } from './Settings'
import { settingsStore } from '../../stores/settingsStore'
import { click, flush, q, renderComponent } from '../../test/renderComponent'
import { chooseOption, selectedValue, optionValues } from '../../test/selectHarness'
import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/schemas/settings'
import { mergedSettings, stubSettings } from '../../test/settingsBridge'
import {
  openCategory,
  resetSettingsPanel,
  stubApi,
  stubThemes,
  type,
  blur
} from '../../test/settingsPanelHarness'
import type { ThemeSummary } from '../../../../shared/schemas/theme'
import { themeStore } from '../../stores/themeStore'
import { DEFAULT_THEME_BUNDLE } from '../../../../shared/schemas/theme'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  resetSettingsPanel()
})

describe('SettingsPanel — the Theme group (spec 2026-09-20)', () => {
  const glass: ThemeSummary = { id: 'liquid-glass', name: 'Liquid Glass', colorScheme: 'dark' }
  const paper: ThemeSummary = { id: 'paper', name: 'Paper', colorScheme: 'light' }
  const broken: ThemeSummary = {
    id: 'broken',
    name: 'broken',
    colorScheme: 'dark',
    error: 'theme_css_missing'
  }

  it('lists themes on open: Default first, then the loadable ones by name; broken ones in the helper line only', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper, glass, broken])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(themes.list).toHaveBeenCalledTimes(1)
    expect(optionValues(r.container, 'settings-theme')).toEqual([
      'default',
      'liquid-glass',
      'paper'
    ])
    expect(selectedValue(r.container, 'settings-theme')).toBe('default')
    expect(q(r, '[data-testid="settings-theme-broken"]').textContent).toBe(
      'Could not load: broken (missing theme.css)'
    )
  })

  it('hides the helper line when nothing is broken', async () => {
    stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-theme-broken"]')).toBeNull()
  })

  it('choosing a theme persists { themeId }', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    chooseOption(r.container, 'settings-theme', 'paper')
    expect(setCalls).toEqual([{ themeId: 'paper' }])
  })

  it('Terminal colours: opens on Follow theme, offers Dark and Light, and persists the pick', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(optionValues(r.container, 'settings-terminal-scheme')).toEqual([
      'theme',
      'dark',
      'light'
    ])
    expect(selectedValue(r.container, 'settings-terminal-scheme')).toBe('theme')
    chooseOption(r.container, 'settings-terminal-scheme', 'dark')
    expect(setCalls).toEqual([{ terminalScheme: 'dark' }])
  })

  it('Copy/paste menu click: opens on Right-click, offers the modifiers, and persists the pick', async () => {
    const { setCalls } = stubSettings()
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'terminal')
    await flush()
    expect(optionValues(r.container, 'settings-terminal-menu-trigger')).toEqual([
      'right-click',
      'shift-right-click',
      'ctrl-right-click'
    ])
    expect(selectedValue(r.container, 'settings-terminal-menu-trigger')).toBe('right-click')
    expect(r.container.textContent).toContain('full-screen renderer with mouse support')
    chooseOption(r.container, 'settings-terminal-menu-trigger', 'shift-right-click')
    expect(setCalls).toEqual([{ terminalMenuTrigger: 'shift-right-click' }])
  })

  it('Reload themes reloads, then re-lists', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-reload"]'))
    await flush()
    expect(themes.reload).toHaveBeenCalledTimes(1)
    expect(themes.list).toHaveBeenCalledTimes(2)
  })

  it('Open themes folder asks main', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-open-folder"]'))
    expect(themes.openFolder).toHaveBeenCalledTimes(1)
  })

  it('a refused Open themes folder shows mapped copy on the one error line', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    themes.openFolder.mockImplementation(() => Promise.reject(new Error('ENOENT: no such file')))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-open-folder"]'))
    await flush()
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe('Could not open the themes folder.')
    expect(r.container.textContent).not.toContain('ENOENT')
  })

  it('when the chosen theme is not the applied one, the error line names the reason and the picker keeps the choice', async () => {
    stubSettings()
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'broken' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "broken" could not be loaded, using Default — missing theme.css'
    )
    expect(selectedValue(r.container, 'settings-theme')).toBe('broken')
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default', 'broken'])
  })

  // Finding 1(b) end-to-end: a theme whose MANIFEST is fine but whose CSS is broken (here, a
  // remote url()) must (1) be absent from the picker's loadable options, (2) appear in the
  // broken-themes line with its reason, and (3) — if it is the CHOSEN theme (e.g. it broke after
  // it was picked) — the error line names the SAME reason, not just "could not be loaded".
  it('a CSS-level broken theme (fine manifest, bad CSS) is unpickable, listed broken, and named when chosen', async () => {
    const remoteCss: ThemeSummary = {
      id: 'remote-css',
      name: 'Remote CSS',
      colorScheme: 'dark',
      error: 'theme_css_url_invalid'
    }
    stubSettings()
    stubApi()
    stubThemes([paper, remoteCss])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'remote-css' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    // (1) not among the loadable options — only the chosen-but-broken id is pinned in, kept so
    // the picker never sits on a value it does not offer (design.md).
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default', 'paper', 'remote-css'])
    // (2) listed in the broken-themes helper line with its reason.
    expect(q(r, '[data-testid="settings-theme-broken"]').textContent).toBe(
      'Could not load: remote-css (a disallowed url(), @import, image-set() or escape in the CSS)'
    )
    // (3) the chosen-theme error line names the same reason.
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "Remote CSS" could not be loaded, using Default — a disallowed url(), @import, image-set() or escape in the CSS'
    )
  })

  it('a reload() that rejects sets mapped copy on the one error line, never the raw error', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes([paper])
    themes.reload.mockImplementation(() => Promise.reject(new Error('ECONNREFUSED')))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    click(q(r, '[data-testid="settings-theme-reload"]'))
    await flush()
    const line = q(r, '[data-testid="settings-error"]')
    expect(line.textContent).toBe('Could not reload themes.')
    expect(r.container.textContent).not.toContain('ECONNREFUSED')
  })

  // R12 — the theme error is a STANDING condition, not an event: an unrelated flow that clears the
  // shared line (a good port, the API switched off) must not hide it while the theme is still broken.
  it('a still-broken theme keeps its error line through an API change that clears the line', async () => {
    const base: Settings = { ...DEFAULT_SETTINGS, themeId: 'broken', apiEnabled: true }
    // Main's answer keeps the broken theme chosen (the stub's default answer would reset it).
    stubSettings((patch) =>
      Promise.resolve({
        ...base,
        apiPort: patch.apiPort ?? base.apiPort,
        apiEnabled: patch.apiEnabled ?? base.apiEnabled
      })
    )
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate(base))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'api')
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '9300')
    blur(port)
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Theme "broken" could not be loaded, using Default — missing theme.css'
    )
    click(q(r, '[data-testid="settings-api-enabled"]'))
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain('could not be loaded')
  })

  it('an API refusal still shows once the theme loads again', async () => {
    stubSettings()
    stubApi()
    stubThemes([broken])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'broken' }))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'api')
    await flush()
    const port = q<HTMLInputElement>(r, '[data-testid="settings-api-port"]')
    type(port, '80')
    blur(port)
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain('could not be loaded')
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'default' }))
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Port must be between 1024 and 65535.'
    )
  })

  // R12 (related) — picking a theme updates the setting at once, and the bundle lands a moment
  // later: the gap read as "could not be loaded" on every switch.
  it('no false alarm while a theme switch is in flight; the real outcome shows after', async () => {
    let answer: (() => void) | undefined
    stubSettings(
      (patch) =>
        new Promise((resolve) => {
          answer = () => resolve(mergedSettings(patch))
        })
    )
    stubApi()
    stubThemes([paper])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    chooseOption(r.container, 'settings-theme', 'paper')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
    // Main answered without a paper bundle: the theme really failed, so now it is said.
    await act(async () => {
      answer?.()
      await Promise.resolve()
    })
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toContain(
      'Theme "Paper" could not be loaded'
    )
  })

  it('no error line when the chosen theme is the applied one', async () => {
    stubSettings()
    stubApi()
    stubThemes([paper])
    act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'paper' }))
    act(() =>
      themeStore
        .getState()
        .setBundle({ ...DEFAULT_THEME_BUNDLE, id: 'paper', name: 'Paper', colorScheme: 'light' })
    )
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-error"]')).toBeNull()
  })

  it('shows the transparency hint only while the applied theme sets allowTransparency', async () => {
    stubSettings()
    stubApi()
    stubThemes([glass])
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(r.container.querySelector('[data-testid="settings-theme-transparency"]')).toBeNull()
    act(() =>
      themeStore.getState().setBundle({
        ...DEFAULT_THEME_BUNDLE,
        id: 'liquid-glass',
        name: 'Liquid Glass',
        terminal: { allowTransparency: true }
      })
    )
    expect(q(r, '[data-testid="settings-theme-transparency"]').textContent).toBe(
      'Transparency applies to terminals opened from now on.'
    )
  })

  it('a list that fails shows mapped copy on the one error line and keeps Default selectable', async () => {
    stubSettings()
    stubApi()
    const themes = stubThemes()
    themes.list.mockImplementation(() => Promise.reject(new Error('boom')))
    const r = renderComponent(<SettingsPanel />)
    cleanup = r.unmount
    openCategory(r, 'appearance')
    await flush()
    expect(q(r, '[data-testid="settings-error"]').textContent).toBe(
      'Could not read the themes folder.'
    )
    expect(optionValues(r.container, 'settings-theme')).toEqual(['default'])
  })
  describe('Wallpaper (spec 2026-09-24)', () => {
    const two: ThemeSummary = {
      id: 'liquid-glass',
      name: 'Liquid Glass',
      colorScheme: 'dark',
      wallpapers: [
        { id: 'graphite', name: 'Graphite' },
        { id: 'aurora', name: 'Aurora gradient' }
      ]
    }
    const applied = {
      ...DEFAULT_THEME_BUNDLE,
      id: 'liquid-glass',
      name: 'Liquid Glass',
      wallpaperId: 'graphite'
    }
    const chooseGlass = (): void =>
      act(() => {
        settingsStore.getState().hydrate({
          ...DEFAULT_SETTINGS,
          themeId: 'liquid-glass',
          wallpaperByTheme: { paper: 'x' }
        })
        themeStore.getState().setBundle(applied)
      })
    const wallpaperSelect = (c: HTMLElement): Element | null =>
      c.querySelector('[data-testid="settings-wallpaper"]')

    it('shows the applied theme wallpapers, on the applied one', async () => {
      stubSettings()
      stubApi()
      stubThemes([two])
      chooseGlass()
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(optionValues(r.container, 'settings-wallpaper')).toEqual(['graphite', 'aurora'])
      expect(selectedValue(r.container, 'settings-wallpaper')).toBe('graphite')
    })

    it('picking one persists the WHOLE map with this theme updated', async () => {
      const { setCalls } = stubSettings()
      stubApi()
      stubThemes([two])
      chooseGlass()
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      chooseOption(r.container, 'settings-wallpaper', 'aurora')
      expect(setCalls).toEqual([{ wallpaperByTheme: { paper: 'x', 'liquid-glass': 'aurora' } }])
    })

    it('is not rendered for a theme with one wallpaper', async () => {
      stubSettings()
      stubApi()
      stubThemes([{ ...two, wallpapers: [{ id: 'graphite', name: 'Graphite' }] }])
      chooseGlass()
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })

    it('is not rendered while the chosen theme failed and Default is applied', async () => {
      stubSettings()
      stubApi()
      stubThemes([two])
      act(() => settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'liquid-glass' })) // bundle stays DEFAULT_THEME_BUNDLE
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })

    it("is not rendered while the applied bundle is ANOTHER theme's (a switch not yet landed)", async () => {
      stubSettings()
      stubApi()
      const paperTwo: ThemeSummary = { ...two, id: 'paper', name: 'Paper' }
      stubThemes([two, paperTwo])
      act(() => {
        settingsStore.getState().hydrate({ ...DEFAULT_SETTINGS, themeId: 'paper' })
        themeStore.getState().setBundle(applied) // still liquid-glass, wallpaperId 'graphite'
      })
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })

    it('is not rendered on Default', async () => {
      stubSettings()
      stubApi()
      stubThemes([two])
      const r = renderComponent(<SettingsPanel />)
      cleanup = r.unmount
      openCategory(r, 'appearance')
      await flush()
      expect(wallpaperSelect(r.container)).toBeNull()
    })
  })
})
