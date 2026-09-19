// Past sessions — PURE helpers behind PastSessionsDialog.tsx: the scope + name filters, the three
// empty sentences, the relative time and the error copy. No React, no store.
import type { PastSession } from '../../../../shared/ipc/contract'

/** The two ScopeFilter values this dialog offers: every record has a workspace, so there is no
 *  `global`, and the workspace-delete cascade makes `orphans` unreachable. */
export type PastScope = 'all' | `ws:${string}`

export function filterPastByScope(rows: PastSession[], scope: PastScope): PastSession[] {
  if (scope === 'all') return rows
  const id = scope.slice('ws:'.length)
  return rows.filter((r) => r.workspaceId === id)
}

/** The board search's rules: trimmed, case-insensitive, anywhere in the NAME; blank hides nothing. */
export function filterPastByName(rows: PastSession[], query: string): PastSession[] {
  const q = query.trim().toLocaleLowerCase()
  if (q.length === 0) return rows
  return rows.filter((r) => r.name.toLocaleLowerCase().includes(q))
}

/** Three different nothings, three different sentences (design.md "Scoped lists"): no history at
 *  all, none in the picked workspace, or none matching the search box. */
export function pastSessionsEmptyCopy(total: number, scoped: number, query: string): string {
  if (total === 0) return 'No past sessions yet.'
  if (scoped === 0) return 'No past sessions in this workspace.'
  return `No past sessions match “${query.trim()}”.`
}

export function relativeEnded(endedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - endedAt) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(endedAt).toLocaleDateString()
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  not_found: 'That session is no longer in the history',
  folder_missing: 'That folder no longer exists',
  already_open: 'That session is already open'
}

/**
 * Never renders a raw message (design.md): a code maps to copy, anything else to the generic line.
 * Matched with `includes`, not `===` (the `copyFor` / `templateErrorMessage` precedent): Electron
 * wraps an invoke rejection as "Error invoking remote method '…': Error: folder_missing", so the
 * code is never the whole message in the real app.
 */
export function pastSessionErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  for (const [code, copy] of Object.entries(ERROR_COPY)) if (text.includes(code)) return copy
  return 'Could not open the session'
}

/** Open's `already_open` refusal — the session is live on the board (spec Open step 3: the
 *  dialog takes the operator to its card). Matched like `pastSessionErrorMessage`, for the same
 *  Electron-wrapping reason. */
export function isAlreadyOpenError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('already_open')
}

export function folderBasename(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '')
  if (trimmed.length === 0) return '/'
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}
