# HANDOFF — Story 5.7 (fix B: heal the feed DESYNC so a launched session's c9watch card appears)

> Continuity doc for a fresh session. Self-contained; read top-to-bottom. The project's own
> guidance (`CLAUDE.md` + `.claude/rules/*`) and the BMad flow still apply.
> Written 2026-06-22, after Stories 5.5 + 5.6 landed on `main`.
> UPDATED 2026-06-23: investigation done + fork RESOLVED (Option B) — see the DECISION section.

## ✅ DECISION (2026-06-23) — Option B, fork RESOLVED (Jose)

**Story 5.7 will fix the DESYNC drop via OPTION B — reducer upsert.** When an unknown-id
`changed`/`status_changed` reaches the DESYNC branch (`reducer.ts:200-208`), UPSERT the session
exactly like `started` (`map.set(session.id, session)` + emit `toUpdated(session)`) instead of
dropping it — PLUS keep a `code=desync_healed` log so the heal stays observable (risk #3).

**Why B is safe (static evidence — the investigation is DONE):**
- The DESYNC drop runs DOWNSTREAM of `WatchLineSchema.safeParse`. That schema REQUIRES a full
  `SessionSchema` on every non-stopped event incl. `status_changed` (`session.ts:133-140`), and
  `SessionSchema` makes every card-building field REQUIRED — `id`, `status`, `projectPath`, `pid`,
  `sessionName` (`session.ts:59-67`). So any line reaching the drop is already CARD-COMPLETE → the
  upsert builds a real card with NO `list` reconcile needed.
- Contract doc + reducer/liveContract fixtures corroborate; `--compact` still carries every
  required field.

**Risk analysis (the full reasoning was worked through in chat 2026-06-23):**

| # | Risk | Severity |
| --- | --- | --- |
| 1 | External/Konsole sessions leaking onto the board | **NOT a risk** — the launched-set ship gate (`shipGate.ts:38-43`, `shouldShipToBoard = isLaunched(id)`) drops every non-launched id at the SHIP chokepoint. B changes the reducer MAP, not the gate; external sessions already enter the map via `started` today and are filtered the same way. |
| 2 | Stale/empty field VALUES on a brand-new-id `status_changed` | **The one residual.** Schema guarantees fields EXIST, not that values are meaningful. → the live-value check below. Bounded: `started` builds cards from the same fields. |
| 3 | Lost desync observability if the upsert is silent | Minor — keep a `code=desync_healed` log (folded into the decision above). |
| 4 | Doesn't generalize to other desync classes | Coverage limit, not a bug (the trade vs A′). A′ stays a documented future backstop. |
| 5 | Resurrection of a legitimately-removed id | Minor — `stopped` uses a separate schema path; add a test. |

**The ONE open item before shipping = the live-value check (risk #2):** capture a real
`c9watch watch` (NOT `--compact`) line for a freshly-launched session and confirm its `session`
carries MEANINGFUL `sessionName` + `projectPath` + valid `pid` (not empty placeholders). Meaningful
→ ship B; placeholder → reconsider A′. Add the captured line as a `liveContract.test.ts` fixture.

## Status / where this sits

- **`8ac8929` was the 5.5/5.6 baseline.** Since then `main` advanced with Fixes #1–#4 (incl.
  Fix #4 = the blank-terminal kept-alive-frame-stacking bug) + the troubleshooting playbook
  (`.claude/rules/troubleshooting.md`) + this handoff; `epic-5-defect-remediation` is kept ff'd to
  `main` (the `main == epic` invariant holds). Local-only repo (no remote).
  - `b7e887e` — **Story 5.5**: correlate launch↔session by SUBTREE ANCESTRY (`isAncestorOf`). Made the eventual correlation join *work* for claude 2.1.186's process shape. Necessary-not-sufficient.
  - `8ac8929` — **Story 5.6**: `launchedTerminals` registry + the **Starting banner**. Made an app-launched terminal **reachable** (and kept-alive) WITHOUT waiting on c9watch.
- **Story 5.7 is NOT started.** This handoff is its scoping seed. It is the last piece of the Story-5.5 empty-board root cause (memory `story-5-5-empty-board-rootcause`).
- **5.7 is completeness, NOT a blocker.** 5.6 already restores reachability via the Starting banner. 5.7 only makes a launched session *also graduate into the 3-column board* once c9watch finally sees it (and supersede out of the Starting banner). If you're triaging, this is lower urgency than 5.5/5.6 were.

## The problem (proven root cause — layer 2 of two)

A launched `claude` never becomes a board CARD on a stable connection. Two layers (memory `story-5-5-empty-board-rootcause`):

- **Layer 1 (NOT ours to fix):** c9watch can't see a launched `claude` until its FIRST transcript message writes a `.jsonl`. Before that there is no session at all. (This is claude/c9watch behavior — the manual gate must send a first message.)
- **Layer 2 = FIX B (this story):** even once c9watch HAS the session, the app drops it:
  1. `c9watch watch --changes-only` skips the initial `started` burst and, for a session that appears AFTER watch begins, emits only `status_changed` — never a `started`.
  2. The reducer DELIBERATELY DROPS a `status_changed`/`changed` for an unknown id — **`src/main/c9watch/reducer.ts:200-208`** (the DESYNC branch: `log({ path:'(desync)', code:'unknown_id_changed' }); return []`), on the comment-promise "the next `list` reconcile heals it idempotently + level-triggered."
  3. **But the feed re-runs `c9watch list` ONLY on RECONNECT** — `src/main/c9watch/feed.ts` ("watch exit → drain → restart → fresh `list` snapshot → diff vs the reducer's map → emit", `feed.ts:8`; the seed list is in `start()` and the only re-list is the reconnect path). There is NO timer/periodic reconcile. So on a stable connection the DESYNC promise is never kept → the session never enters the reducer map → never correlates (5.5) → never ships a card (Story-3.3 ship gate) → never appears.
  - **Live proof (2026-06-22):** `c9watch list` = 4 sessions while the correlation tick saw `sessions=3`; the new session id appeared in 0 ticks.

## THE load-bearing investigation (do this FIRST — it decides the whole fork)

**What does a real `status_changed` line's `session` payload actually contain?**

Why it's decisive: the `started` branch directly above the DESYNC drop already builds a card from `line.session` — `reducer.ts:193-197` does `map.set(session.id, session)`. And `WatchLineSchema` (`src/shared/schemas/session.ts:133-142`) REQUIRES a full `session` object (`event: z.enum([...]), session: <SessionSchema>`) for EVERY event, including `status_changed` — so any `status_changed` line that reaches `:201` already carries a schema-valid session.

- **If a real `status_changed` line carries a fully-populated session** (id + status + pid + sessionName + projectPath, i.e. everything `started` gets) → **fix B is ~3 lines: make the unknown-id branch upsert instead of drop** (treat unknown-id `status_changed` exactly like `started`). The DESYNC drop's "don't invent from a PARTIAL signal" comment (`reducer.ts:202-204`) would then be over-cautious / stale, and the fix is to delete the drop.
- **If it carries only a PARTIAL session** (e.g. id + status, stale/empty name/path/pid) → you CANNOT build a complete card from it → you need a `list` reconcile (Option A) to get the full session.

**How to find out (cheap):** capture a real line. Run `c9watch watch --changes-only` (or `--changes-only` equivalent) in a terminal, launch a `claude` in another dir, send it one message, and inspect the emitted `status_changed` JSON for that new session — does its `session` object have the full fields or just id+status? Cross-check the contract doc `_bmad-output/implementation-artifacts/c9watch-0.8.1-contract.md` (it documents the line shapes; note Story 5.2 already corrected one drift there — verify it against the live binary, don't trust the doc alone). The existing drift alarm `liveContract.test.ts` is the place to add a captured fixture.

## The design fork — ✅ RESOLVED: Option B (see DECISION at top)

> The options below are kept as the reasoning record. Jose chose **Option B** on 2026-06-23 after
> the static payload-completeness investigation; A′ remains a documented future backstop.

- **Option B — reducer upsert on unknown-id `status_changed`** (`reducer.ts:201-208`). Event-driven, no polling, likely ~3 lines IF the payload is full. Cleanest. The risk is purely "is the payload full enough" (the investigation above).
- **Option A — feed periodic/on-demand `list` reconcile** (`feed.ts`). Make the DESYNC comment's promise true: re-run `listFn()` off the reconnect path. Heals ANY desync (not just status_changed-for-unknown-id), more robust. Costs: (1) `defaultList` is `execFileSync('c9watch', ['list'])` — a SYNCHRONOUS BLOCKING exec on the main thread (`feed.ts:93-112`); a blind timer repeatedly blocks main → prefer an async list or a low frequency; (2) pick a cadence; (3) the `list` snapshot path throws on malformed and the caller backs off (zod-boundaries) — preserve that.
- **Option A′ (hybrid, reconcile-on-demand)** — on an unknown-id `status_changed`, trigger ONE `listFn()` reconcile (level-triggered, only when a desync is actually detected) instead of a blind timer. Gets the reducer's promised heal without polling; costs a reducer→feed signal seam.

**Recommended approach:** investigate the payload first. If full → **Option B** (minimal, event-driven). Consider keeping an on-demand or low-frequency `list` reconcile (A′) as a robustness backstop for *other* desyncs, since the reducer literally documents that a `list` heals it — but that can be a follow-up. **Hand the final fork to Jose with the payload evidence** (same pattern as the 5.6 UX steer).

## Key files + pointers

- `src/main/c9watch/reducer.ts:200-211` — the DESYNC drop (`:206-207`) vs the `started` upsert (`:193-197`) and the normal `changed`/`status_changed` update (`:209-211`). This is where Option B lives.
- `src/main/c9watch/feed.ts` — `start()` (seed list, `:72-73`), the reconnect-only re-list (`:8` overview; locate the reconnect handler that calls `listFn()` + diffs), the `listFn` DI seam (`:41-50`), `defaultList` sync exec (`:93-112`), `reconnectDelayMs` (`:66-68`), `onStatus` reconnecting signal (`:57-62`). This is where Option A/A′ lives.
- `src/shared/schemas/session.ts:133-142` — `WatchLineSchema` (requires `session` on every event); the separate looser `StopLineSchema` (`:170+`) for `stopped`. Confirms the schema-level shape; the LIVE payload completeness is the open question.
- `src/main/index.ts` — `correlateAgainst` wiring (~`:264`) + the ship gate at the SHIP chokepoint (`shipGate.shouldShipToBoard`, ~`:286`). Once a session enters the reducer map, 5.5's ancestry correlation joins it → launched-set → ship gate → card. **Fix B only needs to get the session INTO the reducer map; the rest is already wired.**
- `src/main/c9watch/shipGate.ts`, `src/main/pty/launchedSet.ts` — UNCHANGED by 5.7; just the downstream that lights up once the session is in the map.
- `_bmad-output/implementation-artifacts/c9watch-0.8.1-contract.md` — the contract doc (verify against the live binary).
- `liveContract.test.ts` — the drift alarm; add a captured `status_changed` fixture here.

## Constraints / frozen (do not violate)

- **Fail-closed Zod boundaries** (`.claude/rules/zod-boundaries.md`): a `watch` line drops+logs-BY-PATH (never the value); a `list` snapshot throws → caller decides (reconnect/back off). **Never log the parsed value** (the DESYNC log already uses `path:'(desync)'` + a code — keep that discipline). Don't enum-lock `status`. Key/dedup by `id`, never `pid`. The reducer is a PARSE-ONCE boundary.
- **Never-crash past the boundary** — one bad line/session must not take down the feed.
- Frozen `AttentionEvent` union (no new member); main owns session truth; identity by `id`. No new IPC expected (the card ships over the existing `CH.watchEvents`). If you find you need a new channel, that's a design escalation — flag it.

## Testing + gate

- **`main-unit` (node) Vitest project** for the reducer + feed (this is main-side logic). DI seams: inject the fake feed / fake `spawnFn` / fake `listFn`; **inject `now()`** and any timer/clock for deterministic tests (architecture: "inject now() for epoch-millis determinism"). Ban deep `vi.mock('node-pty')` — use the seams.
- **Fault-injection non-vacuity is mandatory** (a fresh Opus reviewer re-runs the gate first-hand and reverts each guard). E.g. for Option B: a `status_changed` for an unknown id must now produce a card; reverting the upsert → that test goes red.
- Add a **deterministic drift-alarm fixture** for the real `status_changed`-for-new-session line in `liveContract.test.ts` (this is the coverage hole that let the original bug ship — Story 5.2's lesson).
- **Gate:** `typecheck / lint / test / build`. **`build:dir` + `smoke` are NOT required** (main-side reducer/feed logic; no node-pty/preload/IPC-contract/packaging change — the 5-2/5-3 bucket). If Option A adds a blocking sync `list` on a timer, consider an async list to avoid stalling main; that's still not a packaging change.

## BMad flow + model split (how Jose runs this)

Orchestrate; spawn subagents per step (memory `bmad-orchestration-model-split`):
- **create-story = Opus** (fan out analysis subagents; validate with a fresh Opus reviewer).
- **dev-story = Sonnet, high thinking.**
- **code-review = Opus** (fresh, re-runs the gate first-hand; fault-injects every guard).
- The **orchestrator (Opus main loop) owns git + the sprint-status transitions**; nothing auto-commits (confirm-before-commit). Stories committed individually, then ff-merged to `main`.

## How to start (concrete first steps) — fork ALREADY resolved (Option B)

1. Read memory `story-5-5-empty-board-rootcause` + this handoff (esp. the DECISION section at top).
2. **Investigation: DONE (static).** Payload is schema-card-complete → Option B (reducer upsert). No `list` reconcile needed.
3. **The one open item — live-value check (risk #2):** capture a real `c9watch watch` (NOT `--compact`) line for a freshly-launched session; confirm `sessionName`/`projectPath`/`pid` are MEANINGFUL, not placeholders. Add it as a `liveContract.test.ts` fixture. (Can be folded into the real-KDE manual gate, which already launches + sends a message.)
4. Run `bmad-create-story` (Opus, orchestrated) for `story 5.7 — heal the feed DESYNC (fix B: reducer upsert on unknown-id status_changed, + desync_healed log)`, carrying Option B. Add a `5-7-...: backlog` line to `sprint-status.yaml` (5.7 is not yet in the ledger).
5. dev (Sonnet, high thinking) → code-review (Opus) → commit → ff-merge to `main`.

## Manual gate (real-KDE, Jose — the proof fix B works)

`npm run dev` → `+ New session` → pick a folder → **send the new claude one message** (so a transcript exists and c9watch picks it up) → confirm the session's card **appears in the 3-column board WITHOUT a reconnect**, and its entry **supersedes out of the Starting banner** (5.6). Today it never appears on a stable connection; after fix B it should.

## References

- Memory: `story-5-5-empty-board-rootcause` (proven root cause), `story-5-4-launch-lifecycle`, `bmad-orchestration-model-split`.
- Commits: `8ac8929` (5.6), `b7e887e` (5.5), `80f1dc2` (Epic 5 stories 5.1–5.4).
- Sprint ledger: `_bmad-output/implementation-artifacts/sprint-status.yaml` (Story 5-5 + 5-6 entries name 5.7 as the companion defect).
- Story 5.6 file: `_bmad-output/implementation-artifacts/5-6-keep-app-launched-terminals-reachable.md` ("Out of scope → Story 5.7").
