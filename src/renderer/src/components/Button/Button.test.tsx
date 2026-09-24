// The project's ONE button. jsdom `unit` project, `renderComponent` harness.
//
// The structural guard at the bottom is the reason this component exists: nine button looks had
// grown across the renderer, most of them copies of one another, and every copy had drifted (a
// different border, a different font size, no height). The guard walks every `*.module.css`
// under components/ and fails the moment any module other than Button declares a button class.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { Button, type ButtonProps } from './Button'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<ButtonProps> = {}, label = 'Press'): RenderResult {
  const r = renderComponent(
    <Button testId="btn" {...props}>
      {label}
    </Button>
  )
  cleanup = r.unmount
  return r
}

function button(r: RenderResult): HTMLButtonElement {
  const el = r.container.querySelector<HTMLButtonElement>('[data-testid="btn"]')
  if (el === null) throw new Error('missing button')
  return el
}

describe('Button', () => {
  it('is a plain <button type="button"> by default, secondary and md', () => {
    const b = button(render())
    expect(b.tagName).toBe('BUTTON')
    expect(b.type).toBe('button')
    expect(b.dataset['variant']).toBe('secondary')
    expect(b.dataset['size']).toBe('md')
    expect(b.textContent).toBe('Press')
  })

  it('is submit only when asked (a form Save)', () => {
    expect(button(render({ type: 'submit' })).type).toBe('submit')
  })

  it('mirrors variant and size on data attributes so tests and themes can target them', () => {
    const b = button(render({ variant: 'primary', size: 'sm' }))
    expect(b.dataset['variant']).toBe('primary')
    expect(b.dataset['size']).toBe('sm')
  })

  it('marks armed and lit as boolean data attributes, absent when off', () => {
    const off = button(render({ variant: 'danger' }))
    expect(off.hasAttribute('data-armed')).toBe(false)
    expect(off.hasAttribute('data-lit')).toBe(false)
    cleanup?.()
    const on = button(render({ variant: 'danger', armed: true, lit: true }))
    expect(on.hasAttribute('data-armed')).toBe(true)
    expect(on.hasAttribute('data-lit')).toBe(true)
  })

  it('forwards native button attributes and the click', () => {
    const onClick = vi.fn()
    const b = button(
      render({
        onClick,
        disabled: false,
        'aria-label': 'Menu',
        'aria-expanded': true,
        title: 'Menu'
      })
    )
    expect(b.getAttribute('aria-label')).toBe('Menu')
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(b.title).toBe('Menu')
    act(() => {
      b.click()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('can be disabled', () => {
    expect(button(render({ disabled: true })).disabled).toBe(true)
  })

  it('hands the element back through buttonRef so the opener can refocus it', () => {
    const ref = { current: null as HTMLButtonElement | null }
    const r = render({ buttonRef: ref })
    expect(ref.current).toBe(button(r))
  })
})

// ── The structural guard ────────────────────────────────────────────────────────────────────────
const componentsDir = join(process.cwd(), 'src/renderer/src/components')
/** The guard walks the WHOLE renderer, not just components/: the focused view (`views/`) and the
 *  terminal frame (`terminal/`) had button copies of their own. */
const rendererDir = join(process.cwd(), 'src/renderer/src')

/** The classes Button owns, and every retired copy of a button look. A module that declares one
 *  of them is drawing a button of its own. */
const BUTTON_CLASSES = [
  '.button',
  '.buttonPrimary',
  '.primary',
  '.secondary',
  '.danger',
  '.ghost',
  '.primaryButton',
  '.ghostButton',
  '.deleteButton',
  '.dangerButton',
  '.cancelButton',
  '.confirmButton',
  '.closeButton',
  '.openButton',
  '.backButton',
  '.deadButton',
  '.archiveButton',
  '.deleteButtonFocused',
  '.renameButton',
  '.cardDelete',
  '.rowRenameButton',
  '.peekButton',
  '.collapseToggle',
  '.toggle'
]

/** True when `css` names the class `selector` anywhere a selector can (a combinator target, mid
 *  comma-list, nested in `@media`). Runs over selector text only, so a comment or a declaration
 *  value naming the class cannot trip it. (The matcher ManageDialog.styles.test.ts uses.) */
function declares(css: string, selector: string): boolean {
  const pattern = new RegExp(`(^|[\\s,>+~(])\\${selector}(?![\\w-])`)
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const segments: string[] = []
  let start = 0
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      segments.push(stripped.slice(start, i))
      start = i + 1
    } else if (stripped[i] === '}') {
      start = i + 1
    }
  }
  return segments.some((segment) => pattern.test(segment))
}

function componentModules(): { name: string; css: string }[] {
  const out: { name: string; css: string }[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relName = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), relName)
      else if (entry.name.endsWith('.module.css')) {
        out.push({ name: relName, css: readFileSync(join(dir, entry.name), 'utf8') })
      }
    }
  }
  walk(rendererDir, '')
  return out
}

describe('Button owns every button style', () => {
  it('no other module declares a button class', () => {
    const offenders: string[] = []
    for (const { name, css } of componentModules()) {
      if (name.startsWith('components/Button/')) continue
      for (const selector of BUTTON_CLASSES) {
        if (declares(css, selector)) offenders.push(`${name} → ${selector}`)
      }
    }
    expect(offenders).toEqual([])
  })

  // Non-vacuity: the guard above passes trivially if the classes vanish everywhere.
  it('declares its own box and the four variants', () => {
    const css = readFileSync(join(componentsDir, 'Button/Button.module.css'), 'utf8')
    for (const selector of ['.button', '.primary', '.secondary', '.danger', '.ghost']) {
      expect(declares(css, selector), selector).toBe(true)
    }
  })

  // jsdom has no layout: read the stylesheet. A FIXED height per size is the whole fix for the
  // squeezed look, and `md` must equal the toolbar text field beside it (TextInput's `toolbar`).
  it('gives every size a fixed height, and md matches the toolbar text field', () => {
    const css = readFileSync(join(componentsDir, 'Button/Button.module.css'), 'utf8')
    const field = readFileSync(join(componentsDir, 'TextInput/TextInput.module.css'), 'utf8')
    const body = (cls: string): string =>
      new RegExp(`\\n\\${cls} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    expect(body('.button')).toMatch(/height: 32px;/)
    expect(body('.sm')).toMatch(/height: 26px;/)
    expect(body('.xs')).toMatch(/height: 20px;/)
    expect(/\n\.toolbar \{([^}]*)\}/.exec(field)?.[1] ?? '').toMatch(/height: 32px;/)
    // Delete's contract (design.md): red outline at rest, solid red only when armed.
    expect(body('.danger')).toMatch(/border-color: var\(--danger\);/)
    expect(body('.danger')).not.toMatch(/background: var\(--danger\)/)
    expect(css).toMatch(/\.danger\[data-armed\] \{[^}]*font-weight: 600;/)
    expect(css).toMatch(/\.button\[data-lit\] \{[^}]*background: var\(--text-primary\);/)
  })

  // `.secondary:hover:not(:disabled)` (0,3,0) outranks `.button[data-lit]` (0,2,0): a hovered
  // lit Filter button took the surface fill but KEPT the dark lit ink, so its icon and label
  // vanished. The lit hover rule must out-rank every variant's hover and keep the lit ink.
  it('keeps a lit button lit on hover', () => {
    const css = readFileSync(join(componentsDir, 'Button/Button.module.css'), 'utf8')
    const rule = /\n\.button\[data-lit\]:hover:not\(:disabled\) \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/background: var\(--text-primary\);/)
    expect(rule).toMatch(/color: var\(--text-on-lit\);/)
  })
})
