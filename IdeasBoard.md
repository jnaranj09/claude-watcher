---
title: "Ideas board"
description: "This file lists new Feature ideas, fixes and changes for the project. They are here because they havent been implemented yet. It also tracks their status. When an feature is implemented or rejected it is simply removed from the file. If an idea needs expanding or additional info, the item below should point to an external file to keep this one just a list"
last_modified: 2026-09-18
allowed_statuses: [pending_review, approved, in_progress]
allowed_efforts: [low_effort, medium_effort, high_effort]
---
# Sections
- This document is separated in sections to categorize the ideas.

***
## New Features
- **Use a template's initial prompt for in-app launches**: The `+ New session` popover ignores `initialPrompt` today (API launches only — the field is labelled as such). For a template with no params it could run the prompt directly; with params the name prompt would also ask for the values, validated with the same regex + max length the API uses. Decide whether the prompt is opt-in per launch. `pending_review` `medium_effort`
- **Bound terminal memory across projects**: With Projects, kept-alive xterms pile up across every project the user visits. Two ideas to bound it, not needed for the first Projects release: (a) keep the PTY + its output in main but dispose the hidden project's xterm instances on switch and re-attach/replay on switch back; (b) keep today's kept-alive behaviour but cap the number of live xterms app-wide and dispose the oldest hidden one. Both need a scrollback/replay path that does not exist yet. `pending_review` `medium_effort`
- **Favorites for the New session popover**: Let the user mark templates as favorites so they sort to the top of the `+ New session` popover instead of the flat saved order. Came out of the Workspaces brainstorm: a workspace-level "default template" was rejected because ordering the popover is a favorites concern, not a workspace one. Decide whether favorites are global or workspace-scoped, and whether shortcuts/workspaces get them too. `pending_review` `medium_effort`
- **Sort the board**: A `Sort` button in the board filter bar's controls row, beside Search and `Filter` (it was in the toolbar mockup). Lets the operator pick the card order inside each column — today it is fixed (`sortByEnteredColumn`). Decide the sort keys (time in column, name, launch time…), whether the rail follows it, and whether the choice persists. `pending_review` `medium_effort`
- **A ⋯ menu in the board filter bar**: The toolbar mockup ends in a `⋯` button after Sort. No rows are defined yet; decide what belongs there, and what stays in the header ☰ menu, before building it (a control with nothing behind it is not rendered). `pending_review` `low_effort`
- **More filter types (folder, …)**: The board search matches the card NAME only, on purpose; folder and the other card fields belong to filter TYPES in the chip row. The second type brings the `+ Add filter` type step (`Tag ▸`, `Folder ▸`) that design.md defers until then, and likely more than one filter at a time (the number on the `Filter` button). `pending_review` `medium_effort`
- **Past sessions (archive / delete / open)**: Archive is the default exit from the board (Stop, `Ctrl+C` twice, pty exit) and writes a record; Delete is a confirmed exit that keeps none; a `Past sessions…` dialog (last ☰ row) searches the history and reopens one with `claude --resume <id>` in the app. Includes the `/clear` pending-rename fix and the `⟳` name-sync mark. Spec: `docs/superpowers/specs/2026-09-18-past-sessions-design.md`. `approved` `high_effort`
- **Instant name sync from claude's session records**: `~/.claude/sessions/<pid>.json` carries `name` / `nameSource` and updates within ~1 s of a hook push or `/rename`, and survives `/clear`. A watcher on that directory would rename the card at once instead of on the next prompt, and would rebind a `/clear` without waiting for a hook. Investigated 2026-09-18 (probe on claude 2.1.276); deferred in favour of keeping the next-prompt design and making it visible. Fallback stays the `UserPromptSubmit` read-back. `pending_review` `medium_effort`
***
## Bugs
***
- **Workspace switch-back should return to the last FOCUSED terminal, not the last LAUNCHED one**: `focusWorkspace` (boardStore) re-points the pin at the workspace's most recently launched terminal. Reachable today by rail-clicking back to an older terminal after a second launch, and now more likely: an API create registers a terminal without focusing it, so leaving the workspace and coming back lands the operator in the API terminal they never opened instead of the one they were typing in. Track the last focused terminal per workspace and prefer it; fall back to most-recently-launched only when none. `pending_review` `low_effort`


