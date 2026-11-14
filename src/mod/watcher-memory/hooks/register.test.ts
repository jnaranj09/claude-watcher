// Engine test for the memory mod, run by `claude plugin test` (npm run test:mod, local only). The
// test's own hooks sit beneath the mod and stand for the engine. Today the mod hooks no event, so
// what the engine is handed comes back as it went in, and nothing is sent.
import { test, expect } from 'claude-code/testing'

test('hooks no event: a prompt context passes untouched and nothing is sent', async ($, on) => {
  const seen: unknown[] = []
  const sent: unknown[] = []
  on('prompt.context', (_$, e) => {
    seen.push(e)
    return { blocks: e.blocks }
  })
  on('http.fetch', (_$, e) => {
    sent.push(e)
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  const input = { blocks: [], instructionFiles: [] }
  await $.prompt.context(input)
  expect([seen, sent]).toEqual([[input], []])
})
