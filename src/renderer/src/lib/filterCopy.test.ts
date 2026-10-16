import { describe, it, expect } from 'vitest'
import {
  folderName,
  formatDay,
  removeFilterLabel,
  timePickRowLabel,
  timePillText
} from './filterCopy'

const OPTS = { weekday: 'short', month: 'short', day: 'numeric' } as const
const day14 = new Date(2026, 9, 14).toLocaleDateString(undefined, OPTS)

describe('filter pill copy', () => {
  it('presets read as a phrase', () => {
    expect(timePillText('launched', { kind: 'preset', range: 'today' })).toBe('Launched today')
    expect(timePillText('ended', { kind: 'preset', range: '7d' })).toBe('Ended in last 7 days')
    expect(timePillText('launched', { kind: 'preset', range: '30d' })).toBe(
      'Launched in last 30 days'
    )
  })

  it('a picked day uses the operator locale', () => {
    expect(formatDay('2026-10-14')).toBe(day14)
    expect(timePillText('launched', { kind: 'on', day: '2026-10-14' })).toBe(`Launched on ${day14}`)
    expect(timePillText('ended', { kind: 'since', day: '2026-10-14' })).toBe(`Ended since ${day14}`)
  })

  it('the day rows name the current pick, or the plain action', () => {
    expect(timePickRowLabel({ kind: 'preset', range: 'today' }, 'on')).toBe('On a day')
    expect(timePickRowLabel({ kind: 'on', day: '2026-10-14' }, 'on')).toBe(`On ${day14}`)
    expect(timePickRowLabel({ kind: 'on', day: '2026-10-14' }, 'since')).toBe('Since a day')
  })

  it('a folder shows its last segment', () => {
    expect(folderName('/home/u/claude-watcher/')).toBe('claude-watcher')
    expect(folderName('/')).toBe('/')
  })

  it('× says which filter it removes', () => {
    expect(removeFilterLabel('folder')).toBe('Remove the folder filter')
  })
})
