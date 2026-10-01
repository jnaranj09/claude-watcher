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

  // xterm's WebGL renderer never clears its canvas: it relies on the browser clearing the drawing
  // buffer after each frame is SHOWN, and a `visibility:hidden` canvas is never shown. So a hidden
  // terminal that keeps receiving output stacks every frame on top of the last, and with a
  // see-through theme (liquid-glass) the stack shows the moment the terminal is shown again.
  // Moving it OFF-SCREEN makes xterm's own IntersectionObserver pause rendering, and xterm does a
  // full refresh when it comes back. Both hide paths need it: the kept-alive frame, and the whole
  // focused layer while the Board is shown.
  it('a hidden frame is also moved off-screen, so xterm pauses its renderer', () => {
    const block = /\.hidden\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/translate:\s*-\d+vw/)
  })

  it('a hidden view layer is also moved off-screen (the focused layer while on the Board)', () => {
    const appCss = readFileSync(resolve(here, '../App.module.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    const block = /\.viewLayer\[data-active='false'\]\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? ''
    expect(block).toMatch(/translate:\s*-\d+vw/)
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
  // xterm.css paints `.xterm-viewport` solid #000 and xterm 6 no longer overrides it with the
  // theme colour, so a see-through terminal theme came up pure black over the frame's glass.
  it('the xterm viewport is transparent, so a see-through theme shows the frame', () => {
    const block = /\.host :global\(\.xterm \.xterm-viewport\)\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/background-color:\s*transparent;/)
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

  it('themes through xtermThemeFor (the token default + the applied theme), NOT a hand-authored palette', () => {
    expect(tsx).toMatch(/from\s*['"]\.\.\/styles\/xtermTheme['"]/)
    expect(tsx).toMatch(/theme:\s*xtermThemeFor\(/)
    // Custom themes (D-10): allowTransparency is read at creation, from the theme store ref, ONCE —
    // the same value feeds the option and the theme's ground (xtermThemeFor's `transparent`).
    expect(tsx).toMatch(/const transparent = themeTerminalRef\.current\.allowTransparency === true/)
    expect(tsx).toMatch(/allowTransparency:\s*transparent\b/)
    expect(tsx).toMatch(/term\.options\.theme\s*=\s*xtermThemeFor\(/)
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

  // Custom themes (spec 2026-09-20) added a SECOND store subscription (`useTheme`) to this
  // component, which is exactly what makes "add themeTerminal to the create effect's deps" a
  // plausible next edit — and that edit would dispose + respawn every pty (killing every running
  // claude session) on a theme switch. `themeTerminal` is read via `themeTerminalRef` INSIDE the
  // effect (creation-only, terminal.md) precisely so it never has to be a dep. Pin the create
  // effect's own dependency array so a future edit that widens it turns this test red, not a
  // packaged-only incident.
  it('the create effect deps are EXACTLY [terminalId, openNonce] — no theme value belongs here', () => {
    const createIdx = tsx.indexOf('new Terminal(')
    expect(createIdx).toBeGreaterThan(-1)
    const effectStart = tsx.lastIndexOf('useEffect(() => {', createIdx)
    expect(effectStart).toBeGreaterThan(-1)
    // The first `}, [...])` after the effect's opening is ITS OWN closing deps array — nothing
    // nested inside the create effect uses that `}, [` hook-call shape (no useCallback/useEffect
    // inside it).
    const closeMatch = /\}\s*,\s*\[([^\]]*)\]\)/.exec(tsx.slice(effectStart))
    expect(closeMatch).not.toBeNull()
    const deps = (closeMatch?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    expect(deps).toEqual(['terminalId', 'openNonce'])
  })
})
