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
# Fedora
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

| Card state       | It means                                               | Enters on                                                                                                                       | Leaves on                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connecting       | the app spawned claude, not yet reporting              | app-launch                                                                                                                      | your first prompt (→ Working)                                                                                                                                                                                              |
| Working          | Claude's turn, or its background work is still running | you submit a prompt / a tool runs / `/compact` runs / a turn ends with a shell still running, unless it ended with `Needs you:` | next event                                                                                                                                                                                                                 |
| Needs permission | Claude is blocked on an approval                       | the permission prompt                                                                                                           | you approve or deny (`Enter`, `1` or `2` in its terminal moves it to Working)                                                                                                                                              |
| Asking you       | Claude asked you a question                            | the AskUserQuestion tool, a turn ending in a `Needs you:` line, or a turn ending in a question                                  | you reply, press Esc or `/clear` — viewing is not answering (a `Needs you:` ask also stays on through background work, monitor wake-ups and later turns, until Claude starts new background work or you have looked at it) |
| Your turn        | Claude finished; the prompt is waiting                 | any finished turn                                                                                                               | you reply, you view the session, or you press Esc (Working if background work runs)                                                                                                                                        |
| Idle             | nothing to do here                                     | a fresh session, a finished turn you looked at, or you pressed Esc with no background work                                      | you submit a prompt                                                                                                                                                                                                        |

Five honest footnotes:

- "A turn ending in a question" and the `Needs you:` line are the two text signals in the
  app. The question heuristic only picks the FLAVOR of attention (question vs. plain
  your-turn): a missed question still shows as **Your turn**. A `Needs you:` line, one of the
  last three lines of a turn, is Claude saying it is blocked on you: the card stays on
  **Asking you** through background work, monitor wake-ups and later turns until you reply,
  press Esc or `/clear`, or until Claude starts new background work by itself (something else
  unblocked it: a chat, a ticket, a coworker). Once you have looked at the session, the ask stops
  holding the card, and Claude's next turn decides again. Heuristics never decide WHETHER you're told; only how loudly.
- Sessions launched by the app get one extra system-prompt line asking Claude to
  use its question tool (or end questions with `?`) and to end a turn that is blocked on you
  with a last line starting `Needs you:`. It applies ONLY to sessions
  this app launches — it never touches your settings files or other sessions.
- **Background work keeps the card on Working.** When Claude backgrounds a shell or arms a
  monitor, its turn ends but the work keeps running. Claude Code reports that running work on
  the turn-end hook itself, so the card stays on **Working**, the same thing the terminal says
  ("1 shell still running"), and nothing pops up. When the work finishes, Claude wakes up on its
  own and that turn moves the card again; if it then finishes or asks you something, you are told
  then. Work that never ends (a dev server) keeps the card on Working, Esc included: running work
  is never idle. A question always wins: a turn ending in a question or a `Needs you:` line is **Asking you**, background or not.
- **Esc drops the card to Idle immediately** (to Working while background work runs). Interrupting Claude emits no hook at all —
  not `Stop`, not a notification, nothing, not even after 90 seconds. Without help the card
  would keep saying Working until you next used the session. Claude does record the
  interrupt in its own transcript the instant it happens, so the app watches for that and
  demotes the card in well under a second (measured end to end: **85ms**). With background
  work still running the card shows Working instead: running work is never idle. No notification fires — you pressed the key, so you are
  already there.
- **A `!` shell command does not show as work.** Claude Code's bash mode (`!ls`) sends no hook
  at all, so the card keeps its status while the command runs. You typed it in that terminal, so
  you are already there.

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

## Context: what a session loaded

The **Context** button above a focused session shows what Claude loaded for it: instruction
files (CLAUDE.md, rules, `@` imports, memory) with their tier and token cost, plus skills,
agents, MCP servers, commands, hooks and plugins. Each file opens in your editor (never a
program), and each `.md` file's **History** keeps its last versions: compare one with the file
now, or restore it (the file as it is now is kept first, so a restore can be undone).

