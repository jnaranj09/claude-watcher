// The smallest drive scenario (.claude/rules/run-app.md): start the BUILT app on the drive
// profile, take one screenshot into test-results/drive/example.png, tear everything down.
// Needs `npm run build` first; launches no claude. Run: `node tests/drive/example.mjs`.
//
// A refusal (the drive port taken by another run) prints one line naming the port and exits 2,
// with no stack trace: a stack holds the checkout's absolute paths.
// CW_DRIVE_HOLD_MS keeps the app up that long before the shot (used to prove the refusal).
import * as d from './driveApp.mjs'

try {
  await d.run(async ({ page }) => {
    const hold = Number(process.env.CW_DRIVE_HOLD_MS ?? 0)
    if (hold > 0) await page.waitForTimeout(hold)
    await d.shot(page, 'example')
  })
} catch (e) {
  console.error(`[drive] refused: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(2)
}
