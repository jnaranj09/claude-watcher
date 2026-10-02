# Technical taste — claude-watcher

This file is for AI agents that design and build this app **unattended**. It tells you how the
owner decides, so you can decide the same way without asking him.

Built 2026-10-01 from: 505 commits (2026-06-18 → 10-01), 23 design specs and their plans, the June
planning docs, stories and retros, a bug-hunt report, and about 550 messages the owner typed in
build sessions. **Later decisions win.** Where an old decision was reversed, only the new one is
written here as a rule. The reversal log (§12) exists so you do not bring an old idea back.

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
5. **Write the choice down.** In the spec, tag it `[AGENT]` (the owner's picks are `[OPERATOR]`)
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
  `workspaceId | null`, where null means global. Filters are strict both ways. Nothing is merged or
  overridden.
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

## 6. Data and persistence taste

- Each new domain gets its **own main-owned file** (`claude-watcher-<thing>.json`, the
  `persistedBlob` pattern). It never goes inside the settings blob.
- **Adding a field:** use `.default()` or `.nullable().default(null)` and **keep the version**.
  Bump the version only together with a real migration that is validated after it runs. Patch
  schemas never carry defaults. Stored files strip unknown keys rather than reject them, so a
  downgrade does not wipe a file.
- **Corrupt file:** back it up, start fresh, and say so (`StorageNotice`).
- **Persist view state only when it must survive a restart** (for example, the active workspace).
  Filters and search are not persisted.
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
  Tasks in the same wave run in parallel.
- **Verify, don't trust.**
  - A subagent's "done" is a claim. Re-run the gates and check the working tree.
  - Put the **full** gate list in every subagent prompt.
  - A stronger model reviews: the owner uses a top-tier reviewer to approve fixes, "focusing on
    not adding new issues or restoring already fixed ones".
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

| Question                                | Answer                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| New config surface?                     | `ManageDialog`: rail \| right column, placeholder when nothing is open, `+ New` at the bottom of the rail                 |
| Settings-like surface?                  | Categories as rail rows, opens on the first, saves on change, no Save button                                              |
| Global or per-workspace?                | Items: `workspaceId \| null` with strict filter. App settings: global. Alerts: global                                     |
| Setting or hard-code?                   | Felt by the operator → setting with a fixed list, recommended default, `Off` as an option. Internal → hard-code           |
| Confirm dialog?                         | Reversible → no. Destructive → arm in place (`Delete` → `Confirm delete`)                                                 |
| A control the user can't use now?       | Do not render it (only exception: disabled reorder arrows)                                                                |
| Menu, dropdown or list popup?           | `Popover` parts. `Select` for value pickers                                                                               |
| Spacing?                                | A role token by job. Never `--space-N` or px                                                                              |
| Colour?                                 | An existing token. Otherwise a new documented, themeable token                                                            |
| Show a workspace?                       | Tint plus name (`WorkspaceLabel`). Never a dot                                                                            |
| Show status?                            | Dot plus text label, fixed colours                                                                                        |
| Need feedback?                          | §9                                                                                                                        |
| Async button?                           | `useAsyncAction` / `busy`                                                                                                 |
| Error copy?                             | Map a code to a plain sentence                                                                                            |
| Bad config or input?                    | Fail closed to a safe default, keep the user's setting, show it in the UI, log code + path                                |
| Optimistic update?                      | Only as view-state that expires when main answers. Revert and toast on failure                                            |
| Library or build it?                    | Build a small primitive. No UI kit                                                                                        |
| New key binding?                        | Avoid. Never global. Never steal a key from claude's terminal                                                             |
| Background event takes focus?           | Never                                                                                                                     |
| Auto-submit into claude?                | Never                                                                                                                     |
| File watcher or live reload?            | No. Rescan on open, plus a Reload button                                                                                  |
| Per-workspace or per-terminal override? | Out of scope. One global choice                                                                                           |
| Light-theme support?                    | Yes, with tested contrast floors                                                                                          |
| New status or state?                    | No. Use tags and rules                                                                                                    |
| Feature naming?                         | A name that can't be confused with an existing field ("workspace", not "project"). New code says `claude-watcher`         |
| Cross-platform?                         | Write it portable (`$SHELL`, POSIX). Gate Linux-only paths. Linux ships first; macOS and Windows later, unsigned at first |
| Orphaned reference?                     | Keep it, hide it or label it, and make it fixable. Never drop it silently                                                 |
| Bigger scope?                           | Ship the thin version. Put the rest on IdeasBoard                                                                         |

## 12. Reversals: old → current (do not revive the old side)

| Old                                                                                                 | Current                                                                                             | Why                                                  |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| External c9watch CLI polling                                                                        | Native hook engine, `--session-id` minted at spawn                                                  | Deterministic truth, one fewer dependency            |
| Hooks written into `~/.claude/settings.json`, then into project `.claude/settings.local.json`       | A `--settings` file in userData, only while the port is bound                                       | Zero footprint                                       |
| Unknown hook id creates a card                                                                      | Ignored (`hook_unknown_id`)                                                                         | Never synthesize truth                               |
| Adaptive centre hero with swap animation                                                            | Fixed grid, Needs-you in the middle                                                                 | Calm, stable layout                                  |
| App never raises its window                                                                         | A notification click raises the window and opens the session. A session event still never raises it | The operator asked for it explicitly                 |
| Ctrl+W stops, then archives                                                                         | No key archives. claude keeps every key                                                             | Keys belong to the terminal                          |
| Shortcuts: Ctrl+Shift chords → Ctrl+Alt chord sequences → `::` text triggers (deleted, "too messy") | Alias expander box (`Ctrl+Alt+X`, `$1..$9`, quoting)                                                | OS-safe, any length, variables                       |
| Background shell at turn end → "your turn"                                                          | Back to Working (2.3.1)                                                                             | The owner lived with it and reverted it              |
| WebGL off (GPU faults)                                                                              | WebGL on, with context-loss recovery                                                                | Hardware fixed; the smoke test requires it           |
| Workspace dot                                                                                       | Light tint of the whole control                                                                     | A dot reads as status                                |
| Each dialog with its own layout; Settings one long column; Shortcuts as a table                     | One `ManageDialog` list \| form, categories for Settings                                            | One standard                                         |
| Blank New form when the dialog opens                                                                | Placeholder sentence                                                                                | "is this a record or a create?"                      |
| Bare red or neutral text feedback, no success colour                                                | `Callout` box, green `--success`                                                                    | "no box? no colors?"                                 |
| Settings "Saved" for 1.5 s                                                                          | Compact Callout for 2.5 s                                                                           | Too short to read                                    |
| Hand-made popovers                                                                                  | `Popover` standard                                                                                  | Theme consistency                                    |
| Spacing tuned per component                                                                         | Role tokens plus a guard test                                                                       | "doesn't look like a real app"                       |
| 2px lavender focus ring                                                                             | 1px soft neutral                                                                                    | The owner found it too strong                        |
| Manage footer scrolls with the form                                                                 | Sticky footer                                                                                       | Save is always visible                               |
| Board filter as a header button labelled "FILTERS"                                                  | A filter bar under the header, `Filter` word plus icon, lit when on. Header has one ☰ menu         | Clear and polished                                   |
| Shell pane inside claude's frame                                                                    | A separate panel; the 12px gap is the divider                                                       | It "read as one terminal"                            |
| Native `showErrorBox` for launch refusals                                                           | Error line on the name prompt                                                                       | No native popups                                     |
| API create takes the view                                                                           | Registry only, never focus                                                                          | Don't steal focus                                    |
| API port 9280                                                                                       | 9281                                                                                                | 9280 belongs to another tool the operator uses daily |
| "Single machine, not distributable"                                                                 | Public deb/rpm/pacman via CI draft releases, MIT, no auto-update                                    | Public release                                       |
| Liquid Glass: white 3% fill, noise, blue-grey                                                       | Smoked, neutral glass, bubbles, wallpapers darkened in the file                                     | Readability, less noise                              |
| June "no pills, no glows, no gradients" for all                                                     | Still true for Default only. Themes may break it                                                    | The theme author owns taste                          |
| Electron 39 ("don't upgrade")                                                                       | Electron 44 after a tested upgrade                                                                  | Stay current, but test                               |
| "Leave work uncommitted for review" (June)                                                          | Commit on the branch; merge locally when told                                                       | The owner's later workflow                           |

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

## 14. Known gaps between docs and code

None known (last checked 2026-10-01). When you find one, the newer side wins (check `git log`):
fix the stale side in the same change, and note it here only if you cannot fix it.

## 15. Keep this file current

When a decision changes something here, change this file in the same commit. Replace the rule,
then add one row to §12. Later wins.
