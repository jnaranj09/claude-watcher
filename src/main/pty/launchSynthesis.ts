// Session-naming — the "what Session does a spawn synthesize?" decision, extracted (mirrors the
// launchMint.ts / launchRemoval.ts precedent) so it is unit-testable without Electron. index.ts
// wires it once, inside the CH.terminalOpen handler, right before `upsertLaunched`.
//
// WHY THE EXTRACTION IS LOAD-BEARING: before it, the operator's session NAME reached the board
// through exactly ONE expression inlined in `index.ts`, and no test could import `index.ts` — so
// reverting that expression to the pre-naming `basename(cwd)` left the whole suite green. The
// naming feature had a single point of failure with zero coverage. This module is that expression,
// now behind a fault-injectable seam.
//
// The Session is CONSTRUCTED from MAIN-OWNED values (the launch-minted uuid, the picked cwd, the
// operator's name, the pty pid) — internal data, NOT external input — so it is deliberately NOT
// re-run through `SessionSchema` (parse-once boundary: `.claude/rules/zod-boundaries.md`). The
// name was already validated at the IPC boundary by `SessionNameSchema` before it ever reached
// the launch service.
//
// `Connecting` classifies into the `working` column; hooks own every later transition
// (UserPromptSubmit → Working, Stop → WaitingForInput, …) and never rewrite `sessionName`.
import { basename } from 'node:path'
import type { Session } from '../../shared/schemas/session'
import type { MintedLaunchSpawn } from './launchSession'

/**
 * Build the Session a fresh launch spawn synthesizes onto the board.
 *
 * The name is the OPERATOR's, recorded at `launch()` and read back off the spawn override (it
 * lives beside `cwd` there because both are per-terminal launch-recipe values with the same key
 * and lifetime).
 *
 * NOTE: a session name belongs to ONE session. There is no UI path that re-spawns a terminal
 * frame under its previous name — the dead pane's only action is "New session"
 * (`EmbeddedTerminal.tsx` `dead-new-session`), which runs the full picker → name-prompt flow and
 * mints a NEW terminalId. The override is read more than once only on the dev StrictMode
 * double-mount (stop → re-open of the same terminalId).
 *
 * The `basename(cwd)` fallback is DEFENSIVE only: `displayName` is a required `string` fed from a
 * `SessionNameSchema`-validated value, so an empty one is unreachable through the shipped launch
 * path — but a caller constructing a `MintedLaunchSpawn` by hand must degrade to the pre-naming
 * behavior rather than put a blank title on the board.
 */
export function buildLaunchedSession(minted: MintedLaunchSpawn, ptyPid: number): Session {
  return {
    id: minted.sessionId,
    status: 'Connecting',
    projectPath: minted.spawn.cwd,
    sessionName: minted.displayName || basename(minted.spawn.cwd),
    pid: ptyPid
  }
}
