// Synthetic memory items, each placed in a context, seven session contexts and the items each
// session should be told about, for the context-index test
// (`src/main/memory/contextIndexQuality.test.ts`). Every name, host and value is made up. Never
// shipped. The seed order and every word decide the numbers that test pins: change them only
// together. The recall seeds are reused by reference; `memoryRecallCases.ts` is not edited. The
// fake token is built by joining strings, so no scanner flags the public repo.
import type { MemoryItem, MemoryText } from '../shared/schemas/memory'
import type { MemorySessionMeta } from '../main/memory/memoryTools'
import { RECALL_SEEDS } from './memoryRecallCases'

const FAKE_TOKEN = 'gh' + 'p_0123456789abcdefghijABCD'

export type ContextSessionName =
  | 'bare'
  | 'goalA'
  | 'goalB'
  | 'root'
  | 'package'
  | 'template'
  | 'empty'
export interface ContextSeed {
  ref: string
  text: MemoryText
  where?: 'global' | 'other'
  stale?: true
  pinned?: true
  /** Written by the operator (default: a save, origin `extract`). */
  operator?: true
  /** Saved by session `gone`, which the test then marks deleted. */
  sessionDeleted?: true
  check?: string
  /** Fields left out are null or empty. */
  meta: Partial<MemoryItem['meta']>
}
export interface ContextCase {
  session: ContextSessionName
  expect: string
  /** `list`: in the section. `either`: in the section or in the recall block of `prompt`. */
  how: 'list' | 'either'
  prompt?: string
}
export interface ContextSession {
  name: ContextSessionName
  meta: MemorySessionMeta
}

const specific = (
  ref: string,
  key: string,
  value: string,
  meta: Partial<MemoryItem['meta']>
): ContextSeed => ({ ref, text: { kind: 'specific', key, value }, meta })
const two = (n: number): string => String(n).padStart(2, '0')
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

/** `crowd-<nn>`: sixty keys of one crowded folder, two goals, one common tag and template. */
function crowdMeta(n: number): Partial<MemoryItem['meta']> {
  const goal =
    n <= 3
      ? { goalId: 'gA', taskIds: ['tA1'] }
      : n <= 8
        ? { goalId: 'gA' }
        : n <= 10
          ? { goalId: 'gB', taskIds: ['tB1'] }
          : n <= 16
            ? { goalId: 'gB' }
            : {}
  return {
    folder: '/work/shop',
    ...goal,
    ...(n <= 50 ? { tagIds: ['tCommon'] } : {}),
    ...(n <= 40 ? { templateId: 'tplCommon' } : {})
  }
}

const FACT_PLACES: readonly Partial<MemoryItem['meta']>[] = [
  { folder: '/work/shop' },
  { folder: '/work/shop' },
  { folder: '/work/shop', goalId: 'gA' },
  { folder: '/work/mono' },
  { folder: '/work/mono' },
  { folder: '/work/app' },
  {},
  {}
]

/** Saved in this order, one second apart: a later seed is newer. */
export const CONTEXT_SEEDS: readonly ContextSeed[] = [
  ...RECALL_SEEDS.map(
    (s): ContextSeed => ({
      ref: s.ref,
      text: s.text,
      ...(s.where === undefined ? {} : { where: s.where }),
      ...(s.stale === undefined ? {} : { stale: s.stale }),
      ...(s.pinned === undefined ? {} : { pinned: s.pinned }),
      meta: { folder: '/work/app' }
    })
  ),
  ...range(1, 60).map((n) =>
    specific(`crowd-${two(n)}`, `shop setting ${two(n)}`, `shop-value-${two(n)}`, crowdMeta(n))
  ),
  ...range(1, 3).map((n) =>
    specific(`mono-root-${n}`, `mono root key ${n}`, `mono-root-${n}`, { folder: '/work/mono' })
  ),
  ...range(1, 5).map((n) =>
    specific(`mono-api-${n}`, `mono api key ${n}`, `mono-api-${n}`, {
      folder: '/work/mono/pkg/api',
      ...(n <= 2 ? { tagIds: ['tRare'] } : {})
    })
  ),
  ...range(1, 4).map((n) =>
    specific(`mono-web-${n}`, `mono web key ${n}`, `mono-web-${n}`, {
      folder: '/work/mono/pkg/web'
    })
  ),
  ...range(1, 3).map((n) =>
    specific(`mono-cli-${n}`, `mono cli key ${n}`, `mono-cli-${n}`, {
      folder: '/work/mono/pkg/cli'
    })
  ),
  ...range(1, 2).map((n) =>
    specific(`tag-rare-${n}`, `rare host ${n}`, `rare-host-${n}.acme.test`, {
      folder: '/work/elsewhere',
      tagIds: ['tRare']
    })
  ),
  ...range(1, 3).map((n) =>
    specific(`tpl-rare-${n}`, `rare template key ${n}`, `tpl-rare-${n}`, {
      folder: '/work/elsewhere',
      templateId: 'tplRare'
    })
  ),
  ...range(1, 6).map(
    (n): ContextSeed => ({
      ...specific(`ws-${n}`, `workspace wide key ${n}`, `ws-value-${n}`, {}),
      operator: true,
      ...(n === 6 ? { where: 'global' as const } : {})
    })
  ),
  ...range(1, 2).map(
    (n): ContextSeed => ({
      ...specific(`goal-only-${n}`, `goal only key ${n}`, `goal-only-${n}`, { goalId: 'gA' }),
      operator: true
    })
  ),
  ...range(1, 2).map(
    (n): ContextSeed => ({
      ...specific(`gone-${n}`, `gone session key ${n}`, `gone-${n}`, { folder: '/work/shop' }),
      sessionDeleted: true
    })
  ),
  ...FACT_PLACES.map(
    (meta, i): ContextSeed => ({
      ref: `fact-${i + 1}`,
      text: {
        kind: 'fact',
        title: `Context fact ${i + 1}`,
        body: `Body of context fact ${i + 1}, long enough to be cut.`
      },
      meta
    })
  ),
  specific('secret-value', 'deploy hook', FAKE_TOKEN, {
    folder: '/work/shop',
    goalId: 'gA'
  }),
  specific('secret-key', 'db password', 'hunter2', { folder: '/work/shop', goalId: 'gA' }),
  specific('private-value', 'vault note', 'see <private>x9k2</private> here', {
    folder: '/work/shop',
    goalId: 'gA'
  })
]

