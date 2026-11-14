// Synthetic memory items and labelled prompts for the recall-quality test
// (`src/main/memory/recallQuality.test.ts`). Every name, host and value is made up. Never shipped.
// The seed order and every word decide the numbers that test pins: change them only together.
import type { MemoryText } from '../shared/schemas/memory'

/** One saved item, in the session's workspace unless `where` says otherwise. */
export interface RecallSeed {
  ref: string
  text: MemoryText
  /** `global`: no workspace. `other`: another workspace, never in scope. */
  where?: 'global' | 'other'
  stale?: true
  pinned?: true
}

/** One operator prompt. `expect` is the `ref` that must be in the recall block, or null when
 *  nothing saved fits and no block may be added. */
export interface RecallCase {
  name: string
  prompt: string
  expect: string | null
}

const specific = (ref: string, key: string, value: string): RecallSeed => ({
  ref,
  text: { kind: 'specific', key, value }
})
const fact = (ref: string, title: string, body: string): RecallSeed => ({
  ref,
  text: { kind: 'fact', title, body }
})

/** Saved in this order, one second apart: a later seed is newer. */
export const RECALL_SEEDS: readonly RecallSeed[] = [
  specific('api-port', 'API port', '9281'),
  specific('hook-port', 'hook port', '9279'),
  specific('dev-port', 'dev server port', '3000'),
  specific('metrics-port', 'metrics port', '9464'),
  specific('staging-api-host', 'staging API host', 'api.staging.acme.test'),
  specific('staging-db-host', 'staging db host', 'db-staging-2.acme.test'),
  specific('prod-db-host', 'prod db host', 'db-prod-1.acme.test'),
  specific('node-version', 'node version', 'v22.11.0'),
  specific('claude-floor', 'minimum claude version', '2.1.323'),
  specific('electron-version', 'electron version', '44.0.2'),
  specific('release-tag', 'last release tag', 'v2.3.1'),
  specific('build-command', 'build command', 'npm run build:dir'),
  specific('smoke-command', 'smoke command', 'npm run smoke:packaged'),
  specific('lint-command', 'lint fix command', 'npx eslint --fix src/renderer'),
  specific('board-flag', 'feature flag for new board', 'BOARD_V2_ENABLED'),
  specific('retry-var', 'retry env var', 'ACME_MAX_RETRIES'),
  specific('timeout-error', 'timeout error text', 'ERR_CONN_RESET at upstream'),
  specific('log-folder', 'log folder', '/var/log/acme/api'),
  specific('main-entry', 'main entry file', 'src/main/index.ts'),
  specific('preload-entry', 'preload entry file', 'src/preload/index.ts'),
  specific('ci-image', 'CI runner image', 'ubuntu-22.04'),
  specific('grafana-id', 'grafana dashboard id', 'dash-7f3a'),
  specific('artifact-bucket', 'S3 bucket for artifacts', 'acme-build-artifacts'),
  specific('retry-queue', 'queue name', 'orders.retry.v2'),
  specific('gateway-port', 'api gateway port', '8443'),
  specific('debug-port', 'api debug port', '9229'),
  specific('health-path', 'api health path', '/healthz'),
  specific('admin-port', 'api admin port', '9901'),
  fact(
    'migrations-first',
    'Migrations run first',
    'The deploy script runs db/migrate before the API restarts.'
  ),
  fact(
    'blue-green',
    'Staging deploy uses blue green',
    'The staging deploy switches traffic only after the smoke test passes.'
  ),
  fact(
    'flaky-terminal',
    'Flaky terminal test',
    'tests/e2e/terminal.e2e.ts fails when the window is under 1000 px wide.'
  ),
  fact(
    'rebuild-pty',
    'Rebuild node-pty after an Electron bump',
    'Run npm run rebuild after changing the Electron version, or the terminal will not start.'
  ),
  fact(
    'cache-key',
    'Cache key includes the lockfile',
    'CI restores node_modules by the hash of package-lock.json.'
  ),
  fact(
    'magic-link',
    'Login uses a magic link',
    'The login page sends a one-time link; there is no password form.'
  ),
  fact(
    'order-retries',
    'Orders worker retries three times',
    'A failed order goes to orders.retry.v2 and is retried 3 times with backoff.'
  ),
  fact(
    'generated-docs',
    'Docs are generated',
    'API docs come from the OpenAPI file; never edit docs/api by hand.'
  ),
  fact(
    'search-limit',
    'Rate limit on the search endpoint',
    'The search endpoint allows 30 requests per minute per token.'
  ),
  { ...specific('vpn-host', 'company VPN host', 'vpn.acme.test'), where: 'global' },
  { ...specific('other-api-port', 'API port', '9555'), where: 'other' },
  { ...specific('old-api-port', 'old API port', '9180'), stale: true },
  { ...specific('primary-region', 'primary region', 'eu-central-7'), pinned: true }
]

