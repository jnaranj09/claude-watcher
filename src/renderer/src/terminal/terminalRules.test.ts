// Story 3.1 (FR-10) — source-invariant guards for the LOAD-BEARING terminal.md rules.
//
// These rules cannot all be exercised in jsdom (xterm rendering/WebGL/MessagePort are
// smoke-only), so we pin the load-bearing FACTS as SOURCE invariants — the same CSS/source
// assertion pattern as `styles/emphasis.test.tsx`. A regression on any of these flips a test
// LOUDLY rather than silently breaking the terminal in the packaged app:
//   - kept-alive hidden uses `visibility:hidden`, NEVER `display:none` (terminal.md / AC-3);
//   - the frame uses the bg-terminal token + lg corners (UX-DR13) — no hand-authored color;
//   - the component sets `convertEol:false` (the PTY owns newlines — the SmokeCockpit delta);
//   - the component consumes the Story-1.3 `xtermTheme` token object — NOT a hand-authored
//     ANSI palette and NOT SmokeCockpit's hardcoded `{background,foreground}` (UX-DR2 / F3);
//   - the resize path sends dims to MAIN (window.terminal.resize) and never calls a local
//     term.resize() ahead of main (terminal.md resize-ordering).
// [Source: story 3.1 Task 4; .claude/rules/terminal.md; F2/F3; styles/emphasis.test.tsx pattern]
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
// Strip comments so the source-invariant assertions test the actual RULES/CODE, not prose in
// the explanatory comments (which intentionally mention `display:none` / `term.resize` to
// explain why they are FORBIDDEN).
const css = readFileSync(resolve(here, 'EmbeddedTerminal.module.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)
const tsxRaw = readFileSync(resolve(here, 'EmbeddedTerminal.tsx'), 'utf8')
const tsx = tsxRaw
  .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
  .replace(/^\s*\/\/.*$/gm, '') // line comments

describe('terminal.md source invariants — kept-alive hidden (AC-3)', () => {
  it('the .hidden class uses visibility:hidden', () => {
    // Find the `.hidden { ... }` block and assert visibility:hidden inside it.
    const block = /\.hidden\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/visibility:\s*hidden/)
  })

  it('NO rule sets display:none (display:none collapses the box to 0×0 and breaks fit())', () => {
    expect(css).not.toMatch(/display:\s*none/)
  })
})

describe('terminal.md source invariants — frame token (UX-DR13)', () => {
  it('the frame uses the bg-terminal token + lg corners — no hand-authored color', () => {
    const block = /\.frame\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/var\(--bg-terminal\)/)
    expect(block).toMatch(/var\(--rounded-lg\)/)
    // No raw hex color anywhere in the module (tokens only).
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})

describe('terminal.md source invariants — fit() sees the real box', () => {
  // FitAddon sizes rows from the xterm PARENT's computed height and subtracts only the padding of
  // xterm's OWN element. Under the global `box-sizing: border-box` that height INCLUDES the
  // parent's padding, so padding on `.host` bought up to one extra row that hung under the
  // frame's bottom border (measured: up to 8px past it). The breathing edge lives on `.frame`.
  it('the xterm parent (.host) carries no padding', () => {
    const block = /\.host\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).not.toMatch(/padding/)
  })

  it('the frame carries the breathing edge instead', () => {
    const block = /\.frame\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/padding:\s*var\(--space-2\)/)
  })
})

describe('terminal.md source invariants — component (AC-1/2/5; F3)', () => {
  it('sets convertEol:false (the PTY owns newline semantics — the SmokeCockpit delta)', () => {
    expect(tsx).toMatch(/convertEol:\s*false/)
  })

  it('consumes the Story-1.3 xtermTheme token object (NOT a hand-authored ANSI palette)', () => {
    expect(tsx).toMatch(/import\s*\{\s*xtermTheme\s*\}\s*from\s*['"]\.\.\/styles\/xtermTheme['"]/)
    expect(tsx).toMatch(/theme:\s*xtermTheme/)
    // It must NOT copy SmokeCockpit's hardcoded theme.
    expect(tsx).not.toMatch(/#1e1e2e/)
    expect(tsx).not.toMatch(/#cdd6f4/)
  })

  it('reads the operator font-size from the settings store (selectTerminalFontSize)', () => {
    expect(tsx).toMatch(/selectTerminalFontSize/)
  })

  it('resize sends dims to MAIN and never calls a local term.resize() ahead of main', () => {
    // The call is chained across lines (`window.terminal\n  .resize(...)`) — tolerate whitespace.
    expect(tsx).toMatch(/window\.terminal\s*\.\s*resize\(/)
    // No local term.resize( anywhere — main resizes the PTY first, the terminal reflows. Use a
    // boundary so `window.terminal.resize` / `fitRef` etc. don't false-positive.
    expect(tsx).not.toMatch(/\bterm\s*\.\s*resize\(/)
  })
})
