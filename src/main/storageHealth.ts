// Storage health — ONE place that collects the store files that could not be read or written
// (UX-06, UX-07). Every store reports into it through its `report` option; main pushes each
// change to the renderer, which draws the notice. Pure: no electron, no IO.
//
// A (store, code) pair is recorded ONCE: a full disk fails every write, and the notice must say
// it once, not grow a line per write.

import type { StorageHealth, StorageProblemCode, StoreName } from '../shared/schemas/storageHealth'

export interface StorageHealthState {
  get(): StorageHealth
  report(store: StoreName, code: StorageProblemCode): void
  /** The reporter a store takes as its `report` option. */
  reporterFor(store: StoreName): (code: StorageProblemCode) => void
}

export function createStorageHealth(opts: {
  onChange: (health: StorageHealth) => void
}): StorageHealthState {
  const problems: StorageHealth['problems'] = []

  function report(store: StoreName, code: StorageProblemCode): void {
    if (problems.some((p) => p.store === store && p.code === code)) return
    problems.push({ store, code })
    opts.onChange({ problems: [...problems] })
  }

  return {
    get: () => ({ problems: [...problems] }),
    report,
    reporterFor: (store) => (code) => report(store, code)
  }
}
