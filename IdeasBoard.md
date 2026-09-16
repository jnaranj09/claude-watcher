---
title: "Ideas board"
description: "This file lists new Feature ideas, fixes and changes for the project. They are here because they havent been implemented yet. It also tracks their status. When an feature is implemented or rejected it is simply removed from the file. If an idea needs expanding or additional info, the item below should point to an external file to keep this one just a list"
last_modified: 2026-09-15
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
- **API-created cards should register without stealing focus**: An API launch routes `launch:requested` to `openLaunchedTerminal`, which sets `viewMode: 'focused'` and `focusedTerminalId` — so a webhook flips the operator to the new terminal mid-keystroke, like a click they did not make, and does it again on every event. Cross-workspace is worse: `FocusedSession` shows whatever `focusedTerminalId` names with no workspace gate, so a template scoped to workspace B yanks an operator on workspace A into B's terminal while the header still says A. A UI launch should keep today's behaviour (the operator just clicked); an API launch needs an `openLaunchedTerminal` variant that registers the `launchedTerminals` entry WITHOUT changing `viewMode`/`focusedTerminalId`. Safe for the pty: the kept-alive frame still mounts `visibility:hidden`, so it is laid out and `fit()` sees a non-zero box. The card then appears on the board and the operator opens it when they want. `pending_review` `medium_effort`
***
## Bugs
***


