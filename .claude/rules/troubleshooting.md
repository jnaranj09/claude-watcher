# Rule: how to troubleshoot this app (read BEFORE you theorize)

This app spans three process layers (main / preload / renderer) plus the native
session engine (spawn-time launch synthesis + the :9279 hook ingest).
A symptom in one layer is easy to misattribute to another — and chasing the wrong
layer is the main way time gets wasted here. The fix is to **characterize the symptom
before reading any code**, which usually pins the layer in under a minute.

## The one rule

**Characterize first, theorize second.** Before forming a hypothesis or opening a
file, get the operator (or yourself) to answer the three questions below. They are
cheap to answer (a 30-second manual repro) and they split the layers decisively. Do
NOT start a deep code read, a subagent fan-out, or a "maybe it's the transport/
StrictMode/WebGL" theory until you have all three answers.

## Step 0 — the three questions that split the layers

1. **Is the data present?** Is content preserved — does the buffer/board state survive
   the glitch (e.g. typed text reappears later, the session still exists)?
   - Content preserved ⇒ the bytes/state arrived. NOT a transport/main/PTY bug. Look
     at **render / view-state / layout**.
   - Content genuinely missing / never arrived ⇒ **transport / main / PTY / feed**.
2. **Does it depend on ANOTHER component's state?** Does removing a sibling fix it —
   stop the other terminal, drop to one session, remove the other card?
   - Killing a sibling fixes it ⇒ **shared resource or layout/stacking/z-index**, not
     the component in isolation.
   - Independent of siblings ⇒ the component's own lifecycle/transport.
3. **Is the DevTools console empty?** (Empty console does NOT mean "nothing is wrong.")
   - Empty + a visual glitch ⇒ **CSS / layout / paint** — there is no JS error path,
     and every transport failure in this app logs a `code=` (see `zod-boundaries.md`,
     `terminalManager.ts`). Silence rules transport OUT.
   - `code=` / errors present ⇒ follow the log string to its layer; don't guess.

## Symptom → suspect layer → cheapest kill-test

| Symptom | First suspect (after Step 0) | Cheapest kill-test |
| --- | --- | --- |
| Terminal blank, **content preserved**, depends on a 2nd terminal being alive | renderer **layout/stacking** (z-index, opaque bg, `visibility`) | stop the other terminal; inspect the live DOM (computed `visibility`, `clientWidth/Height`, paint order) |
| Terminal blank, **content never arrived**, console has `code=` | transport: port pairing / `openToken` / spawn | read the `code=` line; check `terminalManager` spawn-vs-reAttach |
| Terminal wrong size / clipped, content there | `fit()` on a 0×0 box, resize ordering | log `clientWidth/Height` in `doFit`; → `terminal.md` |
| Garbled / wrong-session bytes | port cross-wire / `openToken` mismatch | compare minted vs echoed `openToken` (renderer ↔ main) |
| Blank only in dev, fine in packaged build | StrictMode double-mount race | disable StrictMode in the renderer entry and re-run |
| Launched session has no board card | launch synthesis / hook ingest (upsertLaunched never ran, or hooks not registered) | replay the fixture bodies (`src/__fixtures__/fakeHookFeed`) or POST one by hand to `127.0.0.1:9279`; → `state.md`, story-5.x/6.x memory |
| One bad session blanks the whole board | never-crash / Zod boundary violation | → `zod-boundaries.md` (drop+log-by-path, don't poison) |

## Cheap kill-tests (run BEFORE a deep code read)

- **Force the canvas renderer** — gate off the `WebglAddon` in `EmbeddedTerminal.tsx`.
  Splits "GPU/WebGL" from "everything else." (In the blank-2nd-terminal incident this
  came back negative — the bug reproduced on the DOM renderer too — which is what
  redirected us to layout.)
- **Reduce to one** — stop every sibling (terminal/session/card) but the affected one.
  If it recovers, the cause is shared/stacking, not the component.
- **Disable StrictMode** — removes the dev mount→cleanup→remount cycle. Splits a
  dev-only double-mount race from a steady-state bug.
- **Feed the fixture** — drive the ingest from `src/__fixtures__/fakeHookFeed` (or
  `curl -X POST 127.0.0.1:9279 -d '<body>'` with a fixture body) instead of a live
  claude. Splits "claude's hook payloads drifted" from "our reducer/ingest is wrong."
- **Inspect the live DOM** (DevTools Elements) — for any paint/layout symptom, read the
  computed `visibility`, `clientWidth/Height`, `position`, and z-stacking of the actual
  nodes. A CSS bug is invisible in logs but obvious in the computed styles.

## Known traps

- **The `tests/e2e/two-launch-screenshot*.mjs` diagnostics are NOT trustworthy.** They
  grep for `open-call` / `port-recv` / `port-skip` console markers that were never
  committed to this tree, so they record an EMPTY event stream, and their scripted
  launch can't run a real `claude` (both terminals come up blank → false-blank). A
  **manual repro with real `claude` is the only reliable signal.** Don't trust a
  harness run until you've confirmed it emits the markers it greps for. (Either revive
  the source-side instrumentation + make the launch paint, or delete these scripts.)
- **The packaged/prod path has NO StrictMode** — it cannot reproduce dev-only
  double-mount bugs. A "passes in prod" result does not clear a dev-only symptom.
- **Empty console ≠ healthy.** CSS/layout/paint bugs are silent. Use Step-0 Q3 to read
  the silence correctly (it rules transport OUT, it does not rule the bug out).

## Worked example (the canonical case — the blank-2nd-terminal incident)

Symptom: the focused terminal rendered blank **only while a second terminal was alive**;
stopping the other terminal revealed it with **content intact**; the console was
**empty**; it reproduced on **both** the WebGL and DOM renderers.

- Step-0 answers: Q1 content preserved ⇒ not transport. Q2 depends on a live sibling ⇒
  shared/layout. Q3 console empty ⇒ CSS/paint. Those three alone point at renderer
  layout — before any code is read.
- Root cause: kept-alive terminal frames are stacked `position:absolute` at the same
  z-index, each painting an OPAQUE `bg-terminal` background, but only the inner `.host`
  toggled `visibility`. An inactive frame that sorted later in DOM order painted its
  background OVER the active terminal → blank. Fix: hide the WHOLE frame (`terminal.md`).
- Time lost: we chased transport → StrictMode → WebGL first **because we theorized
  before running Step 0.** Running the three questions up front would have skipped
  straight to layout. That is the entire reason this file exists.

## Where each layer's rules live

- transport / IPC seam → `.claude/rules/ipc.md`
- external input / fail-closed boundaries / `code=`-only logging → `.claude/rules/zod-boundaries.md`
- xterm / terminal rendering / kept-alive stacking → `.claude/rules/terminal.md`
- session-truth vs view-state vs derived → `.claude/rules/state.md`
- launched-session ↔ card correlation, feed DESYNC → the `story-5.x` project memory notes