const hit = (name: string, prompt: string, expect: string): RecallCase => ({ name, prompt, expect })
const silent = (name: string, prompt: string): RecallCase => ({ name, prompt, expect: null })

export const RECALL_CASES: readonly RecallCase[] = [
  // The prompt names the exact value.
  hit('exact port', 'is 9281 still the right port?', 'api-port'),
  hit('exact port in a sentence', 'the hook listener is on 9279, right?', 'hook-port'),
  hit(
    'exact host',
    'connect to db-staging-2.acme.test and check the migrations table',
    'staging-db-host'
  ),
  hit('exact path', 'open src/main/index.ts and add the handler', 'main-entry'),
  hit('exact error name', 'I got ERR_CONN_RESET again', 'timeout-error'),
  hit('exact env var', 'set ACME_MAX_RETRIES to 5 for this run', 'retry-var'),
  hit('exact tag beside a near one', 'last release was v2.3.1 or v2.3.2?', 'release-tag'),
  hit('exact version', 'we need claude 2.1.323 at least, correct?', 'claude-floor'),
  // The prompt names the thing in the key's or the fact's own words.
  hit('key words, four items share them', 'what port does the API listen on?', 'api-port'),
  hit('key words', 'which node version do we build with', 'node-version'),
  hit('key words, a two-letter one dropped', "what's the staging db host?", 'staging-db-host'),
  hit('key words of an error', 'what was the error text for the upstream timeout', 'timeout-error'),
  hit('words of a command', 'how do I run the packaged smoke test', 'smoke-command'),
  hit('words of a flag', 'which flag turns on the new board', 'board-flag'),
  hit('words of a bucket', 'which bucket do build artifacts go to', 'artifact-bucket'),
  hit('words of a queue', 'the orders retry queue name', 'retry-queue'),
  hit('words of a fact', 'why does the terminal e2e test fail on small windows', 'flaky-terminal'),
  hit('a fact as a question', 'do migrations run before the api restarts?', 'migrations-first'),
  hit('words of a limit', "what's the rate limit for search", 'search-limit'),
  hit('words of a rule', 'can I edit the api docs by hand?', 'generated-docs'),
  hit('words of a dashboard', 'grafana dashboard for the api', 'grafana-id'),
  hit('words of a path', 'what is the health check path', 'health-path'),
  hit('a global item', 'vpn host?', 'vpn-host'),
  hit(
    'another form of a key word, four items share the rest',
    'the debugger port for the api process',
    'debug-port'
  ),
  // Near misses: another word form, another word, one word only, a version written another way.
  hit('plural of the key word', 'where do the api logs go', 'log-folder'),
  hit('plural and a two-letter word', 'which image do the CI runners use', 'ci-image'),
  hit('one key word only', 'how does login work', 'magic-link'),
  hit('one key word and a partial version', 'bump electron to the latest 44.x', 'electron-version'),
  hit('version without its v', 'check node 22.11.0 is installed', 'node-version'),
  hit(
    'other words for the same thing',
    'what address is the production database on',
    'prod-db-host'
  ),
  // Nothing saved fits.
  silent('no terms', 'go ahead'),
  silent('a short yes', 'yes, do it'),
  silent('thanks', 'thanks, that works'),
  silent('unrelated work', 'rename the variable to something clearer'),
  silent('unrelated file', 'fix the typo in the README title'),
  silent('unrelated question', 'why is the sidebar animation janky'),
  silent('unrelated styling', 'make the header sticky on scroll'),
  silent('one shared word', 'add a unit test for the date formatter'),
  silent('one shared word each with four items', 'run the tests for the search page'),
  silent('one shared word of a fact', 'explain what a magic number is'),
  silent('shared words spread over items', 'the api build failed on CI again'),
  silent('a shorter number', 'is 928 a valid exit code'),
  silent('a number one off', 'listen on 9280 instead'),
  silent('a shorter version', 'version 2.1.32 is too old'),
  silent('a host one character longer', 'look at db-staging-21.acme.test'),
  silent('a value of another workspace', 'is 9555 taken?'),
  silent('a stale value', 'the old value 9180 was wrong'),
  silent('a pinned value, already in the index', 'which region is primary, eu-central-7?'),
  silent('two shared words about another thing', 'use port 8080 for the mock server'),
  silent('a bare number that is also a saved value', 'bump the request timeout to 3000 ms')
]
