# Technical taste — claude-watcher

This file is for AI agents that design and build this app **unattended**. It tells you how the
owner decides, so you can decide the same way without asking him.

Built 2026-10-01 from: 505 commits (2026-06-18 → 10-01), 23 design specs and their plans, the June
planning docs, stories and retros, a bug-hunt report, and about 550 messages the owner typed in
build sessions. **Later decisions win.** Where an old decision was reversed, only the new one is
written here as a rule. The reversal log (§12) exists so you do not bring an old idea back.

Merged 2026-10-01 with a research pass on what the best engineers (Karpathy, Ousterhout, Beck,
Fowler, Hickey, Carmack, Metz, Willison, Hashimoto, Ronacher and others), the AI coding vendors
(Anthropic, OpenAI) and the empirical studies say about code that agents can build and maintain.

- **The owner's taste decides product, UX, visuals and copy.**
- **On engineering, the owner's decisions stand, and the research fills the gaps.** §5b holds the
  merged rules. Each one has a **grade** (evidence-backed / expert consensus / taste) and a
  **sensor** (the check that goes red when the rule is broken), or says "prose only".
- Where the owner's taste and the evidence pull apart, §5c says so honestly.

## 0. How to use this file

**Precedence (highest first):**

1. The prompt of your run.
2. `CLAUDE.md` and `.claude/rules/*.md`. They are binding, and guard tests enforce many of them.
   This file does not repeat them. It gives the _why_ and the defaults they leave open.
3. This file.
4. The house pattern: the closest sibling in `src/` that already does the same job.

If a rule file and the code disagree, the newer one wins. Check with `git log`. See §14.

**When this file is silent, decide in this order:**

1. **Safety first, function later.** These are the owner's words for unattended work: "Take the
   decisions for me based on safety first functional later. If I hit a wall later functionally on
   something we'll work it out."
2. Pick the **smallest fix that tells the truth**: the one that removes the problem, shows the
   operator what happened, and touches the fewest seams.
3. **Copy the house pattern** over a new elegant one: "Consistency with the existing sibling
   wins."
4. **Follow good, standard UX patterns.** Linear and Raycast are the reference apps.
5. **When experts split, pick the option a sensor can enforce** (a type, a lint rule, a guard
   test, a hook). A rule that turns something red holds up under unattended agents; a paragraph of
   prose does not.
