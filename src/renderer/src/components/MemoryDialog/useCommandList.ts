// Memory — the Commands page's list (memory phase 2): `window.memory.commands` for one workspace,
// newest first, in pages of 100 (`Show more` asks for the next), loaded again on main's
// `onChanged` push (a session saving in the background, or this page's own delete) and on
// `reload()`. A reload asks for every page shown so far, so the list never shrinks under the
// operator. A changed request (scope, search) starts again at one page, and the rows on screen stay
// until it answers. An answer for an older request is dropped. A list main refuses
// (`memory_read_failed`) is `loadFailed`: the page shows the dialog's list error, never the message.
import { useEffect, useState } from 'react'
import { MEMORY_LIMITS, type MemoryCommand } from '../../../../shared/schemas/memory'

export interface CommandListQuery {
  workspaceId: string
  /** Trimmed search text, or null. */
  query: string | null
}

export interface CommandList {
  rows: readonly MemoryCommand[]
  /** How many commands match in all (the pages not loaded yet included). */
  total: number
  loaded: boolean
  loadFailed: boolean
  /** The next page (`Show more`). */
  more: () => void
  reload: () => void
}

const PAGE = MEMORY_LIMITS.listLimit

interface Loaded {
  key: string
  rows: readonly MemoryCommand[]
  total: number
  failed: boolean
}

async function loadPages(q: CommandListQuery, pages: number): Promise<Omit<Loaded, 'key'>> {
  const rows: MemoryCommand[] = []
  let total = 0
  for (let page = 0; page < pages; page += 1) {
    const answer = await window.memory.commands({ ...q, offset: page * PAGE, limit: PAGE })
    rows.push(...answer.rows)
    total = answer.total
    if (rows.length >= total) break
  }
  return { rows, total, failed: false }
}

export function useCommandList({ workspaceId, query }: CommandListQuery): CommandList {
  const key = JSON.stringify([workspaceId, query])
  const [paging, setPaging] = useState({ key, pages: 1 })
  const pages = paging.key === key ? paging.pages : 1
  // Bumped by `reload()` and by main's push.
  const [generation, setGeneration] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => window.memory.onChanged(() => setGeneration((n) => n + 1)), [])

  useEffect(() => {
    let live = true
    loadPages({ workspaceId, query }, pages)
      .then((answer) => {
        if (live) setLoaded({ ...answer, key })
      })
      .catch(() => {
        console.warn('[claude-watcher][memory] code=memory_commands_failed')
        if (live) setLoaded({ key, rows: [], total: 0, failed: true })
      })
    return () => {
      live = false
    }
  }, [workspaceId, query, key, pages, generation])

  return {
    rows: loaded?.rows ?? [],
    total: loaded?.total ?? 0,
    loaded: loaded !== null,
    loadFailed: loaded?.failed === true,
    more: () => setPaging({ key, pages: pages + 1 }),
    reload: () => setGeneration((n) => n + 1)
  }
}
