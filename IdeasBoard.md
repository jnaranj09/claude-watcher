---
title: 'Ideas board'
description: 'This file lists new Feature ideas, fixes and changes for the project. They are here because they havent been implemented yet. It also tracks their status. When an feature is implemented or rejected it is simply removed from the file. If an idea needs expanding or additional info, the item below should point to an external file to keep this one just a list'
last_modified: 2026-10-14
allowed_statuses: [pending_review, approved, in_progress]
allowed_efforts: [low_effort, medium_effort, high_effort, large_effort]
---

# Sections

- This document is separated in sections to categorize the ideas.

---

## New Features

- **Use a template's initial prompt for in-app launches**: The `+ New session` popover ignores `initialPrompt` today (API launches only — the field is labelled as such). For a template with no params it could run the prompt directly; with params the name prompt would also ask for the values, validated with the same regex + max length the API uses. Decide whether the prompt is opt-in per launch. `pending_review` `medium_effort`
- **Bound terminal memory across projects**: Workspace switches unmount nothing, so kept-alive xterms pile up across every workspace the user visits. Two ideas to bound it: (a) keep the PTY + its output in main but dispose the hidden project's xterm instances on switch and re-attach/replay on switch back; (b) keep today's kept-alive behaviour but cap the number of live xterms app-wide and dispose the oldest hidden one. Both need a scrollback/replay path that does not exist yet. `pending_review` `medium_effort`
- **Sort the board**: A `Sort` button in the board filter bar's controls row, beside Search and `Filter` (it was in the toolbar mockup). Lets the operator pick the card order inside each column — today it is fixed (`sortByEnteredColumn`). Decide the sort keys (time in column, name, launch time…), whether the rail follows it, and whether the choice persists. `pending_review` `medium_effort`
- **More filter types (folder, …)**: The board search matches the card NAME only, on purpose; folder and the other card fields belong to filter TYPES in the chip row. The second type brings the `+ Add filter` type step (`Tag ▸`, `Folder ▸`) that design.md defers until then, and likely more than one filter at a time (the number on the `Filter` button). `pending_review` `medium_effort`
- **Instant name sync from claude's session records**: `~/.claude/sessions/<pid>.json` carries `name` / `nameSource` and updates within ~1 s of a hook push or `/rename`, and survives `/clear`. A watcher on that directory would rename the card at once instead of on the next prompt, and would rebind a `/clear` without waiting for a hook. Investigated 2026-09-18 (probe on claude 2.1.276); deferred in favour of keeping the next-prompt design and making it visible. Fallback stays the `UserPromptSubmit` read-back. `pending_review` `medium_effort`
- **Custom hook port, and the banner suggests it**: The hook ingest listens on a fixed port (9279, 19279 dev, 29279 drive). When another program holds it, the server-health banner (UX-05) says session status is off and the only fix it offers is closing that program. Let the operator pick the hook port in Settings (like `apiPort`), and have the `port_in_use` banner suggest changing it. A new port must reach the hook settings file handed to each spawn (`--settings`); sessions started before the change keep POSTing to the old port, so decide whether they are re-launched, left without status, or the old port stays bound until they end. The drive/e2e harness POSTs to fixed ports and would need the value too. `pending_review` `medium_effort`
- **Action feedback polish (focus, motion, keyboard, disabled reasons)**: Left out of the action-feedback spec on purpose (`docs/superpowers/specs/2026-09-29-action-feedback-design.md`, Scope → Out). Focus return when a dialog closes; initial focus in Shortcuts and Settings; keyboard access to the terminal context menu; the StartingBanner popup's Escape and outside-click; disabled buttons that give no reason (name prompt, Tags, Workspaces); Rules' broken-marker reason visible only in a `title`. Toasts are Tab-reachable from inside a dialog (there is no focus trap — inert is the trap); the focus work inherits that knowingly. `pending_review` `medium_effort`
- **macOS port (unsigned first)**: Add a `mac` job (`macos-latest`, dmg, x64 + arm64) to `.github/workflows/release.yml` beside `linux`. Mostly POSIX already (`$SHELL -l -c`, `kill(pid,0)`); the `/proc` correlation is already gated to Linux in `launchSession.ts`. Replace the scaffold `mac.extendInfo` camera/mic/Documents strings. Decide the tray/notification behaviour without KDE, and how to smoke without a display. Signing + notarization later (Apple account). Testing: a macOS VM at best. `pending_review` `medium_effort`
- **Windows port — native claude, unsigned first**: Run the native Windows `claude.exe` through ConPTY (not WSL). Needs a platform layer for the spawn (`$SHELL -l -c` has no Windows twin), the version probe, the process-alive checks (`kill(pid,0)`, `~/.claude/sessions/<pid>.json`), paths, and an `nsis` job in `release.yml`. SmartScreen warning until a code-signing cert. Testing: the operator's Windows machine. `pending_review` `large_effort`

---

## Bugs

---
