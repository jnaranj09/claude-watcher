// Reading a renderer stylesheet's rules from a test. A `*.module.css` import is a proxy in Vitest
// that answers every key (design.md "Testing CSS"), so a CSS rule is checked on the sheet's TEXT.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const rendererDir = join(__dirname, '..')

/** The stylesheet at `file` (relative to src/renderer/src), comments stripped. */
export function readCss(file: string): string {
  return readFileSync(join(rendererDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every `selector-list { body }` leaf in `css`; an @media wrapper's inner rules count on their
 *  own. Selectors are trimmed, with whitespace runs collapsed to one space. */
export function cssRules(css: string): { selectors: string[]; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, list = '', body = '']) => ({
    selectors: selectorList(list),
    body
  }))
}

function selectorList(list: string): string[] {
  return list.split(',').map((s) => s.trim().replace(/\s+/g, ' '))
}

/** The declarations of the first rule (in source order) in `file` whose selector list is exactly
 *  `selector` — `.a, .b` matches only a rule listing both, in that order; whitespace is ignored.
 *  Throws when there is none, so an assertion on a missing rule cannot pass. */
export function cssRule(file: string, selector: string): string {
  const wanted = selectorList(selector).join(',')
  const hit = cssRules(readCss(file)).find((r) => r.selectors.join(',') === wanted)
  if (hit === undefined) throw new Error(`no rule ${selector} in ${file}`)
  return hit.body
}

/** The declarations of EVERY rule whose selector list names `selector` anywhere (`.panel` in
 *  `.a .panel:hover` counts; `.panelWide` does not), joined. `''` when no rule names it — so an
 *  assertion on a property passes only when such a rule exists and carries it.
 *  Comments stripped. */
export function ruleBody(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const pattern = new RegExp(`(^|[\\s,>+~(])\\${selector}(?![\\w-])`)
  const bodies: string[] = []
  let start = 0
  let prelude = ''
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      prelude = stripped.slice(start, i)
      start = i + 1
    } else if (stripped[i] === '}') {
      if (pattern.test(prelude)) bodies.push(stripped.slice(start, i))
      prelude = ''
      start = i + 1
    }
  }
  return bodies.join('\n')
}
