// Storage health rules the mutation run (StrykerJS) showed no test pinned: a report keeps its
// problems, and one problem per store and code fits.
import { describe, it, expect } from 'vitest'
import {
  StorageHealthSchema,
  StorageProblemSchema,
  STORE_NAMES,
  STORAGE_PROBLEM_CODES
} from './storageHealth'

describe('StorageHealthSchema', () => {
  it('keeps the store and code of a problem', () => {
    const problem = { store: 'templates', code: 'write_failed' }
    expect(StorageProblemSchema.parse(problem)).toEqual(problem)
  })

  it('keeps the problems of a report', () => {
    const report = { problems: [{ store: 'templates', code: 'write_failed' }] }
    expect(StorageHealthSchema.parse(report)).toEqual(report)
  })

  it('accepts one problem for every store and code', () => {
    const problems = STORE_NAMES.flatMap((store) =>
      STORAGE_PROBLEM_CODES.map((code) => ({ store, code }))
    )
    expect(StorageHealthSchema.safeParse({ problems }).success).toBe(true)
  })
})