6. **Write the choice down.** In the spec, tag it `[AGENT]` (the owner's picks are `[OPERATOR]`)
   and list it under "Assumed (correct me in review)". An `[AGENT]` decision is the first thing the
   owner will challenge, so give a one-line reason.

**Stop and leave a "Decision needed" note (do not guess) only when the choice is one of these:**

- An outward action: push, tag, release, publish, anything sent off the machine.
- Weakening a security flag, a fail-closed boundary, a strict TS flag, or a contrast threshold.
- Bumping a persisted file version without a migration, or anything that can lose operator data.
- Contradicting a decision that is frozen in a spec or rule file ("STOP and surface — do not
  silently re-decide").
- A product-semantics change: what a status _means_, what counts as an alert, what the API
  exposes.
- A new look for a meaning the app already draws (selected, current, hover, armed, a marker…).
  Reuse the existing part (design.md "Reuse before you draw"); a different look needs the owner.

For everything else, decide, record it, and continue.

## 1. What the owner values (ranked)

1. **The operator never loses data, text or attention without being told.** Fail closed, never
   silent.
2. **The app tells the truth.** Status comes from deterministic signals (hooks), never from
   guessing. The UI never claims what it cannot verify.
3. **The operator stays in control.** No background event steals the view. Nothing is
   auto-submitted into claude. claude keeps every key typed in its terminal.
4. **One standard per job.** One component, one token set, one layout, each enforced by a guard
   test. Two ways of doing one thing is a defect.
5. **Production-grade polish.** "Every action ends in a visible result." It must "look like a real
   app".
6. **Simple model, flexible edges.** "The native 3 [statuses] are enough." Flexibility comes from
   tags and rules, not from more states.
7. **For any user on any OS.** "I want this app to be user-general, not scoped to me." "Think in
   terms of this working for any user, any OS in the future."
8. **Narrow scope.** Ship the thin version. Park the rest on IdeasBoard.

## 2. Product and interaction taste

- **Attention is rationed.** Gold (needs-you) is the only hot colour and "has to stay the loudest
  thing in the room". If something wants to "pop", the answer is almost always no. Calm is the good
  state ("Nothing waiting. All quiet.").
- **Column = truth, not a kanban.** No drag, no manual moves, no hiding empty columns. A card moves
  only because its status changed.
- **Alerts are global, cards are scoped.** Notifications, sound and the badge ignore the
  workspace. The board, the lists and the counts filter by it.
- **A background event never takes the view.** An API create, a late launch result or a hook
  event never raises the window or changes focus. Only an explicit operator action does (Open, a
  notification click). "So if I'm working and an API call creates a session I'm taken out of
  focus?" → that was fixed before merge.
- **Type, never submit.** Shortcuts, the expander and the API's template prompt never press Enter
  for the operator, except where the API passes the prompt as claude's positional argument.
- **Every exit is Archive or Delete.** Archive is the default: it is reversible and has no
  confirm. Delete is explicit: red, with a confirm, and keeps nothing.
- **Delete cascades or is blocked.** "Deleted workspace should delete … anything related to it or
  block its deletion." Things link by **id, never by name** ("Renaming a workspace shouldn't affect
  things tied to it").
- **Unsure? Keep it visible.** An orphaned record stays findable somewhere the operator can fix it.
  It never fails the whole file closed.
- **Counts are honest and quiet.**
  - A workspace shows `1 (1)`, not `2 (1)`: the total leaves out the needs-you cards.
  - A count of 0 shows no dot.
  - Count pills are circles that match in size and alignment. A bare number "looks unpolished".
- **Configurable, with our recommendation as the default.** "Keep your recommendations but also
  give users control."
  - Behaviour the operator feels (reminder count and spacing, terminal scheme): make it a setting
    with a fixed option list, the recommended value as default, and `Off` as one of the options.
  - Internal mechanics: hard-code them.
- **Settings are global.** Config items (templates, shortcuts, rules) carry
  `workspaceId | null`, where null means global. A workspace view also lists the global rows when
  the operator's one remembered `Include global` choice is on (default); every row is marked with
  where it lives. Nothing is overridden.
- **Prefer ids and intents from the renderer.** The renderer sends a template id and main stamps
  everything else. Make the wrong state impossible to represent instead of checking for it.
- **Keyboard:**
  - Avoid new key bindings. The app has at most one app chord inside the window (the expander).
  - No OS-global hotkeys: Electron `globalShortcut` is broken on Wayland and fires while the app
    is unfocused.
  - No key archives or stops a session.
- **What counts as a bug:** only something the operator can actually reach. "A bug isn't really a
  bug if it's something the user will never do or cannot do in the app." A bug fix closes the hole
  and does not change behaviour.

## 3. Visual taste

**How the owner reacts to visuals.** These came up again and again. Apply them before he has to say
them:

- **Subtle over strong.** His most common feedback was "less", "less intense", "reduce the tint",
  "too colored", "too much noise". When unsure between two strengths, pick the quieter one.
- **Neutral over tinted.** "Too blueish", "too white", "too black" were all rejected. Dark themes
  are neutral charcoal or graphite, not blue-black and not warm taupe.
- **Restrained colour.** Diffused colour is fine. Busy colour is not ("looks like the sirens of a
  cop", "like a reflection on a car windshield", "too simple, just like 3 dots").
- **Room to breathe, but compact.** "Compact but airy." Text squeezed inside buttons, cramped
  dialogs, rows touching each other, and a search box glued to its list were all rejected.
- **Icons are quiet.** "I want the icons less visually llamative" (eye-catching): smaller and
  simpler.
- **Same meaning, same look.** The same pill or button in two places must look identical, and a
  test pins it.
- **Fix it in the app, not the theme, when the fix is general.** "I want it removed from the app
  not the theme so any theme inherits that." A fix must work in every theme: Default, Liquid Glass
  and Paper.

**Fixed rules** (details in `design.md`):

- **Colour meanings are fixed in every theme:** gold = needs-you, blue = working, red = danger,
  green = success. A small coloured circle means **status only**. Identity colour (a workspace) is
  a light tint of the whole control (14% fill / 40% border). A tag is a pill.
- **Colour is never the only cue.** The name is always shown, a dot always has a label, and the
  visual state comes from ARIA attributes.
- **Every colour is a token.** No hex in components. A new colour = a new themeable token with a
  documented meaning, mixed with `color-mix` over `--bg-surface-raised` so themes that set nothing
  still work.
- **Contrast floors are tested:** text ≥ 4.5:1, indicators ≥ 3:1. Text on a raised panel uses
  `--text-secondary`, never `--text-muted`. If a theme fails, fix the token. Never weaken the
  threshold.
- **The Default theme looks like an instrument panel.**
  - Crisp corners (4/6/8) and tonal depth.
  - Shadows only on floating layers.
  - System font for the chrome, mono for machine data.
  - Themes may break these rules (Paper uses pills, Liquid Glass uses blur). The theme author owns
    the taste.
- **Toggles:** an active toggle is "lit": white or `--text-primary` fill, with a dark icon or text
  on it. A filter toggle stays lit while its row is open or while a filter is on.
- **Buttons:**
  - The main action (e.g. `+ New session`) may stand out more. Secondary buttons are consistent
    with each other.
  - The primary look is a raised grey fill with a strong border and bold label, never a coloured
    accent (a blue primary "pulled the eye off the board").
- **Motion:** only needs-you pulses. Everything else is at most a 150 ms fade plus a small rise,
  and nothing under `prefers-reduced-motion`.
- **Layout stability:** nothing moves under the pointer. Button feedback swaps in place, the
  message slot reserves its height, and the Manage footer is sticky.
- **No native widgets.** No native `<select>` (GTK paints it light on a dark app), no native
  scrollbar (the app has a rounded custom one), no `alert`/`confirm`/error boxes.

## 4. Copy tone

- Talk operator to operator: short, literal, plain sentences that end with a period. No cheer, no
  emoji, no exclamation marks, no "Are you sure?".
- **Name the thing and the consequence.** "2 agents are still working — quit anyway?", "That
  folder no longer exists.", "Claude exited with code 1."
- Patterns to copy:
  - `Could not <verb> <thing>.`
  - `<Thing> saved.` / `<Thing> deleted.`
  - `Archived "<name>"`
  - `Select a <thing> on the left, or create a new one.`
- Error copy is **mapped from a code**. Never show `error.message`, raw ids, file paths or a value
  the operator typed.
- Show the machine's words exactly: status names and tool names are never relabelled.
- Explain the _why_ in a hint when it is not obvious: "Applies in Claude on your next prompt."
- A greyed-out Save says which field is wrong.

## 5. Engineering taste

- **Fail closed at the boundary, fail open on gates that could brick the app.**
  - Zod rejects bad input once, at one boundary.
  - The claude version check and the running-elsewhere scan fail open, because "a false block
    bricks a working install".
  - Pick the failure direction by which harm is worse.
- **Fail toward attention.** An unknown status is shown as needs-you: "safer surfaced than
  silently buried".
- **Degraded, not dead, and never silent.** No hook bind means the session runs without status,
  and a banner says so.
- **Lowest blast radius.**
  - "Reuse the wired contract, don't mint a new one."
  - "The correct fix is subtractive."
  - "Change WHEN it runs, not HOW."
  - No new IPC channel, signal or debounce when an existing seam carries the meaning.
- **Supported interfaces over scraping.** Read hook payloads. Never parse terminal output, never
  type into the PTY for the operator, never write claude's own files. claude is the authority on
  its own state ("push once, then believe `session_title`").
- **Zero footprint.** Never write into the operator's projects or global config. Never delete
  their entries without being asked. Hooks go through `--settings` in the app's own data folder.
- **Make illegal states impossible to write.** Use discriminated unions, and required-nullable
  parameters so "every call site must decide".
- **Testable placement.** Keep logic out of `src/main/index.ts`. Tests import the shipped module and
  never copy its logic.
- **Use as few dependencies as possible.**
  - Use plain `node:http`, not a framework.
  - Build small in-house primitives (toasts, popovers) instead of a UI kit.
  - Pin any new dependency exactly and turn off its telemetry.
  - No database, and no second native module next to node-pty.
- **Pin to what was tested.** The claude version floor is "the version we tested". Do not bump
  the floor unless a new flag needs it.
- **Clean code that is easy to maintain** was a standing order: "autonomously make sure the code
  plans are clean code and easy to maintain". Use explicit variant components instead of boolean
  mode props (`CompactItem`, not `compact`), following the Vercel composition patterns.
- **Keep versions current, but test the upgrade.** Electron went from 39 to 44 after a test run.
  Upgrade a major version in its own change, with the full gate plus smoke, never in passing.

## 5b. Engineering canon (owner taste + expert research)

**The core finding.** The best engineers disagree a lot about code _style_ (function length, DRY,
test order). They agree strongly about the _harness_ around the code:

- a fast check the agent runs itself;
- small changes;
- untrusted input parsed once into precise types;
- every important rule turned into a test, lint rule or hook.

Agents obey a red check far better than a paragraph. The data adds that agents fail by **volume**:
more code, more near-copies, more swallowed errors, less refactoring. So the rules below are
mostly checks and budgets, not style.

**Grades:**

- **Evidence**: at least one empirical study supports it.
- **Consensus**: most of the experts and vendors agree, but there is no data.
- **Taste**: experts split or say nothing; we chose a side.

**Sensor**: the check that goes red when the rule is broken. "Prose only" means nothing checks it
yet. Prefer turning prose-only rules into sensors.

### Verification

1. **Every change passes the gate the agent runs itself, and the turn cannot end red.** The gate is
   typecheck, lint, test and build, plus `build:dir` + smoke for pty, preload or packaging. Report
   the command and its real output, never just "done". _Evidence_ (DORA, agent-PR CI data, Anthropic
   Stop-hook guidance). Sensor: the PostToolUse and Stop hooks, and `ci.yml`.
2. **Fault-inject every guard. Never use a coverage percentage as a target.** Coverage barely
   predicts whether tests catch faults. Injected faults ("mutants") do track real faults. _Evidence_
   (Inozemtseva & Holmes 2014; Google mutation study 2021). Sensor: the `code-reviewer` Step 2.
3. **Never delete, skip, `.only`, loosen or re-record a test to get green.** Fix the code, or report
   the test's removal as a decision in the commit. Agents are known to "fix" a red test by
   disabling it. A conditional runtime skip with a stated reason (the e2e port guard) is not
   tampering. _Consensus_ (Beck, Huntley). Sensor: `.only` fails Vitest (`allowOnly: false` per
   project) and Playwright (`forbidOnly: true`). Deleting or loosening a test is still prose only.
4. **Review in a fresh context, aimed at correctness and the spec.** Don't chase every finding
   into extra layers: a reviewer told to find gaps always finds some. Code review mostly transfers
   understanding and catches fewer bugs than people think, so it does not replace tests. _Evidence_
   (Bacchelli & Bird 2013) plus Anthropic guidance. Sensor: the `code-reviewer` agent.

### Change size and commits

5. **One task per run, small diffs.** What matters is small, steady steps, more than whether the
   test comes first. Large agent PRs touching many files get rejected more often, and each failed
   CI check cuts merge odds by about 15%. _Evidence_ (Fucci et al. 2017; 33,596 agent PRs, 2026).
   Sensor: prose only.
6. **Keep structural (tidy) commits apart from behaviour commits.** A refactor commit changes no
   behaviour; a feature or fix commit does not reshuffle code. _Consensus_ (Beck). Sensor: prose
   only.
7. **Parallel agents only in separate worktrees, with one writer per build and test gate.** Two
   agents editing one tree break each other's gates. _Taste_ (Hashimoto and Huntley vs
   Steinberger). Sensor: prose only.

### Types and data

8. **Parse each untrusted input once, at one boundary, into a precise type.** After the boundary,
   the type is the proof: no re-validation, no `as` to force a value through. _Consensus_, backed
   by a mechanism: type checking catches about 15% of shipped JS bugs (Gao, Bird & Barr 2017).
   Sensors: `zod-boundaries.md`, strict TS and type-aware lint.
9. **`as` only inside a small, named, tested helper.** 47 `as` casts and 2 non-null `!` sit in
   non-test `src` (AST count, 2026-10-01); don't add more. _Consensus_ (Effective TypeScript). Sensor: a per-file
   budget that only falls (`tests/main/typeAssertions.guard.test.ts`).
10. **Model state as discriminated unions with an exhaustive `never` check.** Use one `status`
    union instead of boolean pairs. Store ids and derive the objects from them. A forgotten case
    then becomes a compile error the agent's own gate reports. _Consensus_ (Minsky, Vanderkam,
    react.dev). Sensors: TS for the unions; ESLint `switch-exhaustiveness-check`.
11. **Never loosen a strict TS flag. Upgrade majors alone.** TS 7.0 shipped without the API that
    typescript-eslint needs (it arrives in 7.1). Stay on 5.x until it does, or the lint gates break.
    _Evidence_ for type checking; _taste_ for the specific flags. Sensor: `tsconfig` plus the gate.

### Design and structure

12. **The enemy is hidden state and entanglement, not long functions.** Split a file or function
    where the pieces would otherwise be tangled together (you'd have to read both to understand
    either), not at a line count. Prefer a few "deep" modules: a small interface over a lot of
    behaviour. _Consensus_ (Ousterhout; Carmack; Hickey). Robert Martin conceded much of this in
    his 2024–25 debate with Ousterhout. Sensor: prose only.
13. **Refactor the biggest, most-changed file first.** Size and relative churn are the
    best-validated predictors of defects. _Evidence_ (Nagappan & Ball 2005). Today that file is
    `src/main/index.ts`: cut from 3,476 to 1,176 lines on 2026-10-01; registrars live in
    `src/main/ipc/`, the per-window feed in `src/main/window/`. Sensor: prose only.
14. **Search for the existing helper before writing one. Add no abstraction without a second real
    caller. Inline a shared helper when it grows a flag or a branch for just one caller.** "Duplication
    is far cheaper than the wrong abstraction" (Metz). Agents have the opposite failure: they paste
    near-copies instead of finding the helper (GitClear 2026: duplicated blocks +81%, refactoring
    down to 3.8% of changes). So both halves are needed. _Consensus_, with weak (vendor) evidence.
    Sensors: the primitive-ban guards (one Button, one Popover…); jscpd in `npm run lint` fails over
    0.5% duplication (0.3% today).
15. **Plain functions and data over classes and inheritance. Explicit over magic. Long, specific
    names.** _Taste_ (Ronacher, Hickey, Carmack). Sensor: prose only. Today there is 1 class in
    non-test `src`.
16. **Enforce the layers.** `shared` never imports `main` or `renderer`; `renderer` never imports
    `main`. _Consensus_ (OpenAI's layered architecture checked by structural tests). The layers are
    Sensor: `tests/main/layers.guard.test.ts` (`shared` and `renderer` also never import electron or
    node-pty).

### Errors and comments

17. **A contained error is logged with a `code=` and never swallowed silently.** A `catch` with only
    a comment must say _why_ it is safe (e.g. "fail open: a false block bricks a working install").
    Error-masking code is where AI-written code is weakest. _Consensus_, with weak (vendor) evidence
    (GitClear +47% error-masking constructs, CodeRabbit). Sensor: `tests/main/catchBlocks.guard.test.ts`
    — 19 comment-only catches in 8 listed files, each with its reason; the list only shrinks; a
    comment under 3 words fails. It sees `try`/`catch` only, not a promise `.catch(() => {})`.
18. **Interface and "why" comments stay next to the code. Never delete a commented constraint or
    incident note without saying so in the commit.** Each agent session starts with no memory, so
    an unwritten "why" is rediscovered or broken. Models are known to change or remove comments
    they don't understand as a side effect. _Consensus_ (Ousterhout won this point against Martin;
    Karpathy). Sensor: prose only. Keep comments short. A comment that a test also pins cannot
    drift silently.

### Instructions for agents

19. **Always-loaded instructions hold only what an agent cannot work out from the code**: traps,
    reasons, and bans tied to incidents. Keep them under about 200 lines, and load layer rules by
    path. Add a line only after an agent repeats a mistake. Repository overviews in context files
    add about 20% cost with no gain, while the instructions themselves are followed well.
    _Evidence_ (ETH Zurich 2026) plus Anthropic and Cursor guidance. Sensor:
    `tests/unit/agentContext.guard.test.ts` (CLAUDE.md ≤ 200 lines; every rule file has `paths:`).
    This file is read on demand, not always loaded, on purpose.

### Stack

20. **React.**
    - Use Effects only to sync with external systems.
    - Derive values during render; never store derived state.
    - Reset state by `key`.
    - Store actions are events, not setters.
    - If the React Compiler is adopted, pin it exactly and keep the existing memoization.

    _Consensus_ (react.dev; TkDodo). Sensor: `eslint-plugin-react-hooks` recommended.

21. **Tests.**
    - Use user-facing queries on real code.
    - Mock only at process edges: pty, fs, Electron.
    - No snapshot tests: an agent re-records them instead of reading the diff.
    - Use Playwright's waiting, web-first assertions.

    The unit / integration / e2e ratio is _taste_; there is no evidence for any pyramid. _Consensus_
    (Testing Library, Playwright docs). Sensor: prose only. There are 0 snapshot tests today.

22. **Electron hardening, from the official checklist.**
    - Validate each IPC sender's frame or URL.
    - Set the Electron fuses at package time (for example, turn off `RunAsNode`).
    - Each preload method wraps one `CH.*` invoke and never leaks the IPC `event`.

    _Consensus_ (Electron security checklist). `sandbox`, `contextIsolation` and a CSP are in place.
    Sensors: every main listener goes through `createRendererIpc` (`ipc/trustedIpc.ts`; a guard
    fails when any main file but `index.ts` imports `ipcMain`); `tests/unit/electronFuses.test.ts`
    pins four fuses. electron-store's own `ipcMain` listener is the one exception (unreachable: no
    `sendSync` in the preload). File-protocol privileges
    are still on (§14).

