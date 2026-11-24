// Fixture for raw-html-injection.yaml (`semgrep --test`): `ruleid:` lines must match, `ok:` must not.
export function Bad({ html }: { html: string }): JSX.Element {
  // ruleid: raw-html-injection
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}

export function badDom(node: HTMLElement, html: string): void {
  // ruleid: raw-html-injection
  node.innerHTML = html
  // ruleid: raw-html-injection
  node.insertAdjacentHTML('beforeend', html)
}

export function Good({ text }: { text: string }): JSX.Element {
  // ok: raw-html-injection
  return <div title={text}>{text}</div>
}

export function goodDom(node: HTMLElement, text: string): void {
  // ok: raw-html-injection
  node.textContent = text
}
