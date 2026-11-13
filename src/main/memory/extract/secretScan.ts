// The secret patterns of memory phase 2, one list used twice: in a transcript slice a match
// becomes SECRET_MARK before any model reads it, and a candidate the model returns that matches
// (or holds the mark) is dropped. Pure: no I/O, no log (the text is the operator's conversation).
import { SECRET_MARK } from '../../../shared/schemas/memoryExtract'

/** One RegExp per kind of secret: the addendum's "Secrets" list plus ruling R10's shapes. Every one is
 *  global, so `replace` takes every match; `search` ignores the flag, so `hasSecret` keeps no state
 *  between calls. Exported for its test, which proves every pattern finds a fake secret.
 *
 *  Each pattern stays linear on a long text (a result can be megabytes): a start that can repeat
 *  inside the run that follows it is either fixed-length, bounded, or allowed only at the start of
 *  that run (a lookbehind), so a failed match never rescans the same run from every start. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  // OpenAI-style keys, and Stripe-style live / test keys (R10)
  /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,})/g,
  // GitHub tokens
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  // GitLab personal tokens
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  // Slack tokens
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  // npm tokens (R10)
  /\bnpm_[A-Za-z0-9]{36,}/g,
  // AWS access key ids, long-term `AKIA` and temporary `ASIA` (R10)
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}/g,
  // A PEM private key block or a PGP private key block (R10); one cut before its end line is taken
  // to the end of the text
  /-----BEGIN [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g,
  // A JWT: three base64url parts, the first starting `eyJ`, only at the start of its run
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // A bearer token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  // An authorization header or key: its value, with the scheme word before it (`Basic`, `Digest`…)
  /["']?authorization[A-Za-z0-9_]{0,20}["']?\s{0,5}[:=]\s{0,5}["']?(?:[A-Za-z][A-Za-z0-9-]{0,30}\s{1,5})?[^\s"']{8,}["']?/gi,
  // A URL with `user:password@`, the user possibly empty (`redis://:pass@`, R10)
  /\b[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^\s:/@]*:[^\s/@]+@/g,
  // `curl -u user:pass` / `--user user:pass` (R10); a password of digits only is a uid:gid
  // (`docker run -u 1000:1000`), not a secret
  /(?<![A-Za-z0-9_-])(?:-u|--user)(?:\s{1,5}|=)["']?[^\s:"']{1,100}:\d{0,50}[^\s"'\d][^\s"']{0,200}["']?/g,
  // An API key name (`apiKey`, `api_key`, `api-key`, `x-api-key`, `APIKEY`, R10), then `:` or `=`,
  // then a quoted value of 8+ characters, or an unquoted one of 8+ that holds a digit (so code such
  // as `apiKey: config.apiKey` or `apiKey = getApiKey()` survives)
  /["']?(?:x-)?api[_-]?key[A-Za-z0-9_]{0,20}["']?\s{0,5}[:=]\s{0,5}(?:"[^"\s]{8,}"|'[^'\s]{8,}'|(?=[^\s"'(),;]{0,100}?\d)[^\s"'(),;]{8,})/gi,
  // A secret-looking name, then `:` or `=`, then 8+ characters (`password=`, `"secret": "…"`).
  // No word characters before the name and bounded runs after it: an unbounded run would scan to
  // the end of the text once per name it holds.
  /["']?(?:password|passwd|pwd|secret|token|access_key|private_key)[A-Za-z0-9_]{0,20}["']?\s{0,5}[:=]\s{0,5}["']?[^\s"']{8,}["']?/gi
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