### Budgets that keep agent decay in check

- **A scheduled clean-up pass.** It changes no behaviour, passes the full gate, and goes in its
  own commits, before each release (`release.md` step 0). It removes duplicates (`jscpd`), dead
  code (`knip`; also red in `npm run lint`) and slow tests. OpenAI calls
  this "garbage collection" against drift. Steinberger spends about 20% of his time on it.
  _Consensus_, with correlational evidence: AI adoption raised complexity by about 41% and
  static-analysis warnings by about 30%, and both stayed high (CMU 2026).
- **Code is an asset here, not throwaway.** The app has versioned, persisted user data, so the
  "code has under a year of shelf life" view (Yegge) does not apply. _Taste_.

## 5c. Where the owner's taste and the evidence pull apart

- **TDD.** The owner runs every subagent with test-first TDD. The evidence says small steps matter
  more than test-first order. **Keep TDD anyway:** a test that failed first proves the agent did
  not claim a pass it never ran. That matters most when no human watches.
- **"Turn every fix into a standard"** vs **"duplication is cheaper than the wrong abstraction".**
  These fit together. The owner's standards are UI primitives with one clear job (one Button, one
  Popover, one Callout). That is knowledge stated once, which even Metz endorses. The Metz rule
  (§5b-14) applies to _helpers_: a shared helper that grows a flag for one caller gets inlined.
