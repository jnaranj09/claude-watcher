# Rule: see a visual change in the real app (drive the built app from a script)

Tests cannot see CSS, stacking, animation or pixel alignment: jsdom has no layout, and a
`*.module.css` import resolves to a proxy (`design.md`). When a change is VISUAL, look at it in
the real app before calling it done. `tests/drive/driveApp.mjs` launches the BUILT app with
Playwright, spawns real `claude` sessions, moves their cards with real hook POSTs, and
screenshots the window. It uses the same seams as `tests/e2e/native-engine.e2e.ts`.

## Recipe

1. **Free 127.0.0.1:9279.** Ask the operator to close the installed app and any `npm run dev`.
   The driver refuses to start while the port is taken: the app TOLERATES EADDRINUSE — it logs
   `code=eaddrinuse` and keeps running rather than crashing (`hookServer.ts`) — so it would bind
   nothing and your hook POSTs would reach the OTHER instance. The log line is the only sign, and
   it is easy to miss in the driver's output, which is why the port is checked up front.
2. **`npm run build`.** The driver runs `out/main/index.js`, not the dev server. Rebuild after
   every change.
3. **Write a scenario in your scratchpad** (not the repo) and run it with `node <file>.mjs`.
   A window opens on the operator's desktop for the ~30 s it takes; say so first.

   ```js
   import * as d from '/abs/path/to/repo/tests/drive/driveApp.mjs'
   await d.run(async ({ page, pickDir }) => {
     const id = await d.launchSession(page) // real claude; the card lands in idle
     await d.needsYou(pickDir, id) // a Stop hook → needs-you
     await d.shot(page, 'needs-you', { region: 'header' })
   })
   ```

4. **Look at the PNG** in `test-results/drive/` (git-ignored). A blank frame is a failure. For
   alignment, zoom a crop without smoothing — `magick in.png -crop WxH+X+Y -filter point -resize
800% out.png` — and measure pixel rows with PIL when "looks off" needs a number.

Helpers (all take `page` first, except the hooks): `launchSession`, `needsYou(pickDir, id)`,
`working(pickDir, id)`, `hook(pickDir, id, body)`, `cardIds`, `activeWorkspace`,
`workspaceNames`, `switchWorkspace`, `createWorkspace`, `deleteWorkspace`,
`openSwitcher` / `closeSwitcher`, `shot(page, name, { region: 'header' })`.

## Gotchas (each one cost a run)

- **The profile is `~/.config/Electron`, not the operator's `~/.config/claude-watcher`.** The
  unpackaged launch writes there, so the operator's real workspaces and settings are safe. A fresh
  profile has ONLY the Default workspace: create what the scenario needs, and delete it after.
- **A workspace with running sessions cannot be deleted** (main refuses: "That workspace still has
  running sessions"). Delete it in a second `run` — every run starts with no sessions.
- **Cards exist only for sessions the app launched.** A hook for any other id is a no-op. Move
  cards with hook POSTs, never by poking the renderer store.
- **`launchSession` waits 3 s after the launch**, so claude's own startup hooks land before yours
  and cannot overwrite the column you set.
- **Kept-alive terminals stay in the DOM, hidden.** Wait for a VISIBLE `embedded-terminal`, not
  the first match.
- **Escape does not close the workspace menu while focus is on its button** (where a click leaves
  it) — only the menu listens for Escape. Toggle with the button: `openSwitcher` / `closeSwitcher`.
- **`locator.boundingBox()` WAITS (30 s) for a missing element.** Call `count()` first.
- **Never `app.close()`** — the minimize guard makes it hang ~120 s. `run` kills the claudes, then
  the Electron process group, and always does so, even when the scenario throws.
- **A CDP `deviceScaleFactor` override does not reach the screenshots.** Crop and upscale instead.
