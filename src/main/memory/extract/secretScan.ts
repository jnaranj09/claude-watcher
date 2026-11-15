// The secret patterns of memory phase 2, one list used twice: in a transcript slice a match
// becomes SECRET_MARK before any model reads it, and a candidate the model returns that matches
// (or holds the mark) is dropped. Pure: no I/O, no log (the text is the operator's conversation).
import { SECRET_MARK } from '../../../shared/schemas/memoryExtract'

/** The names a secret goes by, as the last of `SECRET_PATTERNS` and `namesSecret` read them. */
const SECRET_NAME_WORDS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'access_key',
  'private_key'
] as const

/** One RegExp per kind of secret: the addendum's "Secrets" list plus rulings R10 and R14. Every
 *  one is global, so `replace` takes every match; `search` ignores the flag, so `hasSecret` keeps no
 *  state between calls. Exported for its test, which proves every pattern finds a fake secret.
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
  // `curl -u user:pass`, `-uuser:pass`, `--user user:pass`, `--user=…` (R10, R14): the user may be
  // empty (`-u :token`), a quoted pair is taken whole (spaces included). Not taken: a pair of digits
  // only on both sides, a uid:gid (`docker run -u 1000:1000`), and a `+` format (`date -u +%H:%M`)
  /(?<![A-Za-z0-9_-])(?:-u\s{0,5}|--user(?:\s{1,5}|=))(?:"[^"\n:]{0,100}:[^"\n]{1,200}"|'[^'\n:]{0,100}:[^'\n]{1,200}'|(?!\d{1,50}:\d{1,50}(?![^\s"']))(?:[^\s:"'+][^\s:"']{0,99})?:[^\s"']{1,200})/g,
  // A secret flag and its value, after a space or `=` (`--password V`, `--api-key=V`, R14); a
  // quoted value is taken whole. `--password-file`, `--token-count` are other flags.
  /(?<![A-Za-z0-9_-])--(?:api[_-]?key|password|passwd|token|secret)(?:=|\s{1,5})(?:"[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"'-][^\s"']{5,})/gi,
  // An API key name (`apiKey`, `api_key`, `api-key`, `x-api-key`, `APIKEY`, R10), then `:` or `=`,
  // then a quoted value of 8+ characters, an unquoted one of 8+ that holds a digit, or an unquoted
  // run of 20+ key characters that is not a call or a property path (R14). So code such as
  // `apiKey: config.apiKey` or `apiKey = getApiKeyFromTheEnvironment()` survives.
  /["']?(?:x-)?api[_-]?key[A-Za-z0-9_]{0,20}["']?\s{0,5}[:=]\s{0,5}(?:"[^"\s]{8,}"|'[^'\s]{8,}'|(?=[^\s"'(),;]{0,100}?\d)[^\s"'(),;]{8,}|[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_.(-]))/gi,
  // A secret-looking name (`SECRET_NAME_WORDS`), then `:` or `=`, then a quoted value of 4+
  // characters taken whole (spaces included, R14) or an unquoted one of 8+ (`password=`,
  // `"secret": "…"`). No word characters before the name and bounded runs after it: an unbounded
  // run would scan to the end of the text once per name it holds.
  new RegExp(
    `["']?(?:${SECRET_NAME_WORDS.join('|')})[A-Za-z0-9_]{0,20}["']?\\s{0,5}[:=]\\s{0,5}(?:"[^"\\n]{4,200}"|'[^'\\n]{4,200}'|["']?[^\\s"']{8,}["']?)`,
    'gi'
  )
]

/** The secret names as word parts: a single word (`password`), or two parts that may also be
 *  written as one (`access` + `key`, or `accesskey`). Built from `SECRET_NAME_WORDS`. */
const SECRET_PARTS: readonly (readonly string[])[] = [
  ...SECRET_NAME_WORDS.map((w) => w.split('_')),
  ['api', 'key']
]

/** The word parts of a key, lower case: split at every non-letter (so digits go too) and at each
 *  camelCase hump (`dbPassword`, `APIKey`). */
function wordParts(text: string): string[] {
  return text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}]+/u)
    .filter((p) => p !== '')
    .map((p) => p.toLowerCase())
}

/** The secret words a key may hold anywhere, glued to other letters too (`PGPASSWORD`,
 *  `dbpassword`, `passwordlessLogin`). Ruling C9: a password under a glued key would reach every
 *  window's prompt, while a harmless key hidden this way (`secretary`) costs one `memory_get`.
 *  `token`, `key` and the other words stay word-part matches: as substrings they hit `tokenizer`
 *  or `monkey`. */
const SECRET_ANYWHERE = ['password', 'passwd', 'secret'] as const

/** A secret name is in the key, in any case: `password`, `passwd` or `secret` anywhere in it
 *  (`SECRET_ANYWHERE`); or one of its word parts is a word of `SECRET_NAME_WORDS` or its plural
 *  (`authToken`, `DBToken`, `max tokens`, `Admin PWD`), or `access` / `private` / `api` then `key`,
 *  as two parts or one (`API_KEY`, `apiKey`, `apikey`). Any other word only inside a longer part
 *  is not one (`tokenizer`, `mytoken`), and a word the list lacks is not one (`db pass`). Unlike
 *  the patterns above, no value has to follow: a key line reads it in a key (`db password`),
 *  whose value may be short. */
export function namesSecret(text: string): boolean {
  const lower = text.toLowerCase()
  if (SECRET_ANYWHERE.some((word) => lower.includes(word))) return true
  const parts = wordParts(text)
  /** `part` is `word`, or its plural (`tokens`) when it ends a name. */
  const is = (part: string | undefined, word: string, last: boolean): boolean =>
    part === word || (last && part === `${word}s`)
  return parts.some((part, i) =>
    SECRET_PARTS.some(
      (name) =>
        is(part, name.join(''), true) ||
        name.every((word, j) => is(parts[i + j], word, j === name.length - 1))
    )
  )
}

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
