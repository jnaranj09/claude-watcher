// The Sessions dialog's rail filter state: per-scope memory while the dialog is open. jsdom `unit`.
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScopedFilters } from './railFilters'
import { NO_FILTERS } from '../../lib/sessionFilters'

describe('useScopedFilters', () => {
  it('keeps filters per scope while mounted', () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedFilters(scope), {
      initialProps: { scope: 'all' }
    })
    act(() => result.current[1]({ ...NO_FILTERS, folders: ['/p'] }))
    rerender({ scope: 'ws:a' })
    expect(result.current[0]).toBe(NO_FILTERS)
    rerender({ scope: 'all' })
    expect(result.current[0].folders).toEqual(['/p'])
  })
})
