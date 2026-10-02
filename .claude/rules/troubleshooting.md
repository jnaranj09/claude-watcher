---
paths:
  - 'src/**'
  - 'tests/**'
---

# Rule: troubleshooting (characterize first, theorize second)

A symptom in one layer (main / preload / renderer / session engine) is easy to blame on another.
Before reading code, answering a theory, or fanning out subagents, answer these three (a
30-second manual repro):

1. **Is the data present?** Content survives (text reappears, session exists) ⇒ bytes arrived ⇒
   look at **render / view-state / layout**. Content missing ⇒ **transport / main / PTY / feed**.
2. **Does it depend on a sibling?** Killing another terminal/card fixes it ⇒ **shared resource or
   layout/stacking/z-index**. Independent ⇒ the component's own lifecycle/transport.
3. **Is the DevTools console empty?** Empty + visual glitch ⇒ **CSS/paint** (every transport failure
   logs a `code=`). `code=` present ⇒ follow it to its layer.

## Symptom → suspect → cheapest test

| Symptom                                                       | Suspect                                | Test                                                                                |
| ------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| Terminal blank, content preserved, needs a 2nd terminal alive | layout/stacking                        | stop the other terminal; inspect computed `visibility`, size, paint order           |
| Terminal blank, content never arrived, `code=` in console     | port pairing / `openToken` / spawn     | read the `code=`; `terminalManager` spawn vs reAttach                               |
| Wrong size / clipped                                          | `fit()` on 0×0, resize order           | log `clientWidth/Height` in `doFit`                                                 |
| Garbled / wrong-session bytes                                 | port cross-wire                        | compare minted vs echoed `openToken`                                                |
| Blank only in dev                                             | StrictMode double-mount                | disable StrictMode                                                                  |
| Launched session has no card                                  | launch synthesis / hook ingest         | replay `src/__fixtures__/fakeHookFeed` or `curl -X POST 127.0.0.1:9279 -d '<body>'` |
| One bad session blanks the board                              | Zod boundary violation                 | `zod-boundaries.md`                                                                 |
| "App won't start": process alive, no window                   | window created but not shown/minimized | KWin script below                                                                   |

Other kill-tests: gate off `WebglAddon` in `EmbeddedTerminal.tsx` (GPU vs rest); reduce to one
session.

**Does the window exist? (KDE Wayland)** — `ps` and screenshots mislead:

```bash
cat > /tmp/lw.js <<'EOF'
const l = workspace.windowList ? workspace.windowList() : workspace.clientList()
for (const w of l) print("WIN|" + w.resourceClass + "|" + w.caption + "|min=" + w.minimized
  + "|geom=" + w.frameGeometry.x + "," + w.frameGeometry.y)
EOF
id=$(qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript /tmp/lw.js)
qdbus6 org.kde.KWin /Scripting/Script$id org.kde.kwin.Script.run
journalctl --user -n 50 | grep 'WIN|'
```

Listed `com.claudewatcher.app` ⇒ started fine; problem is show/stack/minimize.

## Traps

- Packaged build has no StrictMode — "passes in prod" does not clear a dev-only bug.
- Empty console ≠ healthy: it rules transport OUT, not the bug.
- A manual repro with real `claude` beats any scripted diagnostic that can't run claude.

## Worked example (blank 2nd terminal)

Content preserved + needs a live sibling + empty console ⇒ layout. Cause: stacked
`position:absolute` frames each paint opaque `bg-terminal`, but only the inner host was hidden, so a
later inactive frame covered the active one. Fix: hide the whole frame (`terminal.md`). Time was
lost chasing transport → StrictMode → WebGL before running Step 0.

Layer rules: `ipc.md`, `zod-boundaries.md`, `terminal.md`, `state.md`.
