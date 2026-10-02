---
paths:
  - 'tests/drive/**'
  - 'src/renderer/**/*.css'
---

# Rule: see a visual change in the real app

Tests can't see CSS, stacking, animation or pixels (jsdom has no layout; CSS modules are a proxy).
For a VISUAL change, drive the built app: `tests/drive/driveApp.mjs` (Playwright, real `claude`,
real hook POSTs, screenshots; same seams as `tests/e2e/native-engine.e2e.ts`).

## Recipe

1. **Close nothing.** Drive profile: hook **29279**, API **29281**, userData
   `~/.config/claude-watcher-drive`. The driver refuses to start if 29279 is taken (the app would
   tolerate EADDRINUSE and launch without `--settings`, so no card would move). A second drive run
   quits anyway (`code=already_running`).
2. `npm run build` (driver runs `out/main/index.js`). Rebuild after every change.
3. Write a scenario in the scratchpad (not the repo), run with `node <file>.mjs`. A window opens
   on the operator's desktop for ~30 s — say so first.

   ```js
   import * as d from '/abs/path/to/repo/tests/drive/driveApp.mjs'
   await d.run(async ({ page, pickDir }) => {
     const id = await d.launchSession(page) // real claude; card lands in idle
     await d.needsYou(pickDir, id) // Stop hook → needs-you
     await d.shot(page, 'needs-you', { region: 'header' })
   })
   ```

4. Look at the PNG in `test-results/drive/`. Blank frame = failure. Zoom:
   `magick in.png -crop WxH+X+Y -filter point -resize 800% out.png`; measure with PIL.

Helpers (`page` first, except hooks): `launchSession`, `needsYou(pickDir, id)`,
`working(pickDir, id)`, `hook(pickDir, id, body)`, `cardIds`, `activeWorkspace`, `workspaceNames`,
`switchWorkspace`, `createWorkspace`, `deleteWorkspace`, `openSwitcher`/`closeSwitcher`,
`shot(page, name, { region: 'header' })`.

## Gotchas

- Fresh drive profile has only Default. Create what you need; delete after. To try a theme, copy it
  into `~/.config/claude-watcher-drive/themes/`.
- A workspace with running sessions can't be deleted — delete it in a second `run`.
- Cards exist only for app-launched sessions; move them with hook POSTs, never by poking the store.
- `launchSession` waits 3 s so claude's startup hooks land first.
- Kept-alive terminals stay in the DOM hidden — wait for a VISIBLE `embedded-terminal`.
- Escape doesn't close the workspace menu while focus is on its button — use
  `openSwitcher`/`closeSwitcher`.
- `locator.boundingBox()` waits 30 s for a missing element — `count()` first.
- Never `app.close()` (hangs ~120 s). `run` kills claudes + the Electron group, even on throw.
- CDP `deviceScaleFactor` doesn't reach screenshots — crop and upscale.
