# c9scaffold

An Electron application with React and TypeScript

## How the board knows it needs you

Every card state comes from Claude Code's own structured output — its lifecycle
hooks, plus its session transcript for the two things the hooks never report (an Esc
interrupt, and a background task finishing). No polling, no screen scraping, no
guessing.

| Card state       | It means                                  | Enters on                                                            | Leaves on                            |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| Connecting       | the app spawned claude, not yet reporting | app-launch                                                           | `SessionStart` (→ Idle)              |
| Working          | Claude's turn                             | you submit a prompt / a tool runs / background work is still running | next event                           |
| Needs permission | Claude is blocked on an approval          | the permission prompt                                                | you approve or deny                  |
| Asking you       | Claude asked you a question               | the AskUserQuestion tool, or a turn ending in a question             | you reply — viewing is not answering |
| Your turn        | Claude finished; the prompt is waiting    | any finished turn with nothing left running                          | you reply, or you view the session   |
| Idle             | nothing to do here                        | a fresh session, a finished turn you looked at, or you pressed Esc   | you submit a prompt                  |

Four honest footnotes:

- "A turn ending in a question" is the one text heuristic in the app — and it only
  picks the FLAVOR of attention (question vs. plain your-turn). A missed question
  still shows as **Your turn**. Heuristics never decide WHETHER you're told; only
  how loudly.
- Sessions launched by the app get one extra system-prompt line asking Claude to
  use its question tool (or end questions with `?`). It applies ONLY to sessions
  this app launches — it never touches your settings files or other sessions.
- **Background work keeps a card on Working, and the app knows exactly when it ends.**
  When Claude backgrounds a shell or arms a monitor, its turn ends but the work keeps
  running and Claude will wake itself up. Claude Code has no "task finished" hook — but the
  tool hands back a **task id** when the work starts, and Claude writes that same id into
  its own session transcript when the work finishes. The app reads both, so it tracks the
  set of tasks actually running rather than counting turns and hoping. While that set is
  non-empty every turn end shows **Working** and fires no notification; when the last task
  reports done, the next turn end is an honest **Your turn**. The safety net: work older
  than the window set in Settings ("Background work gives up after", 10 minutes by
  default) stops counting, so a hung task can never leave a card claiming to work forever.
  A question always wins: a turn ending in a question is **Asking you**, background or not.
- **Esc drops the card to Idle immediately.** Interrupting Claude emits no hook at all —
  not `Stop`, not a notification, nothing, not even after 90 seconds. Without help the card
  would keep saying Working until you next used the session. Claude does record the
  interrupt in its own transcript the instant it happens, so the app watches for that and
  demotes the card in well under a second (measured end to end: **85ms**). No notification
  fires — you pressed the key, so you are already there.

The desktop notification fires once on the entry edge into attention, and its title
says which of those states you landed in — `webapp · your turn`,
`webapp asked a question`, `webapp wants permission` — never the column name. The
body is the project path plus the pending tool, verbatim.

## Session templates

A template is a saved trio of **folder + model + permission mode** under a name.
`+ New session` (the header button and the empty board's) opens a menu: `Pick a folder…`
(the plain flow), a searchable list of your templates, and `Manage templates…`. Picking a template asks only for the session
name, then launches `claude` in that folder with `--model` / `--permission-mode` from
the template (each is omitted when set to _Default_). Templates live in
`claude-watcher-templates.json` under the app's data dir; a corrupt file is backed up
as `*.corrupt-<timestamp>.json` and the list starts empty.

## Phrase shortcuts

Map a chord to a phrase and type it into the focused session with one keypress — handy for the
lines you repeat all day ("I explicitly approve", "continue", "run the tests and report back").

Open the `⌨` button in the header to manage them: **Name**, **Keybinding**, **Phrase**.

- **Chords are `Ctrl+Shift+<letter>`.** That range is safe to take: a terminal cannot send
  `Ctrl+Shift+A` distinctly from `Ctrl+A`, so `claude` never binds it and the shortcut costs the
  agent nothing.
- **`N`, `Q`, `W`, `I`, `J`, `C` and `R` are reserved** — the app (new session / quit / stop) and
  the Electron and Chromium defaults (DevTools, reload) already answer to them.
- **The phrase is typed, not sent.** You press `Enter` yourself, so a shortcut can never confirm
  a permission prompt you did not read. Phrases cannot contain newlines or escape sequences.
- Shortcuts fire **only while a session terminal is focused** — never on the board, and never
  system-wide.

They live in `claude-watcher-shortcuts.json` in the app's data directory. If that file is ever
corrupt it is backed up beside itself and the list starts empty; nothing else is affected.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
