// Fixture for dynamic-code.yaml (`semgrep --test`): `ruleid:` lines must match, `ok:` must not.
export function bad(src: string): unknown {
  // ruleid: dynamic-code
  const a = eval(src)
  // ruleid: dynamic-code
  const f = new Function('x', src)
  // ruleid: dynamic-code
  setTimeout('tick()', 10)
  return [a, f]
}

export function good(): void {
  // ok: dynamic-code
  setTimeout(() => undefined, 10)
  // ok: dynamic-code
  JSON.parse('{}')
}
