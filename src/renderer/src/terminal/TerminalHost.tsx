// Story 3.1 (FR-10) — a MINIMAL terminal host to prove the embedded terminal end-to-end.
//
// SCOPE BOUNDARY (F1) — this is 3.1's standalone proof, NOT the real focused-session view:
//   - 3.1 proves the terminal by spawning a SHELL (and the operator can run `htop` in it) —
//     the FR-10 packaged acceptance (spawn → type → resize → htop).
//   - the native-picker `claude` LAUNCH (FR-11) is Story 3.2.
//   - the board-card ↔ terminal PAIRING (via Tgid/id) + the focused-session navigation
//     (BoardProps.onActivateCard) is Story 3.2 / 3.4.
//   - the launched-set / app-launched-vs-external filter is Story 3.3.
// So this host just opens one (or a few) embedded terminals directly. It is reachable via the
// URL hash (`#terminals` → 1; `#terminals=N` → N, for the NFR-5 many-terminals manual check)
// so it does NOT alter the default board view or the Story-0.1 smoke path. [Source: story 3.1
// Task 5; epics.md Story 3.2/3.3/3.4; .claude/rules/terminal.md]
import { useMemo } from 'react'
import { EmbeddedTerminal } from './EmbeddedTerminal'

export function TerminalHost({ count }: { count: number }): React.JSX.Element {
  // Stable opaque terminalIds for this host instance (NOT session ids, NOT pids — F6). Memoized
  // so a re-render does not change the ids (which would tear down + recreate the terminals).
  const ids = useMemo(
    () => Array.from({ length: count }, (_unused, i) => `host-term-${i}`),
    [count]
  )

  return (
    <div
      data-testid="terminal-host"
      style={{
        display: 'grid',
        gridTemplateColumns: count <= 1 ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))',
        gap: 'var(--card-gap)',
        padding: 'var(--space-3)',
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        background: 'var(--bg-base)',
        overflow: 'auto'
      }}
    >
      {ids.map((id) => (
        // Each cell gets a non-zero box so the terminal's fit() works; min-height for the grid.
        <div key={id} style={{ minHeight: 280, minWidth: 0, display: 'flex' }}>
          <EmbeddedTerminal terminalId={id} />
        </div>
      ))}
    </div>
  )
}
