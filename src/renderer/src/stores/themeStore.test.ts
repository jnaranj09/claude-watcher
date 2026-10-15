import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME_BUNDLE } from '../../../shared/schemas/theme'
import { createThemeStore, selectThemeTerminal } from './themeStore'

describe('themeStore', () => {
  it('starts on the default bundle and replaces it wholesale', () => {
    const store = createThemeStore()
    expect(store.getState().bundle).toEqual(DEFAULT_THEME_BUNDLE)
    store.getState().setBundle({
      ...DEFAULT_THEME_BUNDLE,
      id: 'paper',
      name: 'Paper',
      colorScheme: 'light',
      terminal: { red: '#f00' }
    })
    expect(store.getState().bundle.id).toBe('paper')
    expect(selectThemeTerminal(store.getState())).toEqual({ red: '#f00' })
  })
})
