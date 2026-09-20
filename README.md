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

If a session is still blocked on a permission prompt or a question, it is reminded — by
default three more times, at +2, +6 and +14 minutes (each gap doubles), each with the
attention sound when sound is on. The reminders stop as soon as the session is no longer
blocked. `Your turn` gets no reminders: nothing is stuck. Settings → **Reminders** sets how
many (Off, 1–5) and **First reminder after** sets the first gap (1, 2, 5, 10 or 15 min).

## Session templates

A template is a saved bundle of **folder + model + permission mode + thinking effort** under
a name. `+ New session` (the header button and the empty board's) opens a menu:
`Pick a folder…` (the plain flow), a searchable list of your templates, and
`Manage templates…`. Picking a template asks only for the session name, then launches
`claude` in that folder with `--model` / `--permission-mode` / `--effort` from the template
(each is omitted when set to _Default_, which leaves the choice to claude). Templates live in
`claude-watcher-templates.json` under the app's data dir; a corrupt file is backed up
as `*.corrupt-<timestamp>.json` and the list starts empty. Templates saved before the effort
field existed load unchanged, with effort left on _Default_.

## Phrase shortcuts

Map a chord to a phrase and type it into the focused session with one keypress — handy for the
lines you repeat all day ("I explicitly approve", "continue", "run the tests and report back").

Open the `⌨` button in the header to manage them: **Name**, **Keybinding**, **Phrase**.

- **Chords are `Ctrl+Alt+<letter>`, and a binding can be up to three of them** — press
  `Ctrl+Alt+O` then `Ctrl+Alt+A` for one phrase, `Ctrl+Alt+O` on its own for another.
- **All 26 letters are available.** Nothing is reserved: the app's own `Ctrl+N` / `Ctrl+Q` /
  `Ctrl+W` ignore Alt, and the Electron and Chromium defaults (DevTools, reload) live on
  `Ctrl+Shift`, not `Ctrl+Alt`.
- **A chord that starts a longer sequence waits 750 ms** for its continuation, then types its own
  phrase if it has one. While it waits, the pending chords show in the terminal's bottom-right
  corner. A shortcut that is not the start of a longer one fires instantly, with no delay. `Esc`
  cancels a half-typed sequence without typing anything.
- **A chord you have not bound is passed straight through to the session**, so `claude` still
  receives it as `Esc` + the control byte. The trade-off: a bound letter takes that key away from
  whatever runs in that terminal — in a plain shell, bash's readline uses `Ctrl+Alt+` `B D E F G
H I L R T Y`.
- Your desktop wins first: if KDE has already grabbed a chord (`Ctrl+Alt+Del` and friends), the
  app never sees it and the recorder cannot record it.
- **The phrase is typed, not sent.** You press `Enter` yourself, so a shortcut can never confirm
  a permission prompt you did not read. Phrases cannot contain newlines or escape sequences.
- Shortcuts fire **only while a session terminal is focused** — never on the board, and never
  system-wide.

They live in `claude-watcher-shortcuts.json` in the app's data directory. If that file is ever
corrupt — or was written by an older build — it is backed up beside itself and the list starts
empty; nothing else is affected.

## Workspaces

A workspace scopes the board to one slice of your work — separate a client's sessions from your
own tooling, or keep a deploy workspace apart from day-to-day dev. Every session belongs to
exactly one workspace, set at launch to whichever workspace is active; the board only ever shows
the active workspace's cards, and switching workspaces does not stop or disconnect anything —
kept-alive terminals stay connected in the background and reappear with their scrollback intact
the moment you switch back.

**Alerts stay global; only the cards are scoped.** A needs-you session in another workspace still
fires its desktop notification and counts toward the tray badge — the workspace switcher in the
header also badges itself with how many sessions need you elsewhere, so you never lose track of a
session just because you switched away from it.

Every install starts with a **Default** workspace, which cannot be deleted. Add more from
**Manage workspaces…** in the header switcher: a name, a color, and an optional default folder for
its `+ New session → Pick a folder…` picker. **A workspace with any running session — in any open
window — cannot be deleted**; the dialog tells you to stop or move the sessions first. Deleting an
allowed (empty) workspace also deletes every template and shortcut scoped to it.

Move an existing session to another workspace from its card's move affordance, without stopping
it.

**Templates and shortcuts can be scoped too.** Each row in the Manage dialogs has a **Workspace**
field: **Global** (the default — visible and usable from every workspace) or one specific
workspace (visible and usable only there). Deleting a workspace from the app takes its scoped
rows with it, as above. If a workspace disappears some other way — a hand-edited settings file,
say — the rows that named it aren't lost: they stop appearing in the `+ New session` popover and
the shortcut list everywhere, and show up in their Manage dialog under a **(no workspace)** group
so you can re-scope or remove them.

## Themes

The whole look — every colour, radius, font and spacing token, the terminal palette, and anything a
stylesheet can do on top — is a **theme package**: one folder in `~/.config/claude-watcher/themes/`
(the app's data folder) holding a `theme.json`, an optional CSS file and the images or fonts that
CSS uses. Pick it in **☰ → Settings… → Theme**. **Reload themes** re-reads the folder; **Open themes
folder** opens it in your file manager. Light themes are a package with `"colorScheme": "light"`.

A broken package is never applied and never crashes the app: it is listed under the picker with the
reason, and if it was the chosen one the app falls back to Default and keeps your choice so you can
fix the file and reload. The package format, every token, the load rules and three example themes
(the built-in look, a liquid-glass look, a light `paper` theme) are in
[`docs/themes/THEMES.md`](docs/themes/THEMES.md); `docs/themes/theme.schema.json` gives your editor
autocomplete for `theme.json`.

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