- **Big rule files.** The owner's scar-tissue rules (R-numbers, dated incidents) are exactly the
  practice experts recommend. But at about 1,100 always-loaded lines they were past the size the
  vendors say still gets read. The owner already cut them from about 6k to about 2k words on
  10-01. The next step is path-scoping, not deleting.
- **Heavy process** (brainstorm → spec → plan) vs "just talk to it" (Steinberger). For
  **unattended** runs the written spec wins: no human is there to redirect mid-run. Skip the plan
  only for a one-sentence diff.
- **Reviewer model.** §10 says a stronger model reviews, but `code-reviewer` runs on `sonnet`. The
  evidence says a _fresh context_ matters more than model size. Unresolved: the owner's call.

## 6. Data and persistence taste

- Each new domain gets its **own main-owned file** (`claude-watcher-<thing>.json`, the
  `persistedBlob` pattern). It never goes inside the settings blob.
- **Adding a field:** use `.default()` or `.nullable().default(null)` and **keep the version**.
  Bump the version only together with a real migration that is validated after it runs. Patch
  schemas never carry defaults. Stored files strip unknown keys rather than reject them, so a
  downgrade does not wipe a file.
- **Corrupt file:** back it up, start fresh, and say so (`StorageNotice`).
- **Persist view state only when it must survive a restart** (for example, the active workspace).
  Filters and search are not persisted. Exception: `Include global` (settings blob, one value for
  every config list) — the owner asked for it to be remembered and shared.
