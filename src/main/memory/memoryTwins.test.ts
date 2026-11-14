// The twin rule (`memoryTwins.ts`): two active specifics in the same workspace and folder whose
// values are the same, character for character, and hold an exact term. `twinIds` answers which
// rows have a twin; `twinsOf` one row's twins, capped, with the rest counted.
import { describe, expect, it } from 'vitest'
import { twinIds, twinsOf, type TwinCandidate } from './memoryTwins'

const c = (id: string, value: string, over: Partial<TwinCandidate> = {}): TwinCandidate => ({
  id,
  workspaceId: 'w1',
  folder: '/work/app',
  key: `key ${id}`,
  value,
  updatedAt: 0,
  ...over
})
const twin = (id: string): { id: string; key: string; updatedAt: number } => ({
  id,
  key: `key ${id}`,
  updatedAt: 0
})
const NONE = { twins: [], more: 0 }

describe('twinIds and twinsOf', () => {
  // 1
  it('two specifics with the same exact value in one workspace and folder name each other', () => {
    const rows = [c('a', '9281'), c('b', '9281'), c('z', '9279')]
    expect(twinIds(rows)).toEqual(['a', 'b'])
    expect([twinsOf(rows, 'a', 5), twinsOf(rows, 'b', 5), twinsOf(rows, 'z', 5)]).toEqual([
      { twins: [twin('b')], more: 0 },
      { twins: [twin('a')], more: 0 },
      NONE
    ])
  })
  // 2 (Review Focus 5)
  it.each([
    ['another folder', c('b', '9281', { folder: '/work/web' })],
    ['no folder against a folder', c('b', '9281', { folder: null })],
    ['another workspace', c('b', '9281', { workspaceId: 'w2' })],
    ['a global item against a workspace one', c('b', '9281', { workspaceId: null })],
    ['another case', c('b', 'abc_1')],
    ['a longer value', c('b', '92810')]
  ])('%s is no twin', (_name, other) => {
    const first = other.value === 'abc_1' ? c('a', 'ABC_1') : c('a', '9281')
    expect([twinIds([first, other]), twinsOf([first, other], 'a', 5)]).toEqual([[], NONE])
  })
  // 3
  it('two global items are twins, and so are two items with no folder', () => {
    const globals = [c('a', '9281', { workspaceId: null }), c('b', '9281', { workspaceId: null })]
    const bare = [c('a', '9281', { folder: null }), c('b', '9281', { folder: null })]
    expect([twinIds(globals), twinIds(bare)]).toEqual([
      ['a', 'b'],
      ['a', 'b']
    ])
  })
  // 4
  it.each(['true', 'main', '80', 'Node 22', 'npm run build'])(
    'a value with no exact term never flags: %s',
    (value) => {
      const rows = [c('a', value), c('b', value)]
      expect([twinIds(rows), twinsOf(rows, 'a', 5)]).toEqual([[], NONE])
    }
  )
  // 5
  it.each(['8080', 'v22.11.0', 'src/main/index.ts', 'BOARD_V2_ENABLED', 'listen on 9281'])(
    'a value that holds an exact term flags: %s',
    (value) => {
      expect(twinIds([c('a', value), c('b', value)])).toEqual(['a', 'b'])
    }
  )
  // 6
  it('a copy under the same key is a twin too', () => {
    const rows = [c('a', '9281', { key: 'API port' }), c('b', '9281', { key: 'API port' })]
    expect(twinsOf(rows, 'a', 5).twins).toEqual([{ id: 'b', key: 'API port', updatedAt: 0 }])
  })
  // 7
  it('three of a kind each name the other two, in the order given', () => {
    const rows = [c('n', '9281'), c('m', '9281'), c('o', '9281')]
    expect(twinsOf(rows, 'm', 5).twins.map((t) => t.id)).toEqual(['n', 'o'])
  })
  // 8
  it('names at most `shown` twins, in the order given, and counts the rest', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => c(id, '9281'))
    expect(twinsOf(rows, 'c', 5)).toEqual({
      twins: ['a', 'b', 'd', 'e', 'f'].map(twin),
      more: 1
    })
  })
  // 9
  it('an unknown id has no twins', () => {
    expect(twinsOf([c('a', '9281'), c('b', '9281')], 'nope', 5)).toEqual(NONE)
  })
})

describe('the cost stays linear in the rows (one group of 3,000 twins)', () => {
  // A row whose `key` counts its reads: a twin entry copies the key, so the reads count the twin
  // entries built. Building every row's full list would read it 3,000 × 2,999 times.
  function counted(n: number): { rows: TwinCandidate[]; reads: () => number } {
    let reads = 0
    const rows = Array.from({ length: n }, (_, i) => {
      const row = c(`r${i}`, 'acme-8080')
      return Object.defineProperty(row, 'key', {
        get: () => {
          reads += 1
          return `key r${i}`
        }
      })
    })
    return { rows, reads: () => reads }
  }
  // 10
  it('twinIds lists every row and builds no twin entry', () => {
    const { rows, reads } = counted(3000)
    const ids = twinIds(rows)
    expect([ids.length, ids[0], ids[2999], reads()]).toEqual([3000, 'r0', 'r2999', 0])
  })
  // 11
  it('twinsOf builds only the entries it names and counts the rest', () => {
    const { rows, reads } = counted(3000)
    const out = twinsOf(rows, 'r1500', 5)
    expect([out.twins.map((t) => t.id), out.more, reads()]).toEqual([
      ['r0', 'r1', 'r2', 'r3', 'r4'],
      2994,
      5
    ])
  })
})
