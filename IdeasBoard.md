---
title: "Ideas board"
description: "This file lists new Feature ideas, fixes and changes for the project. They are here because they havent been implemented yet. It also tracks their status. When an feature is implemented or rejected it is simply removed from the file. If an idea needs expanding or additional info, the item below should point to an external file to keep this one just a list"
last_modified: 2026-09-09
allowed_statuses: [pending_review, approved, in_progress]
allowed_efforts: [low_effort, medium_effort, high_effort]
---
# Sections
- This document is separated in sections to categorize the ideas.

***
## New Features
- **Programmatic access to app's actions**: I want an external system (n8n / external claude session) to be able to create cards with an initial prompt (previously defined set only inside the app by a human to avoid prompt injection) That way an external system can start cards/work based on external events like a ticketing system new ticket. `pending_review` `high_effort`
- **Add a "Projects" new concept to the app**: Currently all claude/terminal cards live in the same space, but what about if I want to separate cards related to devops tasks on a separate view?. This new feature introduces the concept of Projects. Projects are like k8s namespaces or OpenSearch Tenants, they allow the user to scope cards to a project and if they change the app view to a different project, app should only show cards running under that project. Configuration should also be project scope, for example I may want session templates for only a specific project, but any configuration should be allowed to be scoped globally as well, its the user's choice. `pending_review` `high_effort`
- **Create custom card statuses and apply them to cards until a native event changes its status**: Sometimes idle may mean different things, like we are waiting for X or it is pending review (something we will check later). This would allow a user to create custom statuses and assign them to a card. The assignment will always be manual and the card will lose that status if a native event marks it back at working or needs you. This feature should not be confused to tagging cards. We are not saying the card is of a catogory called "deployments", we are giving it a custom status. On the terminal view left panel, custom statuses should always appear at bottom se the focus keeps on the native statuses. On the board this feature needs brainstorming on allowing custom statuses on the board. `pending_review` `high_effort`
- **Bound terminal memory across projects**: With Projects, kept-alive xterms pile up across every project the user visits. Two ideas to bound it, not needed for the first Projects release: (a) keep the PTY + its output in main but dispose the hidden project's xterm instances on switch and re-attach/replay on switch back; (b) keep today's kept-alive behaviour but cap the number of live xterms app-wide and dispose the oldest hidden one. Both need a scrollback/replay path that does not exist yet. `pending_review` `medium_effort`
- **Favorites for the New session popover**: Let the user mark templates as favorites so they sort to the top of the `+ New session` popover instead of the flat saved order. Came out of the Workspaces brainstorm: a workspace-level "default template" was rejected because ordering the popover is a favorites concern, not a workspace one. Decide whether favorites are global or workspace-scoped, and whether shortcuts/workspaces get them too. `pending_review` `medium_effort`
***
## Bugs
***


