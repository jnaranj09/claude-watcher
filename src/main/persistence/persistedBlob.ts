// The persisted-blob pattern shared by settings.ts and templates.ts: read → parse → on corrupt
// back the file up and start from a fallback (never crash on a bad prefs file; zod-boundaries.md
// "persisted file read" row). Pure: the electron-store factory lives in electronBlobStore.ts so
// this module (and every store built on it) stays importable in node unit tests.

export interface PersistedBlobStore<T> {
  read(): unknown
  write(value: T): void
  backup(): void
}

export function createInMemoryBlobStore<T>(): PersistedBlobStore<T> {
  return { read: () => undefined, write: () => {}, backup: () => {} }
}

export type PersistedBlobProblem = 'read_failed' | 'backup_failed' | 'corrupt_reset_to_defaults'

export interface LoadPersistedOptions<T> {
  blobStore: PersistedBlobStore<T>
  /** Throws on bad input (a Zod `parse`). The thrown error is NEVER logged — it carries the value. */
  parse: (raw: unknown) => T
  fallback: () => T
  /** The caller formats the log line — it owns the prefix, e.g.
   *  `[<owner>][<store>] code=<store>_${code}`. */
  onProblem: (code: PersistedBlobProblem) => void
}

export function loadPersistedOrReset<T>(options: LoadPersistedOptions<T>): T {
  let raw: unknown
  try {
    raw = options.blobStore.read()
  } catch {
    options.onProblem('read_failed')
    return options.fallback()
  }
  if (raw === undefined) return options.fallback()
  try {
    return options.parse(raw)
  } catch {
    try {
      options.blobStore.backup()
    } catch {
      options.onProblem('backup_failed')
    }
    options.onProblem('corrupt_reset_to_defaults')
    return options.fallback()
  }
}
