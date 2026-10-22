// Check that the installed claude still writes the text the app reads as an artifact watch.
//
//   npm run test:claude-drift
//
// Run it after a claude upgrade, like `npm run test:mod` (local only: CI has no claude). The Stop
// hook's `background_tasks` drops claude's `ambient` flag, so `hooks/backgroundTasks.ts` knows an
// artifact watch only by its description, `live updates for artifact <url> (<why>)` (claude
// 2.1.308). If claude rewords it, every session with a watch shows Working again; this fails
// first. Exit 0 = template found, 1 = not found (`code=claude_drift_*` on stderr).
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'

// The template as claude's minified source holds it: `live updates for artifact ${e} (${…`.
const WATCH_TEMPLATE = /`live updates for artifact \$\{[\w$]+\} \(\$\{/

function claudeBinary() {
  try {
    const onPath = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
    return realpathSync(onPath)
  } catch {
    process.stderr.write('code=claude_drift_no_claude (claude is not on PATH)\n')
    process.exit(1)
  }
}

const binary = claudeBinary()
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
// latin1 keeps every byte one character, so the ASCII template matches inside the binary.
if (!WATCH_TEMPLATE.test(readFileSync(binary, 'latin1'))) {
  process.stderr.write(
    `code=claude_drift_watch_text_changed (${version}): claude no longer writes ` +
      '"live updates for artifact <url> (…)". Probe a Stop payload with an artifact watch and ' +
      'update ARTIFACT_WATCH in src/main/hooks/backgroundTasks.ts.\n'
  )
  process.exit(1)
}
process.stdout.write(`ok: ${version} still describes an artifact watch the way the app reads it\n`)
