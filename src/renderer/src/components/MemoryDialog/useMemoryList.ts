// Memory — one page of the dialog's list (spec 2026-11-11 memory §8): `window.memory.list` in
// pages of 100 (`Show more` asks for the next), loaded again on main's `onChanged` push (a session
// saving in the background, or this dialog's own write) and on `reload()`. A reload asks for every
// page shown so far, so the list never shrinks under the operator. A changed request (scope, page,
// search, filters) starts again at one page. An answer for an older request is dropped.
//
// It also reads the folders and session names the Folder and Session filters offer: the newest
// page of the scope with no search and no filters (stale items included), so a filter that is on
// never hides the other values it could be changed to. The same page says whether the scope holds
// anything at all, which the empty page needs (`Nothing saved yet` must not stand over stale items
// that `Show stale` hides).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MEMORY_LIMITS, type MemoryRow } from '../../../../shared/schemas/memory'
import type { MemoryFilters } from '../../../../shared/memory/filterFields'

export interface MemoryListQuery {
  workspaceId: string
  includeGlobal: boolean
  kind: MemoryRow['kind']
  /** Trimmed search text, or null. */
  query: string | null
  filters: MemoryFilters
}

export interface MemoryList {
  rows: readonly MemoryRow[]
  /** How many rows match in all (the pages not loaded yet included). */
  total: number
  loaded: boolean
  loadFailed: boolean
  /** The next page (`Show more`). */
  more: () => void
  reload: () => void
  /** What the Folder and Session filters offer. */
  folders: readonly string[]
  sessionNames: readonly string[]
  /** The scope holds at least one item of this kind, stale or not, whatever the search. */
  anySaved: boolean
}

const PAGE = MEMORY_LIMITS.listLimit

interface Loaded {
  key: string
  rows: readonly MemoryRow[]
  total: number
  failed: boolean
}

async function loadPages(q: MemoryListQuery, pages: number): Promise<Omit<Loaded, 'key'>> {
  const rows: MemoryRow[] = []
  let total = 0
  for (let page = 0; page < pages; page += 1) {
    const answer = await window.memory.list({ ...q, offset: page * PAGE, limit: PAGE })
    rows.push(...answer.rows)
    total = answer.total
    if (rows.length >= total) break
  }
  return { rows, total, failed: false }
}

function distinct(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))]
}

export function useMemoryList(q: MemoryListQuery): MemoryList {
  // The request, read by the effects below; they rerun when its KEY changes.
  const latest = useRef(q)
  useLayoutEffect(() => {
    latest.current = q
  })
  const key = JSON.stringify(q)
  // The facets ignore search, filters and `Show stale`.
  const facetKey = `${q.workspaceId}|${q.includeGlobal}|${q.kind}`
  const [paging, setPaging] = useState({ key, pages: 1 })
  const pages = paging.key === key ? paging.pages : 1
  // Bumped by `reload()` and by main's push.
  const [generation, setGeneration] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [facets, setFacets] = useState<readonly MemoryRow[]>([])

  useEffect(() => window.memory.onChanged(() => setGeneration((n) => n + 1)), [])

  useEffect(() => {
    let live = true
    loadPages(latest.current, pages)
      .then((answer) => {
        if (live) setLoaded({ ...answer, key })
      })
      .catch(() => {
        console.warn('[claude-watcher][memory] code=memory_list_failed')
        if (live) setLoaded({ key, rows: [], total: 0, failed: true })
      })
    return () => {
      live = false
    }
  }, [key, pages, generation])

  useEffect(() => {
    let live = true
    const { workspaceId, includeGlobal, kind } = latest.current
    window.memory
      .list({
        workspaceId,
        includeGlobal,
        kind,
        query: null,
        filters: { includeStale: true },
        offset: 0,
        limit: PAGE
      })
      .then((answer) => {
        if (live) setFacets(answer.rows)
      })
      .catch(() => {
        // The filters still offer what the list shows; the list's own load reports a failure.
        console.warn('[claude-watcher][memory] code=memory_facets_failed')
      })
    return () => {
      live = false
    }
  }, [facetKey, generation])

  const current = loaded !== null && loaded.key === key ? loaded : null
  const rows = current?.rows ?? []
  return {
    rows,
    total: current?.total ?? 0,
    loaded: current !== null,
    loadFailed: current?.failed === true,
    more: () => setPaging({ key, pages: pages + 1 }),
    reload: () => setGeneration((n) => n + 1),
    folders: distinct([...facets, ...rows].map((r) => r.folder)),
    sessionNames: distinct([...facets, ...rows].map((r) => r.sessionName)),
    anySaved: facets.length > 0 || rows.length > 0
  }
}
