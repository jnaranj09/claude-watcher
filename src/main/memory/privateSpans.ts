// The private tag: text the operator wraps in `<private>` and `</private>` is never read by a
// memory save and never matched by recall. The tag is read as `spanTag` reads any tag: any case and
// spacing, with or without its `>`; an opening tag that never closes takes the rest of the text, a
// closing tag alone is cut, and a longer name (`<private-key>`, `<privately>`) is no tag.
// Callers: the slice cleaner (`extract/sliceCleaner.ts`, each span becomes the secret mark), the
// command capture (`extract/commandCapture.ts`, a command that holds the tag is left out),
// `/remember` (`rememberText.ts`, a text that holds the tag is refused as a secret is) and recall
// (`memoryRecall.ts`, spans cut before the terms).
// Pure; logs nothing (the text is the operator's conversation).
import { cutSpans, spanTag } from './tagSpans'

const PRIVATE_TAG = spanTag('private')

/** `text` with every private span replaced by `put` (`cutSpans`). */
export function cutPrivate(text: string, put: string): string {
  return cutSpans(text, PRIVATE_TAG, put)
}

/** The text holds a private tag, opening or closing. `search` ignores the global flag, so no state
 *  is kept between calls. */
export function holdsPrivate(text: string): boolean {
  return text.search(PRIVATE_TAG) !== -1
}
