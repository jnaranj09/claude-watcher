// Custom themes — write the applied bundle into the document. ONE <style> node, `textContent`
// replaced (never a second node, never innerHTML — allowed by the CSP's style-src
// 'unsafe-inline'), plus the root `color-scheme` (which used to be fixed in main.css). Order in
// the cascade: tokens.css -> the bundle's :root block -> the bundle's raw CSS. Later wins.
import { useEffect } from 'react'
import type { ThemeBundle } from '../../../shared/schemas/theme'
import { useTheme, selectThemeBundle } from '../stores/themeStore'

export const THEME_STYLE_ID = 'claude-watcher-theme'

export function applyThemeToDocument(doc: Document, bundle: ThemeBundle): void {
  let node = doc.getElementById(THEME_STYLE_ID)
  if (node === null) {
    node = doc.createElement('style')
    node.id = THEME_STYLE_ID
    doc.head.appendChild(node)
  }
  if (node.textContent !== bundle.css) node.textContent = bundle.css
  doc.documentElement.style.colorScheme = bundle.colorScheme
}

/** Call ONCE at the App root. */
export function useApplyTheme(): void {
  const bundle = useTheme(selectThemeBundle)
  useEffect(() => {
    applyThemeToDocument(document, bundle)
  }, [bundle])
}
