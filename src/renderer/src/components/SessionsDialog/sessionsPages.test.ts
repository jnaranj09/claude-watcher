import { describe, it, expect } from 'vitest'
import { SESSIONS_PAGES, scopeOnPage } from './sessionsPages'

describe('Sessions pages (spec 2026-10-03 B)', () => {
  it('lists the pages in order', () => {
    expect(SESSIONS_PAGES.map((p) => p.label)).toEqual(['Active', 'Past', 'Templates', 'Import'])
  })

  it('a session page never sits on Global or (no workspace): those fall back to All', () => {
    expect(scopeOnPage('past', 'global')).toBe('all')
    expect(scopeOnPage('active', 'global')).toBe('all')
    expect(scopeOnPage('past', 'orphans')).toBe('all')
    expect(scopeOnPage('past', 'ws:w1')).toBe('ws:w1')
    expect(scopeOnPage('templates', 'global')).toBe('global')
  })
})