The app learns this from a small Claude Code mod it passes to the sessions it launches
(`--plugin-dir`, from the app's own data folder). The mod only reads and reports file paths and
counts, plus who sent each prompt (the origin kind, never the text); it changes nothing in the session. It needs Claude Code 2.1.304 or newer; on an older
claude the session runs as before and Context says why it is empty.

## Ending a session, and Past sessions

Every card, and the bar above a focused session, carries two buttons:

- **Archive** — stops the session and keeps it in **Past sessions**. No confirm: it is
  reversible.
- **Delete** — asks first, then stops the session and keeps nothing, except what it saved to
  memory, which stays marked `Session deleted`. When the session saved memory items, the confirm
  says how many and offers **Also delete from memory** (off unless you tick it). Claude's own
  files are never touched.

A session that ends any other way — `/exit`, `Ctrl+C` twice, claude exiting, quitting the app,
closing the window — is archived too. A session is also on record while it runs, so even a crash
or a power loss leaves it in Past sessions.

**☰ → Past sessions** lists them (it keeps the 200 most recent). **Open** brings one back as a
live card with `claude --resume`, under the same id; **Forget** removes it from the list. Open is
refused, with a line saying why, when the folder is gone, when claude no longer has the
conversation, or when that conversation is running in another terminal outside the app.

When claude exits inside an open terminal, the pane says how it exited (the exit code or signal)
and offers **Resume conversation**, which replaces the dead pane with the resumed session.

## Memory

Sessions the app starts can keep things across sessions, in the app's own memory. It holds:

- **Specifics** — an exact value under a key: a port, a flag, an id, a command.
- **Facts** — a title and a short text about how something works.
- **Episodes** — what one session did, written when it ends.
- **Commands** — the shell commands that worked in a session (one line, after the same
  best-effort secret removal as everything saved; see Known limits).

Claude saves and finds items with its own memory tools (search, read, browse, save, update, mark
stale). It can never delete or pin an item; only you can. Every item keeps its date, where it
came from (session, folder, tags) and its earlier versions, and a new session starts with a short
index: your pinned items, then the open tasks, specifics and recent sessions of its folder.
Memory is a record of what was seen and when, so Claude gives the date with what it takes from
it.

**Saving by itself.** The app also saves from a session on its own: every few turns while it runs
(the checkpoint), when it ends (Archive, `/exit`, `/clear`), and at the next start for anything
a quit or crash left owed. A session with fewer than two prompts is not saved. A model reads
what is new in the session's transcript and proposes what to keep; the app keeps a value only
when the quote it gives is found in the transcript, and drops the rest (Context → **Memory**
lists what was dropped and why, while the session is on the board). A save updates a fact only
when it brings a new exact value (at least 4 characters with a digit, `_`, `/` or `.`) that the
session saw; a reworded or renamed fact, or one whose only new value is shorter (`Node 22`, port
`80`), is edited by hand. When a
session ends, a toast says how its save went: **Memory saved from "…"** with what went to memory
and how many tasks (**Show**, offered only when something went to memory, opens Memory on that session),
**Nothing new to remember**, or **Could not save memory**. A save at a checkpoint or at the next
start shows a toast only when it fails. A session with no name or with fewer than two prompts
gets no toast, and one that never got a prompt ends quietly.

**Open work becomes tasks.** Work a session leaves open becomes a task in **Goals**, with how to
check it (`Check:`). A later session sees the folder's open tasks and can report what it found;
a task it reports done shows **Reported done by "…"** and stays open: only you close a task
(**Done**).

**☰ → Memory** lists the items of the workspace you are in (and the global ones) on four pages,
**Specifics**, **Facts**, **Episodes** and **Commands**: search, filter by folder, session, tag,
date or goal, edit, pin, mark stale, see **History** and restore a version, or delete. An item
saved from a session has **Open source**, which shows the words it was taken from. An item is
global or belongs to one workspace. Each record in **Past sessions** has a **Memory:** line (what
was saved, `nothing new`, `failed`, `saving…` or `off`) and the session's episode under it. The
**Context** button of a session has a **Memory** page: what the session got at launch, what
recall gave it while it ran (**With a prompt** / **With a file**), what it read, what it saved and
what was dropped; a session that runs without recall for a reason you did not choose (an older
claude, or the app could not set up its mod) says so there.

What it costs: each save is a headless `claude -p` call (a long session can take a few) on your
own Claude account and login, with the model you choose (**Sonnet** by default), each call capped
at 1 USD by claude's `--max-budget-usd`. It sends parts of the session's transcript to Claude,
as the session itself did, with the session's name and folder, its earlier save notes, and the
keys and titles (never the values) of up to 150 saved items and 50 open tasks of its workspace,
so the model does not save them twice. Nothing else leaves the machine. The next start saves
every session a quit or crash left owed, one after another, with no cap on how many (each up to
12 calls).
Memory lives in `claude-watcher-memory.db` in the app's data folder. Memory text, transcript text
and the model's answers are never written to a log, a notification or the local API.

**Settings → Memory**:

- **Memory** (on by default) — off means sessions start with no memory tools and no index, and
  nothing is saved from them. Items already saved are kept. While it is on, four more choices
  show:
  - **Memory recall** (on by default) — while a session runs, Claude gets a fresh memory index
    after `/clear` and `/compact`, items that match each prompt, the keys saved for a folder when
    it opens a file there, and the `/remember` command. Needs Claude 2.1.323 or newer. A change
    applies to sessions started after it.
  - **Memory checkpoint** — saves from a running session every 10, 15 (the default) or 25
    turns, or **Off**: only when a session ends.
  - **Save open work as tasks** (on by default) — work a session leaves open becomes a task in
    Goals.
  - **Memory model** — **Haiku** or **Sonnet** (the default): the model that reads a session to
    save from it, on your own Claude account. Haiku uses less.

  Switching **Memory** off cancels the save call that is running, and nothing of that call is
  kept; what the save had already written before stays.

- **Claude's auto memory** — Claude Code's own memory, in the sessions this app starts: **Off**,
  **On**, or **Claude decides** (the default: the app changes nothing, so your Claude settings
  apply). The two memories work side by side. A change applies to sessions started after it.

Deleting a workspace deletes its memory items. Deleting a session keeps what it saved (see
above).

Known limits:

- Saving needs claude 2.1.323 or newer; with an older claude nothing is lost, the save waits
  until claude is updated.
- Removing secrets before a save is best effort. It takes out secrets with a known shape or a
  name in front of them: private key blocks (PEM, PGP), JWTs, `Bearer` and `Authorization`
  values, known token prefixes (`sk-`, `sk_live_` / `sk_test_`, `ghp_`-style GitHub tokens,
  `glpat-`, Slack `xox…-`, `npm_`, AWS `AKIA` / `ASIA` key ids, Google `AIza`), a value after a
  name such as `password`, `secret`, `token` or `api_key` / `apiKey`, a password in a URL,
  `curl -u user:pass`, and flags such as `--password V` / `--api-key V`. It misses a secret with
  no name and no known shape (a bare long hex or base64 string, an AWS secret key on its own), a
  short value, a token split over two lines, a password after a prefixed flag and a space
  (`--db-password V`), a password quoted on its own after `-u user:`, `mysql -pPASS`, and token
  kinds it has no pattern for. It also replaces some harmless text that looks like a secret.
- A value written right before a dotted or hyphenated continuation (`1.2` in `1.2.34`) is
  dropped on purpose: a cut version or address is worse than none.
- A value inside the cut middle of a very long tool result is not saved.
- A resumed turn you stop with Esc sends no turn end, so its text is saved only after a later
  resume.
- A conversation switched with `/resume` inside claude is saved at the next start.
- A session larger than one read (32 MiB) is finished at the next start.
- A session started before this version and resumed later is read from the start of its
  transcript, so its old text is saved with today's date.
- Going back to an older version keeps Past sessions, Goals and Settings readable: it drops the
  memory settings and task fields it does not know. It will not open the newer memory database:
  it refuses it without changing it.

## Session templates

A template is a saved bundle of **folder + model + permission mode + thinking effort** under
a name. `+ New session` (the header button and the empty board's) opens a menu:
`Pick a folder` (the plain flow), a searchable list of your templates, and
`Manage templates`. Picking a template asks only for the session name, then launches
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

Manage them from **☰ → Shortcuts**: a **Name**, an **Alias** (letters and digits), the
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
lists the other workspaces to switch to, then **Manage workspaces**: a name, a color, and an
optional default folder for its `+ New session → Pick a folder` picker. **A workspace with any
running session cannot be deleted**; the dialog tells you to stop or move the sessions first.
Deleting an allowed (empty) workspace also deletes every template, shortcut, tag, rule and goal
scoped to it, its past sessions and its memory.

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

Tags are colored labels on a card (**☰ → Tags → Manage tags**). Rules (**Manage rules**) add or
remove tags on their own when a session launches, changes column, or sits in a column for a
while — matched by tag, template, folder or name, and run top to bottom.

Above the columns, the search box narrows the board to cards whose name matches, and the
**Filter** button opens a row of filters: by tag, by folder and by launch time (today, the last 7
or 30 days, or a day picked on a calendar). Each workspace keeps its own filters while the app
runs. Both narrow the board and the column counts; notifications, the badge and the sound ignore
them. The Active and Past pages of **☰ → Sessions** have the same **Filter** button (Past also
filters by end time).

## Themes

The whole look — every colour, radius, font and spacing token, the terminal palette, and anything a
stylesheet can do on top — is a **theme package**: one folder in `~/.config/claude-watcher/themes/`
(the app's data folder) holding a `theme.json`, an optional CSS file and the images or fonts that
CSS uses. **Liquid Glass** and **Paper** ship with the app. Pick one in **☰ → Settings → Theme**. **Reload themes** re-reads the folder; **Open themes
folder** opens it in your file manager. Light themes are a package with `"colorScheme": "light"`.

A broken package is never applied and never crashes the app: it is listed under the picker with the
reason, and if it was the chosen one the app falls back to Default and keeps your choice so you can
fix the file and reload. The package format, every token, the load rules and three example themes
(the built-in look, a liquid-glass look, a light `paper` theme) are in
[`docs/themes/THEMES.md`](docs/themes/THEMES.md); `docs/themes/theme.schema.json` gives your editor
autocomplete for `theme.json`.

## Local API

An optional HTTP API lets your own automation launch a session from a template and watch its card
move. It is **off by default**: turn it on in **☰ → Settings → Local API**. It listens on
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
