// The secret patterns of memory phase 2, one list used twice: in a transcript slice a match
// becomes SECRET_MARK before any model reads it, and a candidate the model returns that matches
// (or holds the mark) is dropped. Pure: no I/O, no log (the text is the operator's conversation).
import { SECRET_MARK } from '../../../shared/schemas/memoryExtract'

/** One RegExp per kind of secret (addendum "Secrets"). Every one is global, so `replace` takes
 *  every match; `search` ignores the flag, so `hasSecret` keeps no state between calls. Exported
 *  for its test, which proves every pattern finds a fake secret. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  // OpenAI-style keys
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  // GitHub tokens
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  // GitLab personal tokens
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  // Slack tokens
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}/g,
  // A PEM private key block; one cut before its end line is taken to the end of the text
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  // A JWT: three base64url parts, the first starting `eyJ`
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // A bearer token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  // A URL with `user:password@`
  /\b[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^\s:/@]+:[^\s/@]+@/g,
  // A secret-looking name, then `:` or `=`, then 8+ characters (`password=`, `"api_key": "…"`).
  // No word characters before the name and bounded runs after it: an unbounded run would scan to
  // the end of the text once per name it holds, and a result can be megabytes long.
  /["']?(?:password|passwd|pwd|secret|token|api_key|access_key|private_key|authorization)[A-Za-z0-9_]{0,20}["']?\s{0,5}[:=]\s{0,5}["']?[^\s"']{8,}["']?/gi
]

/** The text with every match of every pattern replaced by SECRET_MARK. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, SECRET_MARK), text)
}

/** A pattern matches, or the text already holds SECRET_MARK. */
export function hasSecret(text: string): boolean {
  return (
    text.includes(SECRET_MARK) || SECRET_PATTERNS.some((pattern) => text.search(pattern) !== -1)
  )
}
