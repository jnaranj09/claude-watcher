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
- **Programmatic access to app's actions**: I want an external system (n8n / external claude session) to be able to create cards with an initial prompt (previously defined set only inside the app by a human to avoid prompt injection) That way an external system can start cards/work based on external events like a ticketing system new ticket. Design: `docs/superpowers/specs/2026-09-14-programmatic-api-design.md`. `approved` `high_effort`
- **Bound terminal memory across projects**: With Projects, kept-alive xterms pile up across every project the user visits. Two ideas to bound it, not needed for the first Projects release: (a) keep the PTY + its output in main but dispose the hidden project's xterm instances on switch and re-attach/replay on switch back; (b) keep today's kept-alive behaviour but cap the number of live xterms app-wide and dispose the oldest hidden one. Both need a scrollback/replay path that does not exist yet. `pending_review` `medium_effort`
- **Favorites for the New session popover**: Let the user mark templates as favorites so they sort to the top of the `+ New session` popover instead of the flat saved order. Came out of the Workspaces brainstorm: a workspace-level "default template" was rejected because ordering the popover is a favorites concern, not a workspace one. Decide whether favorites are global or workspace-scoped, and whether shortcuts/workspaces get them too. `pending_review` `medium_effort`
- **Sort the board**: A `Sort` button in the board filter bar's controls row, beside Search and `Filter` (it was in the toolbar mockup). Lets the operator pick the card order inside each column — today it is fixed (`sortByEnteredColumn`). Decide the sort keys (time in column, name, launch time…), whether the rail follows it, and whether the choice persists. `pending_review` `medium_effort`
- **A ⋯ menu in the board filter bar**: The toolbar mockup ends in a `⋯` button after Sort. No rows are defined yet; decide what belongs there, and what stays in the header ☰ menu, before building it (a control with nothing behind it is not rendered). `pending_review` `low_effort`
- **More filter types (folder, …)**: The board search matches the card NAME only, on purpose; folder and the other card fields belong to filter TYPES in the chip row. The second type brings the `+ Add filter` type step (`Tag ▸`, `Folder ▸`) that design.md defers until then, and likely more than one filter at a time (the number on the `Filter` button). `pending_review` `medium_effort`
***
## Bugs
***