- **Enum-lock only the values we generate** (flags, colours, delays). Never enum-lock claude's
  outputs (`status`, hook names).
- **Free text or select:** use a select over a closed set when a bad value would silently do
  nothing. Use free text with a charset check when the space is open.

## 7. Security taste

- Security is never weakened to make something work: "fix the consumer, don't loosen the gate".
  Keep `sandbox`, `contextIsolation`, strict TS.
- **The API is a control surface, not a content surface.**
  - Localhost only, off by default, bearer token, no CORS, no LAN.
  - **No caller prose.** The owner's own instinct was "Params would allow injection wouldn't
    they?". Prompts come only from templates the operator wrote, with validated `$1..$n`.
- **Logs:** `code=` plus Zod path only. Never values, names, paths, URLs or a `ZodError`.
- **Every value put into a shell command is quoted**, and a test checks it against a real
  `/bin/sh`.
- No IPC argument ever becomes a spawn cwd. Main resolves paths from its own records.
- Do not take ports used by the operator's other local tools. Each profile has its own ports.

## 8. Theming taste

- **A theme is a full package:** tokens, terminal palette, raw CSS and assets. "If a user wanted a
  poorly colored bad looking UI that's their choice." The app owns the format, the safety, the
  never-crash behaviour and the fail-closed fallback. It does not own the taste.
