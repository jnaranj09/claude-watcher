// A config row's own text, without its "where it lives" marker (spec 2026-10-03 H): the marker
// (`ScopeMarker`, test id `scope-marker`) sits inside every Templates / Shortcuts / Tags / Rules
// row, and a test that reads a row's NAME must not read the marker's workspace name with it.
export function rowText(el: Element): string {
  const copy = el.cloneNode(true) as Element
  for (const marker of copy.querySelectorAll('[data-testid="scope-marker"]')) marker.remove()
  return copy.textContent ?? ''
}
