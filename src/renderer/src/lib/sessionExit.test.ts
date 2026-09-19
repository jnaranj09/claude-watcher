// Past sessions (D-3/D-5) — the renderer-side exit helpers (Task 10).
//
// archiveTerminal / deleteTerminal are the ONE place the card, the focused bar, Ctrl+W and the
// Delete confirm call through — so the explicit main-side stop-and-record/drop FIRST, then the
// renderer's own view-state teardown (F1's ordering) can never drift between callers.
//
// sessionIdForTerminal is the reverse lookup (terminalIdBySessionId is keyed the other way) used
// to fill the Delete confirm's payload from a card/rail click, where only the terminalId is known.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { archiveTerminal, deleteTerminal, sessionIdForTerminal } from './sessionExit'
import { boardStore } from '../stores/boardStore'

let archive: ReturnType<typeof vi.fn>
let del: ReturnType<typeof vi.fn>
beforeEach(() => {
  archive = vi.fn(() => Promise.resolve())
  del = vi.fn(() => Promise.resolve())
  ;(window as unknown as { launch: unknown }).launch = {
    archiveSession: archive,
    deleteSession: del
  }
  boardStore.setState({
    viewMode: 'focused',
    focusedTerminalId: 'term-1',
    terminalIdBySessionId: { 'sess-1': 'term-1' },
    launchedTerminals: {
      'term-1': { terminalId: 'term-1', launchedAt: 1, label: 'a', workspaceId: 'default' }
    },
    stopConfirm: { terminalId: 'term-1', sessionId: 'sess-1', sessionName: 'a' }
  })
})

describe('sessionExit', () => {
  it('sessionIdForTerminal reverse-looks-up the binding (null before correlation)', () => {
    expect(sessionIdForTerminal('term-1')).toBe('sess-1')
    expect(sessionIdForTerminal('term-x')).toBeNull()
  })
  it('archiveTerminal: invoke FIRST, then forget the registry entry and return to the board', () => {
    archiveTerminal('term-1')
    expect(archive).toHaveBeenCalledWith('term-1')
    expect(boardStore.getState().launchedTerminals['term-1']).toBeUndefined()
    expect(boardStore.getState().viewMode).toBe('board')
  })
  it('deleteTerminal: invoke with the known session id, clear the confirm, forget, board', () => {
    deleteTerminal('term-1', 'sess-1')
    expect(del).toHaveBeenCalledWith('term-1', 'sess-1')
    expect(boardStore.getState().stopConfirm).toBeNull()
    expect(boardStore.getState().launchedTerminals['term-1']).toBeUndefined()
    expect(boardStore.getState().viewMode).toBe('board')
  })
  it('a rejected invoke logs a code only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    archive.mockReturnValueOnce(Promise.reject(new Error('/home/op/secret')))
    archiveTerminal('term-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith('[claude-watcher][exit] code=archive_failed')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/home/op')
    warn.mockRestore()
  })
})