- A bad theme falls back to Default, **keeps the user's setting**, and Settings shows the error.
- Themes target only public `data-*` hooks and roles. If a hook is missing, add a `data-*`
  attribute to the component. Never target test ids or hashed classes.
- Bundled themes (Liquid Glass, Paper) are read-only, update with the app, and win on an id clash.
- No file watcher, no marketplace, no per-workspace theme, no wallpaper picked from disk.
- New shared UI (lists, dropdowns, toasts) must pick up every theme automatically through the
  standard components: "so the aesthetic of the app is always preserved in each theme".
- **The Liquid Glass look the owner settled on:** smoked, neutral (not blue) glass; panels are
  separate rounded "bubbles" that do not touch the window edge; popovers, menus and toasts get the
  same glass; the text behind a popover must not be readable; subtle, diffused background colour.
- **Terminal:** it reads as a real terminal. Its dark/light scheme is independent of the app
  theme. Light terminals get a contrast floor. Never change claude's own theme to fix readability.

## 9. Feedback taste

The owner said "I hate this feedback, it's so basic … no box? no colors?" and "every action ends
in a visible result".

- **Inside a dialog:** the dialog's one message slot (`Callout`). A dialog never toasts its own
  result.
- **Small action on a control that stays** (Copy, Reload): the button's own `feedback`.
- **Board-level or off-screen result:** a toast.
- Success shows for 2.5 s. An error stays until the next action.
- Every async button uses `useAsyncAction` or `busy`, so pressing twice does nothing.
- A refused change rolls back **and says so**. A silent rollback is a bug.

## 10. Process taste (how to work)

**The flow the owner uses for every feature:**

1. Brainstorm (superpowers).
2. Write the spec to `docs/superpowers/specs/`.
3. Write the plan to `docs/superpowers/plans/`.
4. Run subagent-driven development, with **each subagent using TDD**.
5. Run the gates.
6. Drive the built app and take screenshots.
7. Review.
8. Commit.

Specs and plans are git-ignored. Write them there and never `git add` them.

**Unattended specifics:**

