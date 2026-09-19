// Tags (D-13) — the `/` hierarchy is DISPLAY ONLY. Nothing else parses a tag name: the board
// filter and the `has-tag` rules keep matching by id, so filtering by `acme` never includes
// `acme/prod`. `/` was already a legal name character and lists already sort by name (base
// sensitivity), which places `acme/prod` right after `acme` for free.
export interface TagPath {
  /** Everything before the LAST `/`, or null at depth 0. */
  parent: string | null
  leaf: string
  /** How many `/` separate well-formed segments (0 = a plain name). */
  depth: number
}

/** A segment is well-formed when it is non-blank; a malformed path (`/a`, `a/`, `a//b`) is drawn
 *  as a plain name rather than an empty parent or leaf. */
export function splitTagPath(name: string): TagPath {
  const segments = name.split('/')
  if (segments.length === 1 || segments.some((s) => s.trim().length === 0)) {
    return { parent: null, leaf: name, depth: 0 }
  }
  const leaf = segments[segments.length - 1] ?? name
  return { parent: segments.slice(0, -1).join('/'), leaf, depth: segments.length - 1 }
}
