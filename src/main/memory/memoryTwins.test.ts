// The twin rule (`memoryTwins.ts`): two active specifics in the same workspace and folder whose
// values are the same, character for character, and hold an exact term.
import { describe, expect, it } from 'vitest'
import { twinsById, type TwinCandidate } from './memoryTwins'

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

describe('twinsById', () => {
  // 1
  it('two specifics with the same exact value in one workspace and folder name each other', () => {
    expect([...twinsById([c('a', '9281'), c('b', '9281'), c('z', '9279')])]).toEqual([
      ['a', [twin('b')]],
      ['b', [twin('a')]]
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
    expect(twinsById([first, other]).size).toBe(0)
  })
  // 3
  it('two global items are twins, and so are two items with no folder', () => {
    const globals = [c('a', '9281', { workspaceId: null }), c('b', '9281', { workspaceId: null })]
    const bare = [c('a', '9281', { folder: null }), c('b', '9281', { folder: null })]
    expect([twinsById(globals).size, twinsById(bare).size]).toEqual([2, 2])
  })
  // 4
  it.each(['true', 'main', '80', 'Node 22', 'npm run build'])(
    'a value with no exact term never flags: %s',
    (value) => {
      expect(twinsById([c('a', value), c('b', value)]).size).toBe(0)
    }
  )
  // 5
  it.each(['8080', 'v22.11.0', 'src/main/index.ts', 'BOARD_V2_ENABLED', 'listen on 9281'])(
    'a value that holds an exact term flags: %s',
    (value) => {
      expect(twinsById([c('a', value), c('b', value)]).size).toBe(2)
    }
  )
  // 6
  it('a copy under the same key is a twin too', () => {
    const rows = [c('a', '9281', { key: 'API port' }), c('b', '9281', { key: 'API port' })]
    expect(twinsById(rows).get('a')).toEqual([{ id: 'b', key: 'API port', updatedAt: 0 }])
  })
  // 7
  it('three of a kind each name the other two, in the order given', () => {
    const got = twinsById([c('n', '9281'), c('m', '9281'), c('o', '9281')])
    expect(got.get('m')?.map((t) => t.id)).toEqual(['n', 'o'])
  })
})