- **Visual choices:** the owner always wanted to _see_ options ("I want actual html design options
  to choose more informed"). Build 2–3 options as HTML mockups, or as screenshots of the built app
  with the CSS change injected. Pick one using §3, and keep the mockups next to the spec so he can
  check the choice later.
- **Visual work is not done until** the gates are green **and** you have looked at drive-run
  screenshots in Default, Liquid Glass and Paper (`.claude/rules/run-app.md`). "Screenshots decide
  the final token values."
- **Plan for parallel work:** "Try to design as many parallel work as possible in the plan."
  Tasks in the same wave run in parallel, each in its own worktree, with one writer per gate
  (§5b-7).
- **Verify, don't trust.**
  - A subagent's "done" is a claim. Re-run the gates and check the working tree.
  - Put the **full** gate list in every subagent prompt.
  - A stronger model reviews: the owner uses a top-tier reviewer to approve fixes, "focusing on
    not adding new issues or restoring already fixed ones".
  - Never touch a test to get green (§5b-3).
- **Fault-inject every guard:** revert it, see a test go red, restore it. "A vacuous test is a
  worse failure mode than a missing test."
- **Turn every fix into a standard.** When you fix a look in one place, make it the shared
  component or token and add a guard test. The owner asked for this many times ("there should be a
  rule for this as well", "those should come from a standard component as well").
- **Update the docs in the same change.** That means `CLAUDE.md`, `design.md` and the rule files.
  Keep them short (they were cut from about 6k to about 2k words on 10-01).
- **Scope fence:** list what is in and out. Put polish and adjacent ideas on `IdeasBoard.md` as
  `pending_review`, never inside the feature. Never implement an IdeasBoard item without first
  validating it with brainstorming.
- **Messy work gets thrown away**, not patched. The `::` text-trigger shortcut work was deleted
  because it "was too messy".
- **Git:**
  - Work on a branch or worktree.
  - Refactor commits and behaviour commits are separate (§5b-6).
  - A commit that removes a commented constraint or incident note says so (§5b-18).
  - Use Conventional Commits. The subject is a lower-case sentence about what the operator sees,
    often stating the rule ("a workspace is a light tint, not a dot").
  - The body gives the symptom, the measured root cause, a "Fault-injected: …" line and the gate
    results.
  - Merge to local `main` only if your run says so. **Never push, tag or publish.** Releases are a
    tag → CI → draft that the owner publishes by hand.
- **Profiles:** dev and drive use their own ports and userData. Never ask the operator to close
  the installed app.
- **Public repo:** no home paths, no work email, no employer or internal names anywhere, including
  commit messages and test fixtures. Use `acme/prod`-style examples.

## 11. Default answers

| Question                                | Answer                                                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New config surface?                     | `ManageDialog`: rail \| right column, placeholder when nothing is open, `+ New` at the bottom of the rail                                                       |
| Settings-like surface?                  | Categories as rail rows, opens on the first, saves on change, no Save button                                                                                    |
| Global or per-workspace?                | Items: `workspaceId \| null`; a workspace view lists its own rows + global (Include global, remembered), every row marked. App settings: global. Alerts: global |
| Setting or hard-code?                   | Felt by the operator → setting with a fixed list, recommended default, `Off` as an option. Internal → hard-code                                                 |
| Confirm dialog?                         | Reversible → no. Destructive → arm in place (`Delete` → `Confirm delete`)                                                                                       |
| A control the user can't use now?       | Do not render it (only exception: disabled reorder arrows)                                                                                                      |
| Menu, dropdown or list popup?           | `Popover` parts. `Select` for value pickers                                                                                                                     |
| Spacing?                                | A role token by job. Never `--space-N` or px                                                                                                                    |
| Colour?                                 | An existing token. Otherwise a new documented, themeable token                                                                                                  |
| Show a workspace?                       | Tint plus name (`WorkspaceLabel`). Never a dot                                                                                                                  |
| Show status?                            | Dot plus text label, fixed colours                                                                                                                              |
| Need feedback?                          | §9                                                                                                                                                              |
| Async button?                           | `useAsyncAction` / `busy`                                                                                                                                       |
| Error copy?                             | Map a code to a plain sentence                                                                                                                                  |
| Bad config or input?                    | Fail closed to a safe default, keep the user's setting, show it in the UI, log code + path                                                                      |
| Optimistic update?                      | Only as view-state that expires when main answers. Revert and toast on failure                                                                                  |
| Library or build it?                    | Build a small primitive. No UI kit                                                                                                                              |
| New key binding?                        | Avoid. Never global. Never steal a key from claude's terminal                                                                                                   |
| Background event takes focus?           | Never                                                                                                                                                           |
| Auto-submit into claude?                | Never                                                                                                                                                           |
| File watcher or live reload?            | No. Rescan on open, plus a Reload button                                                                                                                        |
| Per-workspace or per-terminal override? | Out of scope. One global choice                                                                                                                                 |
| Light-theme support?                    | Yes, with tested contrast floors                                                                                                                                |
| New status or state?                    | No. Use tags and rules                                                                                                                                          |
| Feature naming?                         | A name that can't be confused with an existing field ("workspace", not "project"). New code says `claude-watcher`                                               |
| Cross-platform?                         | Write it portable (`$SHELL`, POSIX). Gate Linux-only paths. Linux ships first; macOS and Windows later, unsigned at first                                       |
| Orphaned reference?                     | Keep it, hide it or label it, and make it fixable. Never drop it silently                                                                                       |
| Bigger scope?                           | Ship the thin version. Put the rest on IdeasBoard                                                                                                               |
| New helper or abstraction?              | Search for an existing one first. Only with a second real caller. Inline it when it grows a one-caller flag                                                     |
| Split a file or function?               | Where the pieces are tangled together, not at a line count                                                                                                      |
| Need `as`?                              | Parse with Zod instead. If you must, inside a small named, tested helper                                                                                        |
| A state with variants?                  | A discriminated union with an exhaustive `never` check. No boolean pairs                                                                                        |
| A test is red?                          | Fix the code. Never skip, delete, `.only`, loosen or re-record it to get green                                                                                  |
| Mock or real?                           | Real code. Mock only at process edges (pty, fs, Electron)                                                                                                       |
| Snapshot test?                          | No                                                                                                                                                              |
| Coverage target?                        | No. Fault-inject the guards instead                                                                                                                             |
| A `catch` with nothing in it?           | Log a `code=`, or comment why swallowing is safe                                                                                                                |
| Add a line to CLAUDE.md or a rule file? | Only after an agent repeated a mistake, and only what the code can't tell. Prefer a sensor                                                                      |
| Rewrite or refactor?                    | Refactor in small steps behind green gates. Rewrite only a local wrong abstraction                                                                              |

## 12. Reversals: old → current (do not revive the old side)

| Old                                                                                                 | Current                                                                                             | Why                                                                               |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| External c9watch CLI polling                                                                        | Native hook engine, `--session-id` minted at spawn                                                  | Deterministic truth, one fewer dependency                                         |
| Hooks written into `~/.claude/settings.json`, then into project `.claude/settings.local.json`       | A `--settings` file in userData, only while the port is bound                                       | Zero footprint                                                                    |
| Unknown hook id creates a card                                                                      | Ignored (`hook_unknown_id`)                                                                         | Never synthesize truth                                                            |
| Adaptive centre hero with swap animation                                                            | Fixed grid, Needs-you in the middle                                                                 | Calm, stable layout                                                               |
| App never raises its window                                                                         | A notification click raises the window and opens the session. A session event still never raises it | The operator asked for it explicitly                                              |
| Ctrl+W stops, then archives                                                                         | No key archives. claude keeps every key                                                             | Keys belong to the terminal                                                       |
| Shortcuts: Ctrl+Shift chords → Ctrl+Alt chord sequences → `::` text triggers (deleted, "too messy") | Alias expander box (`Ctrl+Alt+X`, `$1..$9`, quoting)                                                | OS-safe, any length, variables                                                    |
| Background shell at turn end → "your turn"                                                          | Back to Working (2.3.1)                                                                             | The owner lived with it and reverted it                                           |
| WebGL off (GPU faults)                                                                              | WebGL on, with context-loss recovery                                                                | Hardware fixed; the smoke test requires it                                        |
| Workspace dot                                                                                       | Light tint of the whole control                                                                     | A dot reads as status                                                             |
| Each dialog with its own layout; Settings one long column; Shortcuts as a table                     | One `ManageDialog` list \| form, categories for Settings                                            | One standard                                                                      |
| Blank New form when the dialog opens                                                                | Placeholder sentence                                                                                | "is this a record or a create?"                                                   |
| Bare red or neutral text feedback, no success colour                                                | `Callout` box, green `--success`                                                                    | "no box? no colors?"                                                              |
| Strict scope filter both ways                                                                       | `Include global` (opt-in, remembered, shared) with a where-it-lives marker on every row             | The operator wants to see what applies to them                                    |
| Current page as a quieter mark (2px bar, no fill)                                                   | The same selected look as a Settings category                                                       | One selected look; the owner: "it should be the same as in the app settings page" |
| Settings "Saved" for 1.5 s                                                                          | Compact Callout for 2.5 s                                                                           | Too short to read                                                                 |
| Hand-made popovers                                                                                  | `Popover` standard                                                                                  | Theme consistency                                                                 |
| Spacing tuned per component                                                                         | Role tokens plus a guard test                                                                       | "doesn't look like a real app"                                                    |
| 2px lavender focus ring                                                                             | 1px soft neutral                                                                                    | The owner found it too strong                                                     |
| Manage footer scrolls with the form                                                                 | Sticky footer                                                                                       | Save is always visible                                                            |
| Board filter as a header button labelled "FILTERS"                                                  | A filter bar under the header, `Filter` word plus icon, lit when on. Header has one ☰ menu         | Clear and polished                                                                |
| Shell pane inside claude's frame                                                                    | A separate panel; the 12px gap is the divider                                                       | It "read as one terminal"                                                         |
| Native `showErrorBox` for launch refusals                                                           | Error line on the name prompt                                                                       | No native popups                                                                  |
| API create takes the view                                                                           | Registry only, never focus                                                                          | Don't steal focus                                                                 |
| API port 9280                                                                                       | 9281                                                                                                | 9280 belongs to another tool the operator uses daily                              |
| "Single machine, not distributable"                                                                 | Public deb/rpm/pacman via CI draft releases, MIT, no auto-update                                    | Public release                                                                    |
| Liquid Glass: white 3% fill, noise, blue-grey                                                       | Smoked, neutral glass, bubbles, wallpapers darkened in the file                                     | Readability, less noise                                                           |
| June "no pills, no glows, no gradients" for all                                                     | Still true for Default only. Themes may break it                                                    | The theme author owns taste                                                       |
| Electron 39 ("don't upgrade")                                                                       | Electron 44 after a tested upgrade                                                                  | Stay current, but test                                                            |
| "Leave work uncommitted for review" (June)                                                          | Commit on the branch; merge locally when told                                                       | The owner's later workflow                                                        |

## 13. Rejected — don't propose these again

- Guessing status: LLM classification, PTY screen-scraping, text heuristics that decide truth.
  Heuristics may only _raise_ urgency.
- More statuses or custom statuses (use tags and rules). A drag-and-drop kanban. Hiding empty
  columns.
- OS-global hotkeys, app self-raise on session events, hide-to-tray, KWin or Konsole focus tricks.
- Auto-submit (`\r`), `term.paste()`, echo-then-backspace expansion.
- Free-text prompts from API callers. LAN binding. CORS. Swagger saving the token.
- A workspace-level default template (template ordering belongs to a future favourites feature).
- An "All workspaces" board. Auto-assigning a workspace by folder.
- Coloured dots for identity. Empty New forms. A second create button. A dialog toasting its own
  result. A toast library or UI kit.
- `alert` / `confirm` / native select / native error boxes. Bare red text. Hex in components. Raw
  spacing. `className` on shared primitives. Boolean mode props.
- Disabled-but-rendered controls (e.g. broken themes as greyed dropdown rows).
- Silent failures: an unhandled rejection, an error only in the console, a silent rollback,
  silently withholding a feature, resetting the user's choice on failure.
- A file version bump without a migration. Storing a new domain inside the settings blob. Writing
  into operator projects or claude's files.
- File watchers, a theme marketplace, wallpapers from disk, darken sliders.
- Changing claude's own theme. Weakening a contrast threshold.
- Building releases on the dev host, `ubuntu-latest`, auto-publish, auto-update.
- Bundling polish into a feature. Restyling working code outside the scope.
- Coverage percentages as a target. Snapshot tests. Skipping or deleting tests to get green.
- Line-count limits on functions ("functions must be under N lines"). Generic helpers for one
  caller. "WET everywhere" (no top engineer endorses it).
- Generated repository overviews in CLAUDE.md or rule files.
- Big-bang rewrites.
- Upgrading to TypeScript 7.0 before typescript-eslint supports it (7.1 API).

## 14. Known gaps between rules and code

When you find a gap, the newer side wins (check `git log`): fix the stale side in the same change,
and note it here only if you cannot fix it. The eight gaps found on 2026-10-01 were closed the same
day (spec `2026-10-01-engineering-gaps-design.md`). What is left:

| Gap                                                                                                                            | Rule       |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `grantFileProtocolExtraPrivileges` fuse still on: the packaged renderer loads from `file://`; turning it off needs a test pass | §5b-22     |
| 47 `as` casts and 19 comment-only catches remain (budgeted; they only fall)                                                    | §5b-9, 17  |
| Deleting or loosening a test to get green is still prose only (`.only` is caught)                                              | §5b-3      |
| `src/main/index.ts` is still the largest main file (1,176 lines); go lower in a later pass                                     | §5b-12, 13 |

## 15. Keep this file current

When a decision changes something here, change this file in the same commit. Replace the rule,
then add one row to §12. Later wins.
