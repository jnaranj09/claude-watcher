// The Sessions dialog's rail filter state: the per-page, per-scope memory and the tags a scope
// offers. jsdom `unit`.
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { railTags, useScopedFilters } from './railFilters'
import { NO_FILTERS } from '../../lib/sessionFilters'
import type { Tag } from '../../../../shared/ipc/contract'

describe('useScopedFilters', () => {
  it('keeps filters per page and scope while mounted', () => {
    const { result } = renderHook(() => useScopedFilters())
    act(() => result.current.write('active', 'all', { ...NO_FILTERS, folders: ['/p'] }))
    expect(result.current.read('active', 'all').folders).toEqual(['/p'])
    expect(result.current.read('active', 'ws:a')).toBe(NO_FILTERS)
    expect(result.current.read('past', 'all')).toBe(NO_FILTERS)
  })
})

describe('railTags', () => {
  const tag = (id: string, workspaceId: string | null): Tag => ({
    id,
    name: id,
    color: 'blue',
    workspaceId
  })
  // Stored order mixes them: a workspace tag first, so "global first" is the function's doing.
  const TAGS = [tag('a-own', 'a'), tag('g1', null), tag('b-own', 'b'), tag('g2', null)]

  it('a workspace scope offers the global tags first, then its own, and drops another workspace’s', () => {
    expect(railTags(TAGS, 'ws:a').map((t) => t.id)).toEqual(['g1', 'g2', 'a-own'])
  })

  it('All sessions offers every tag, global first', () => {
    expect(railTags(TAGS, 'all').map((t) => t.id)).toEqual(['g1', 'g2', 'a-own', 'b-own'])
  })
})
