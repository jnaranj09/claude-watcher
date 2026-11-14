// The `watcher-memory` mod's four routes are served by the BUILT app on its hook listener (memory
// phase 3): each sits behind the memory bearer, so a request with none is 401 before its body is
// read, and a path under `/mod/memory/` that is not one of them is 404. No claude and no model
// call: the routes are called directly. Launch, teardown and the e2e profile live in ./fixtures.ts.
import { E2E_PROFILE } from '../../src/main/profile'
import { test, expect } from './fixtures'

test('the memory mod routes are served by the app: no bearer is 401, an unknown one is 404', async ({
  page
}) => {
  // The fixture's `page` is the app's own window, so the window feed (and its hook listener) is up.
  await expect(page.locator('body')).toBeVisible()
  const post = (path: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${E2E_PROFILE.hookPort}${path}`, { method: 'POST', body: '{}' })
  expect([
    (await post('/mod/memory/index')).status,
    (await post('/mod/memory/recall')).status,
    (await post('/mod/memory/at-use')).status,
    (await post('/mod/memory/remember')).status,
    (await post('/mod/memory/nope')).status
  ]).toEqual([401, 401, 401, 401, 404])
})
