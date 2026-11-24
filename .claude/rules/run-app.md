---
paths:
  - 'tests/drive/**'
  - 'src/**'
---

# Rule: see a visual change in the real app

Tests can't see CSS, stacking, animation or pixels (jsdom has no layout; CSS modules are a proxy).
For a VISUAL change, drive the built app: `tests/drive/driveApp.mjs` (Playwright, real `claude`,
real hook POSTs, screenshots; same seams as `tests/e2e/native-engine.e2e.ts`).

## Profiles (never touch the owner's instances)

| Name    | Starts with                   | Ports                 | Data folder                      | Env var                        |
| ------- | ----------------------------- | --------------------- | -------------------------------- | ------------------------------ |
| default | packaged app, `npm run smoke` | hook 9279, API 9281   | `~/.config/claude-watcher`       | none                           |
| dev     | `npm run dev`                 | hook 19279, API 19281 | `~/.config/claude-watcher-dev`   | `ELECTRON_RENDERER_URL`        |
| e2e     | `npm run test:e2e`            | hook 39279, API 39281 | temp dir per launch              | `CLAUDE_WATCHER_PROFILE=e2e`   |
| drive   | `tests/drive/driveApp.mjs`    | hook 29279, API 29281 | `~/.config/claude-watcher-drive` | `CLAUDE_WATCHER_PROFILE=drive` |

## Recipe

1. **Close nothing.** Drive profile: hook **29279**, API **29281**, userData
   `~/.config/claude-watcher-drive`. The driver refuses to start if 29279 is taken (the app would
   tolerate EADDRINUSE and launch without `--settings`, so no card would move). A second drive run
   quits anyway (`code=already_running`).
2. `npm run build` (driver runs `out/main/index.js`). Rebuild after every change.
3. Write a scenario in the scratchpad (not the repo), run with `node <file>.mjs`. A window opens
   on a HIDDEN display (`tests/headless/headlessDisplay.mjs`: a private `kwin_wayland --virtual`
   with the real GPU), so it never takes the operator's focus. e2e and smoke use the same display.
   `CW_HEADED=1` shows the window on the desktop — only when the operator asks to watch.

   ```js
   import * as d from '/abs/path/to/repo/tests/drive/driveApp.mjs'
   await d.run(async ({ page, pickDir }) => {
     const id = await d.launchSession(page) // real claude; card lands in idle
     await d.needsYou(pickDir, id) // Stop hook → needs-you
     await d.shot(page, 'needs-you', { region: 'header' })
   })
   ```

4. Capture in `test-results/drive/` (git-ignored) and look at the PNG. Blank frame = failure. Zoom:
   `magick in.png -crop WxH+X+Y -filter point -resize 800% out.png`; measure with PIL.

5. **Probe around the change** at the same surface: a wrong input, the action twice, stale state.
   Report each probe, including the ones that held. Prose only.

Smallest scenario: `tests/drive/example.mjs` (one shot, no claude; a taken drive port prints
`refused: 127.0.0.1:29279 is taken` and exits 2). Guard: `tests/main/driveRecipe.guard.test.ts`
(the driver's port, data folder and port check match `src/main/profile.ts` and the table above).

Helpers (`page` first, except hooks): `launchSession`, `needsYou(pickDir, id)`,
`working(pickDir, id)`, `hook(pickDir, id, body)` (posts under the session's own channel token,
read by `hookPathOf(id)` from the claude's `--settings` file as a same-user process would; a
`/clear`ed id is on no argv), `cardIds`, `activeWorkspace`, `workspaceNames`,
`switchWorkspace`, `createWorkspace`, `deleteWorkspace`, `openSwitcher`/`closeSwitcher`,
`shot(page, name, { region: 'header' })`.

## What a drive is not

- Running the test suite or the typechecker. That is the gate. Prose only.
- Importing a module from the source tree and calling it. Go to the surface that calls it (a
  window, an API route, a hook POST). Prose only.
- A destructive path (delete, archive, quit with live sessions) with no safe target: do not drive
  it live; say which path was not exercised and why. Prose only.

## Gotchas

- Fresh drive profile has only Default. Create what you need; delete after. To try a theme, copy it
  into `~/.config/claude-watcher-drive/themes/`.
- A workspace with running sessions can't be deleted — delete it in a second `run`.
- Cards exist only for app-launched sessions; move them with hook POSTs, never by poking the store.
- `launchSession` waits 3 s so claude's startup hooks land first.
- `CW_DRIVE_PICK_DIR=<folder>` makes every run launch in that one folder (claude asks its trust
  question once there, not in a new temp folder per run).
- Kept-alive terminals stay in the DOM hidden — wait for a VISIBLE `embedded-terminal`.
- Escape doesn't close the workspace menu while focus is on its button — use
  `openSwitcher`/`closeSwitcher`.
- `locator.boundingBox()` waits 30 s for a missing element — `count()` first.
- Never `app.close()` (hangs ~120 s). `run` kills claudes + the Electron group (SIGKILL), even on
  throw and even after the scenario quit the app itself. A SIGKILL runs none of the app's quit
  code (no archive, no memory quit), so a scenario that tests the quit calls
  `app.evaluate(({ app }) => app.quit())` first. With a live session on the board that quit
  opens the Quit guard (`quit-guard-panel`) and the app keeps running until it is answered.
- CDP `deviceScaleFactor` doesn't reach screenshots — crop and upscale.
