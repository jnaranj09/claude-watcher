---
paths:
  - 'src/renderer/src/stores/**'
  - 'src/main/c9watch/**'
---

# Rule: state ownership

| Kind          | Owner             | Where                                                                                          |
| ------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| Session truth | MAIN              | launch synthesis + hook ingest → reducer → validated deltas (`CH.watchSnapshot`/`watchEvents`) |
| View state    | RENDERER          | Zustand (`stores/boardStore.ts` + workspaces/theme stores): selection, filters, layout, badge  |
| Derived       | nobody — computed | narrow selectors; never stored                                                                 |
| Terminals     | imperative refs   | never in the store (`terminal.md`, SM-C2)                                                      |

- Main is the single source of truth; the renderer renders a projection, never invents or mutates
  session truth. View intent goes back via typed IPC (`ipc.md`).
- Narrow selectors (`useStore(s => s.selectedId)`), never the whole store. Derive in selectors.
- Store reduces VALIDATED deltas only (parsed at `shared/schemas/session.ts`).
- Keep actions pure and small; inject `now()` for time logic.