/** Values the section must never print. */
export const CONTEXT_HIDDEN: readonly string[] = [FAKE_TOKEN, 'hunter2', 'x9k2']

const session = (
  name: ContextSessionName,
  folder: string,
  over: Partial<MemorySessionMeta> = {}
): ContextSession => ({
  name,
  meta: {
    workspaceId: 'w1',
    folder,
    sessionName: 'context quality',
    tagIds: [],
    templateId: null,
    goalId: null,
    taskIds: [],
    ...over
  }
})

export const CONTEXT_SESSIONS: readonly ContextSession[] = [
  session('bare', '/work/app'),
  session('goalA', '/work/shop', {
    goalId: 'gA',
    taskIds: ['tA1'],
    tagIds: ['tCommon'],
    templateId: 'tplCommon'
  }),
  session('goalB', '/work/shop', { goalId: 'gB', taskIds: ['tB1'], tagIds: ['tCommon'] }),
  session('root', '/work/mono'),
  session('package', '/work/mono/pkg/api', { tagIds: ['tRare'] }),
  session('template', '/work/tpl-only', { templateId: 'tplRare' }),
  session('empty', '/work/empty')
]

const listed = (name: ContextSessionName, refs: readonly string[]): ContextCase[] =>
  refs.map((expect) => ({ session: name, expect, how: 'list' }))

export const CONTEXT_CASES: readonly ContextCase[] = [
  ...listed('bare', [
    'api-port',
    'staging-db-host',
    'build-command',
    'blue-green',
    'vpn-host',
    'fact-6',
    'ws-1'
  ]),
  {
    session: 'bare',
    expect: 'tag-rare-2',
    how: 'either',
    prompt: 'is rare-host-2.acme.test still up?'
  },
  ...listed('goalA', ['crowd-01', 'crowd-05', 'goal-only-1', 'fact-3', 'crowd-60', 'ws-2']),
  ...listed('goalB', ['crowd-09', 'crowd-12', 'crowd-60', 'ws-2']),
  ...listed('root', ['mono-root-1', 'mono-api-3', 'fact-4', 'ws-3']),
  ...listed('package', ['mono-api-3', 'mono-root-2', 'tag-rare-1', 'ws-3']),
  ...listed('template', ['tpl-rare-1', 'ws-4']),
  ...listed('empty', ['ws-1', 'ws-6', 'fact-7'])
]

/** Per session: refs that belong to another goal of the same folder; a listed one is a wrong
 *  line. */
export const CONTEXT_WRONG: Record<ContextSessionName, readonly string[]> = {
  bare: [],
  goalA: range(9, 16).map((n) => `crowd-${two(n)}`),
  goalB: [
    ...range(1, 8).map((n) => `crowd-${two(n)}`),
    'goal-only-1',
    'goal-only-2',
    'fact-3',
    'secret-value',
    'secret-key',
    'private-value'
  ],
  root: [],
  package: [],
  template: [],
  empty: []
}
