// Fixture for the launchSession.*.test.ts files: the production-shaped spawn factory. Never
// shipped.

// Story 6.2 — the production-shaped spawn FACTORY fixture: mirrors index.ts `rawClaudeSpawn`
// (the `$SHELL -l -c` wrapper composing `claude --session-id '<uuid>'`, single-quoted).
export function shellClaudeSpawn(sessionId: string): {
  file: string
  args: string[]
  env: Record<string, string>
} {
  return {
    file: '/bin/bash',
    args: ['-l', '-c', `claude --session-id '${sessionId}'`],
    env: { PATH: '/usr/bin' }
  }
}
