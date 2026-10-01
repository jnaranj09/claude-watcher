# claude-watcher

A KDE-first desktop app that watches your local `claude` sessions on a board and embeds a live
terminal for each one.

Sessions the app launches get a card; sessions you start in some other terminal stay off the
board. Only one copy of the app runs at a time — starting it again raises the window that is
already open. If the app cannot receive claude's status updates (another program holds its port,
say), a banner under the header says so, and new sessions run without status until it is fixed.

## Install

Download the package for your distro from the
[latest release](https://github.com/jnaranj09/claude-watcher/releases/latest), then:

```bash
# Debian / Ubuntu
sudo apt install ./claude-watcher-<version>-amd64.deb
# Fedora / openSUSE / RHEL
sudo dnf install ./claude-watcher-<version>-x86_64.rpm
# Arch / CachyOS
sudo pacman -U ./claude-watcher-<version>-x64.pacman
```

Check the download with `sha256sum -c SHA256SUMS --ignore-missing`.

Requires `claude` 2.1.245 or newer on your `PATH` (the app checks it at every launch).
macOS and Windows builds are planned.

## How the board knows it needs you

Every card state comes from Claude Code's own structured output — its lifecycle
hooks, plus its session transcript for the one thing the hooks never report (an Esc
interrupt). No polling, no screen scraping, no guessing.

| Card state       | It means                                               | Enters on                                                                  | Leaves on                                                                     |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Connecting       | the app spawned claude, not yet reporting              | app-launch                                                                 | `SessionStart` (→ Idle)                                                       |
| Working          | Claude's turn, or its background work is still running | you submit a prompt / a tool runs / a turn ends with a shell still running | next event                                                                    |
| Needs permission | Claude is blocked on an approval                       | the permission prompt                                                      | you approve or deny (`Enter`, `1` or `2` in its terminal moves it to Working) |
| Asking you       | Claude asked you a question                            | the AskUserQuestion tool, or a turn ending in a question                   | you reply — viewing is not answering                                          |
| Your turn        | Claude finished; the prompt is waiting                 | any finished turn                                                          | you reply, you view the session, or you press Esc                             |
| Idle             | nothing to do here                                     | a fresh session, a finished turn you looked at, or you pressed Esc         | you submit a prompt                                                           |

Four honest footnotes:

- "A turn ending in a question" is the one text heuristic in the app — and it only
  picks the FLAVOR of attention (question vs. plain your-turn). A missed question
  still shows as **Your turn**. Heuristics never decide WHETHER you're told; only
  how loudly.
- Sessions launched by the app get one extra system-prompt line asking Claude to
  use its question tool (or end questions with `?`). It applies ONLY to sessions
  this app launches — it never touches your settings files or other sessions.
- **Background work keeps the card on Working.** When Claude backgrounds a shell or arms a
  monitor, its turn ends but the work keeps running. Claude Code reports that running work on
  the turn-end hook itself, so the card stays on **Working**, the same thing the terminal says
  ("1 shell still running"), and nothing pops up. When the work finishes, Claude wakes up on its
  own and that turn moves the card again; if it then finishes or asks you something, you are told
  then. Work that never ends (a dev server) keeps the card on Working — press Esc to drop it to
  Idle. A question always wins: a turn ending in a question is **Asking you**, background or not.
- **Esc drops the card to Idle immediately.** Interrupting Claude emits no hook at all —
  not `Stop`, not a notification, nothing, not even after 90 seconds. Without help the card
  would keep saying Working until you next used the session. Claude does record the
  interrupt in its own transcript the instant it happens, so the app watches for that and
  demotes the card in well under a second (measured end to end: **85ms**). Esc always drops
  to Idle, background work or not. No notification fires — you pressed the key, so you are
  already there.

The desktop notification fires once on the entry edge into attention, and its title
says which of those states you landed in — `webapp · your turn`,
`webapp asked a question`, `webapp wants permission` — never the column name. The
body is the project path plus the pending tool, verbatim. **Clicking it raises the window,
switches to the session's workspace and opens the session.** A session event on its own
never raises the window.

The session you are looking at — the window is focused and its terminal is on screen — gets no
popup, no sound and no reminder: you are already there. Settings → **Desktop notifications**
turns the popups off everywhere; the sound has its own **Attention sound** switch.

If a session is still blocked on a permission prompt or a question, it is reminded — by
default three more times, at +2, +6 and +14 minutes (each gap doubles), each with the
attention sound when sound is on. The reminders stop as soon as the session is no longer
blocked. `Your turn` gets no reminders: nothing is stuck. Settings → **Reminders** sets how
many (Off, 1–5) and **First reminder after** sets the first gap (1, 2, 5, 10 or 15 min).

## Keys

Claude keeps every key you type into its terminal — `Ctrl+R`, `Ctrl+W`, `Esc` and the rest reach
claude, and the app has no menu bar to eat one. The app's own keys work only when focus is
**outside** the terminal (on the board, the header, a card):

- `Esc` — back to the board
- `Ctrl+N` — new session
- `Ctrl+Q` — quit (asks first while sessions are running)

No key archives or deletes a session; that is always a button.

## Ending a session, and Past sessions

Every card, and the bar above a focused session, carries two buttons:

- **Archive** — stops the session and keeps it in **Past sessions**. No confirm: it is
  reversible.
- **Delete** — asks first, then stops the session and keeps nothing. Claude's own files are
  never touched.

A session that ends any other way — `/exit`, `Ctrl+C` twice, claude exiting, quitting the app,
closing the window — is archived too. A session is also on record while it runs, so even a crash
or a power loss leaves it in Past sessions.

**☰ → Past sessions…** lists them (it keeps the 200 most recent). **Open** brings one back as a
live card with `claude --resume`, under the same id; **Forget** removes it from the list. Open is
refused, with a line saying why, when the folder is gone, when claude no longer has the
conversation, or when that conversation is running in another terminal outside the app.

When claude exits inside an open terminal, the pane says how it exited (the exit code or signal)
and offers **Resume conversation**, which replaces the dead pane with the resumed session.

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

Type the lines you repeat all day ("I explicitly approve", "continue", "run the tests and report
back") by a short alias instead.

1. In a session's terminal, press **`Ctrl+Alt+X`**. A small box opens over the terminal.
2. Type an alias and its values — `ht 1234` — and press `Enter`.
3. The phrase is typed into the terminal. **It is never sent**: you press `Enter` yourself, so a
   shortcut can never confirm a permission prompt you did not read.

A phrase can take values: `$1` … `$9` by position, `$*` for every value not taken by a number,
and `$$` for a literal `$`. A value can hold spaces when you quote it (`"…"` or `'…'`), and `\`
escapes the next character. A missing value is an error in the box, never a half-filled phrase.
`Esc` closes the box without typing anything.

Manage them from **☰ → Shortcuts…**: a **Name**, an **Alias** (letters and digits), the
**Phrase**, and a **Workspace** (below). The same dialog changes the key that opens the box
(**Open with**, always `Ctrl+Alt+<letter>`). Any other `Ctrl+Alt` chord still reaches the
terminal untouched.

They live in `claude-watcher-shortcuts.json` in the app's data directory. If that file is ever
corrupt it is backed up beside itself and the list starts empty; nothing else is affected.
Shortcuts saved by an older build that bound them to chords are converted to aliases.

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

Every install starts with a **Default** workspace, which cannot be deleted. The header switcher
lists the other workspaces to switch to, then **Manage workspaces…**: a name, a color, and an
optional default folder for its `+ New session → Pick a folder…` picker. **A workspace with any
running session cannot be deleted**; the dialog tells you to stop or move the sessions first.
Deleting an allowed (empty) workspace also deletes every template, shortcut, tag and rule scoped
to it, and its past sessions.

Move an existing session to another workspace from its card's move affordance, without stopping
it.

**Templates, shortcuts, tags and rules can be scoped too.** Each row in the Manage dialogs has a
**Workspace** field: **Global** (the default — visible and usable from every workspace) or one
specific workspace (visible and usable only there). Each dialog's header dropdown filters the list
by scope. Deleting a workspace from the app takes its scoped rows with it, as above. If a
workspace disappears some other way — a hand-edited settings file, say — the rows that named it
aren't lost: they stop being offered anywhere, and the dialog's dropdown gains a
**(no workspace)** entry so you can re-scope or remove them.

## Tags, rules and the filter bar

Tags are colored labels on a card (**☰ → Tags → Manage tags…**). Rules (**Manage rules…**) add or
remove tags on their own when a session launches, changes column, or sits in a column for a
while — matched by tag, template, folder or name, and run top to bottom.

Above the columns, the search box narrows the board to cards whose name matches, and the
**Filter** button shows one tag filter at a time. Both narrow the board and the column counts;
notifications, the badge and the sound ignore them.

## Themes

The whole look — every colour, radius, font and spacing token, the terminal palette, and anything a
stylesheet can do on top — is a **theme package**: one folder in `~/.config/claude-watcher/themes/`
(the app's data folder) holding a `theme.json`, an optional CSS file and the images or fonts that
CSS uses. **Liquid Glass** and **Paper** ship with the app. Pick one in **☰ → Settings… → Theme**. **Reload themes** re-reads the folder; **Open themes
folder** opens it in your file manager. Light themes are a package with `"colorScheme": "light"`.

A broken package is never applied and never crashes the app: it is listed under the picker with the
reason, and if it was the chosen one the app falls back to Default and keeps your choice so you can
fix the file and reload. The package format, every token, the load rules and three example themes
(the built-in look, a liquid-glass look, a light `paper` theme) are in
[`docs/themes/THEMES.md`](docs/themes/THEMES.md); `docs/themes/theme.schema.json` gives your editor
autocomplete for `theme.json`.

## Local API

An optional HTTP API lets your own automation launch a session from a template and watch its card
move. It is **off by default**: turn it on in **☰ → Settings… → Local API**. It listens on
`127.0.0.1` only (port 9281 by default), every request needs the bearer token shown in Settings,
and the interactive docs are at `http://127.0.0.1:<port>/docs`. A caller can run a template's own
prompt and read session state — never a session's prompts, Claude's replies or tool input. A
launch is refused while session status is off (the banner above), so a caller never gets a card
that cannot move.

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

The dev build runs beside the installed app on its own profile and ports, and its window title
ends in `(dev)`.

### Check

```bash
$ npm run typecheck
$ npm run lint
$ npm run test
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
