# Rule: state ownership

> NOTE: Zustand is NOT installed yet (it arrives in Epic 1). This file is the
> STANDARD the Epic-1 renderer store MUST follow — not a description of code that
> exists today.

## Ownership taxonomy (who owns what)

| Kind              | Owner                  | Where                                                                                                                                        |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session truth** | the MAIN process       | derived from the c9watch feed; main parses + reduces, then ships validated deltas to the renderer over `CH.watchSnapshot` / `CH.watchEvents` |
| **View state**    | the RENDERER           | a Zustand store (selected card, filters, hover, column layout, attention badge count)                                                        |
| **Derived state** | nobody — it's COMPUTED | narrow selectors over the store; never stored separately (no denormalized copies to keep in sync)                                            |
| **Terminals**     | imperative refs        | NOT in the store (see `.claude/rules/terminal.md`; SM-C2)                                                                                    |

## The rules

- **Main is the single source of truth for sessions.** The renderer never invents or
  mutates session truth; it renders what main sends (already validated at the Zod
  boundary). Renderer-side session state is a projection, not an authority.
- **Narrow selectors.** Components subscribe to the SMALLEST slice they need
  (`useStore(s => s.selectedId)`), never the whole store — so an unrelated change
  doesn't re-render the board. Derive (filter/sort/group) in selectors, don't
  persist the derived result.
- **No terminals in the store.** Terminals are imperative external resources held in
  refs; putting them in the store would couple xterm's lifecycle to render cycles.
- **One-way flow.** c9watch → main (parse + reduce) → validated deltas → renderer
  store → selectors → components. View intent flows back via typed IPC
  (`.claude/rules/ipc.md`), not by mutating session truth in the renderer.

## When you build the Epic-1 store

- Keep actions pure and small; inject `now()` for any time-based reasoning so tests
  are deterministic (architecture: "inject now() for epoch-millis determinism").
- The store reduces VALIDATED deltas only — never raw c9watch JSON (that is parsed
  upstream at the `src/shared/schemas/session.ts` boundary).
