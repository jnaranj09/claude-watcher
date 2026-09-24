import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_THEME_BUNDLE, type ThemeBundle } from '../../shared/schemas/theme'
import { createThemeLifecycle, type ThemeLifecycle } from './themeLifecycle'
import type { ThemeLoadResult } from './themeCompose'

const paper: ThemeBundle = {
  id: 'paper',
  name: 'Paper',
  colorScheme: 'light',
  css: 'body{}',
  terminal: {},
  wallpaperId: null
}

interface Harness {
  lc: ThemeLifecycle
  push: ReturnType<typeof vi.fn>
  setNativeTheme: ReturnType<typeof vi.fn>
  logs: string[]
}

function harness(load: (id: string) => ThemeLoadResult): Harness {
  const push = vi.fn()
  const setNativeTheme = vi.fn()
  const logs: string[] = []
  const lc = createThemeLifecycle({ load, push, setNativeTheme, log: (m) => logs.push(m) })
  return { lc, push, setNativeTheme, logs }
}

describe('createThemeLifecycle.apply', () => {
  it('pushes the loaded bundle, sets nativeTheme from its scheme, returns ok', () => {
    const h = harness(() => ({ ok: true, bundle: paper }))
    expect(h.lc.apply('paper')).toEqual({ ok: true, id: 'paper' })
    expect(h.push).toHaveBeenCalledWith(paper)
    expect(h.setNativeTheme).toHaveBeenCalledWith('light')
    expect(h.lc.current()).toEqual(paper)
    expect(h.logs).toEqual([])
  })
  it('on a load failure pushes Default, sets dark, logs the reason, returns the code', () => {
    const h = harness(() => ({ ok: false, code: 'theme_css_missing' }))
    expect(h.lc.apply('glass')).toEqual({ ok: false, id: 'glass', code: 'theme_css_missing' })
    expect(h.push).toHaveBeenCalledWith(DEFAULT_THEME_BUNDLE)
    expect(h.setNativeTheme).toHaveBeenCalledWith('dark')
    expect(h.logs).toEqual([
      '[claude-watcher][themes] code=theme_load_failed id=glass reason=theme_css_missing'
    ])
  })
  it('a bundle that fails the wire schema is not sent (validated at source); Default is', () => {
    const h = harness(() => ({ ok: true, bundle: { ...paper, id: 'Bad Id' } }))
    expect(h.lc.apply('paper')).toEqual({ ok: false, id: 'paper', code: 'theme_manifest_invalid' })
    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.push).toHaveBeenCalledWith(DEFAULT_THEME_BUNDLE)
    expect(h.logs).toEqual(['[claude-watcher][themes] code=theme_bundle_invalid id=paper path=id'])
  })
  it('never throws: a throwing load or push is contained and logged', () => {
    const h = harness(() => {
      throw new Error('boom /home/x')
    })
    expect(() => h.lc.apply('x')).not.toThrow()
    expect(h.push).toHaveBeenCalledWith(DEFAULT_THEME_BUNDLE)
    expect(h.logs.join('\n')).toContain('code=theme_load_failed id=x reason=theme_read_failed')
    expect(h.logs.join('\n')).not.toContain('/home/x')
    const h2 = createThemeLifecycle({
      load: () => ({ ok: true, bundle: paper }),
      push: () => {
        throw new Error('gone')
      },
      setNativeTheme: () => {},
      log: (m) => h.logs.push(m)
    })
    expect(() => h2.apply('paper')).not.toThrow()
    expect(h.logs.join('\n')).toContain('code=theme_push_failed')
  })
  it('a throwing setNativeTheme is contained and logged, and push still runs', () => {
    const logs: string[] = []
    const push = vi.fn()
    const lc = createThemeLifecycle({
      load: () => ({ ok: true, bundle: paper }),
      push,
      setNativeTheme: () => {
        throw new Error('theme source unavailable')
      },
      log: (m) => logs.push(m)
    })
    expect(() => lc.apply('paper')).not.toThrow()
    expect(push).toHaveBeenCalledWith(paper)
    expect(logs).toEqual(['[claude-watcher][themes] code=theme_native_theme_failed'])
  })
})
