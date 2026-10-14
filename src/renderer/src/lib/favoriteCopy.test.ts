import { describe, it, expect } from 'vitest'
import { favoriteErrorCopy } from './favoriteCopy'
import { STORE_WRITE_FAILED_COPY } from './storageHealthCopy'

describe('favoriteErrorCopy', () => {
  it('maps a refused disk write to the store copy', () => {
    const wrapped = new Error("Error invoking remote method 'x': Error: store_write_failed")
    expect(favoriteErrorCopy(wrapped)).toBe(STORE_WRITE_FAILED_COPY)
  })
  it('anything else reads as could not update', () => {
    expect(favoriteErrorCopy(new Error('template_not_found'))).toBe('Could not update pin.')
    expect(favoriteErrorCopy('weird')).toBe('Could not update pin.')
  })
})
