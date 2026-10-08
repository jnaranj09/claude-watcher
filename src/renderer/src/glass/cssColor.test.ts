import { describe, expect, it } from 'vitest'
import { parseRgb } from './cssColor'
describe('parseRgb', () => {
  it('reads computed rgb()/rgba()', () => {
    expect(parseRgb('rgb(255, 207, 41)')).toEqual([1, 207 / 255, 41 / 255])
    expect(parseRgb('rgba(137, 180, 250, 0.5)')).toEqual([137 / 255, 180 / 255, 250 / 255])
  })
  it.each(['', 'red', '#ffcf29', 'rgb(1,2)'])('rejects %s', (v) => expect(parseRgb(v)).toBeNull())
})
