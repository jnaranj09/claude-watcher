// Where the session engine meets memory's save points (memory phase 2, Task 11): which hook event
// is a save point, what a removal means for memory, and the removal chokepoint's one order.
import { describe, expect, it } from 'vitest'
import { runRemoval, savePointForHook, savePointForRemoval } from './memorySavePoints'

describe('save points', () => {
  it('a Stop is a stop; a kept SessionEnd with reason clear is a clear; anything else is nothing', () => {
    expect(savePointForHook({ hook_event_name: 'Stop' }, false)).toBe('stop')
    expect(savePointForHook({ hook_event_name: 'SessionEnd', reason: 'clear' }, true)).toBe('clear')
    expect(savePointForHook({ hook_event_name: 'SessionEnd', reason: 'clear' }, false)).toBeNull()
    expect(savePointForHook({ hook_event_name: 'SessionEnd', reason: 'other' }, true)).toBeNull()
    expect(savePointForHook({ hook_event_name: 'StopFailure' }, false)).toBeNull()
  })

  it('an archive ends the session for memory and a delete forgets it', () => {
    expect(savePointForRemoval('archive')).toBe('ended')
    expect(savePointForRemoval('delete')).toBe('forget')
  })
})

describe('the removal chokepoint', () => {
  it('a removal of a card that already left runs no memory step', () => {
    const order: string[] = []
    runRemoval({
      onBoard: false,
      recordRemoval: () => order.push('record'),
      memorySavePoint: () => order.push('memory'),
      dropCardState: () => order.push('card'),
      removeFromBoard: () => order.push('board')
    })
    expect(order).toEqual(['record', 'card', 'board'])
  })

  it('a removal runs the record, then memory, then the card state, then the board', () => {
    const order: string[] = []
    runRemoval({
      onBoard: true,
      recordRemoval: () => order.push('record'),
      memorySavePoint: () => order.push('memory'),
      dropCardState: () => order.push('card'),
      removeFromBoard: () => order.push('board')
    })
    expect(order).toEqual(['record', 'memory', 'card', 'board'])
  })
})
