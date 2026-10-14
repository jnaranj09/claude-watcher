// Favorites — the copy for a refused star, mapped from the CODE (Electron wraps the message, so
// `includes`), never from `error.message` (design.md Feedback).
import { STORE_WRITE_FAILED } from '../../../shared/schemas/storageHealth'
import { STORE_WRITE_FAILED_COPY } from './storageHealthCopy'
import { FAVORITE_TERMS } from '../copy/terms'

export function favoriteErrorCopy(err: unknown): string {
  const text = err instanceof Error ? err.message : ''
  return text.includes(STORE_WRITE_FAILED) ? STORE_WRITE_FAILED_COPY : FAVORITE_TERMS.updateFailed
}
