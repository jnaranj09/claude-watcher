// The project's ONE text field. jsdom `unit` project, `renderComponent` harness (no
// @testing-library/react in this repo — Story 1.3).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { TextInput, type TextInputProps } from './TextInput'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function render(props: Partial<TextInputProps> = {}): RenderResult {
  const r = renderComponent(
    <TextInput value="hello" onChange={vi.fn()} testId="field" ariaLabel="Field" {...props} />
  )
  cleanup = r.unmount
  return r
}

function field(r: RenderResult): HTMLInputElement {
  const el = r.container.querySelector<HTMLInputElement>('[data-testid="field"]')
  if (el === null) throw new Error('missing field')
  return el
}

/** Type into the field the way the DOM does, so React's onChange fires. */
function type(el: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('TextInput', () => {
  it('shows the current value and reports an edit as plain text', () => {
    const onChange = vi.fn()
    const r = render({ onChange })
    expect(field(r).value).toBe('hello')

    type(field(r), 'hello world')
    expect(onChange).toHaveBeenCalledWith('hello world')
  })

  it('takes an id so a <label htmlFor> can name it', () => {
    const r = render({ id: 'thing-name' })
    expect(field(r).id).toBe('thing-name')
  })

  it('carries its own accessible name when there is no label', () => {
    const r = render({ ariaLabel: 'Session name' })
    expect(field(r).getAttribute('aria-label')).toBe('Session name')
  })

  it('forwards placeholder and maxLength', () => {
    const r = render({ placeholder: 'Search', maxLength: 40 })
    expect(field(r).placeholder).toBe('Search')
    expect(field(r).maxLength).toBe(40)
  })

  it('marks a rejected value with aria-invalid, and leaves it off otherwise', () => {
    const bad = render({ invalid: true })
    expect(field(bad).getAttribute('aria-invalid')).toBe('true')
    cleanup?.()

    const ok = render({ invalid: false })
    expect(ok.container.querySelector('[data-testid="field"]')?.hasAttribute('aria-invalid')).toBe(
      false
    )
  })

  it('joins a menu roving-focus query only when asked', () => {
    const inside = render({ menuItem: true })
    expect(inside.container.querySelector('[data-menu-item]')).not.toBeNull()
    cleanup?.()

    const outside = render()
    expect(outside.container.querySelector('[data-menu-item]')).toBeNull()
  })

  it('can be disabled', () => {
    const r = render({ disabled: true })
    expect(field(r).disabled).toBe(true)
  })

  // A value the operator reads and copies but must not edit (the API token). Read-only, not
  // disabled: a disabled field is dimmed and cannot be selected, and a token you cannot select
  // is a token you cannot copy by hand.
  it('can be read-only while staying selectable', () => {
    const editable = render()
    expect(field(editable).readOnly).toBe(false)
    cleanup?.()

    const locked = render({ readOnly: true })
    expect(field(locked).readOnly).toBe(true)
    expect(field(locked).disabled).toBe(false)
  })

  it('forwards inputMode so a numeric field asks for digits', () => {
    const r = render({ inputMode: 'numeric' })
    expect(field(r).getAttribute('inputmode')).toBe('numeric')
    cleanup?.()

    const plain = render()
    expect(plain.container.querySelector('[data-testid="field"]')?.hasAttribute('inputmode')).toBe(
      false
    )
  })

  it('reports a blur so the caller can commit a validated value', () => {
    const onBlur = vi.fn()
    const r = render({ onBlur })
    act(() => {
      field(r).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('hands the element back through inputRef so the opener can focus it', () => {
    const ref = { current: null as HTMLInputElement | null }
    const r = render({ inputRef: ref })
    expect(ref.current).toBe(field(r))
  })

  it('draws a leading icon right before the field, hidden from screen readers', () => {
    const r = render({ icon: <svg data-testid="the-icon" /> })
    const slot = r.container.querySelector('[data-testid="the-icon"]')?.parentElement
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
    expect(slot?.nextElementSibling).toBe(field(r))
  })

  it('without an icon, renders the bare field and nothing around it', () => {
    const r = render()
    expect(r.container.firstElementChild).toBe(field(r))
  })
})

describe('the text field box', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/TextInput/TextInput.module.css'),
    'utf8'
  )
  const rule = (selector: string): string =>
    new RegExp(`\\n${selector.replace(/[.[\]]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

  // Select's `inline` variant (Select.module.css `.inline`) is compact chrome; a text field in the
  // same chrome must be the same box, or a search box and a dropdown in one bar differ in height.
  it('the inline variant is Select’s inline box', () => {
    const inline = rule('.inline')
    expect(inline).toMatch(/padding: var\(--space-1\) var\(--space-2\);/)
    expect(inline).toMatch(/font-size: var\(--font-size-label\);/)
  })

  // The board toolbar (FilterBar): the search box and the buttons beside it are one 32px row.
  it('the toolbar variant is 32px tall', () => {
    const toolbar = rule('.toolbar')
    expect(toolbar).toMatch(/height: 32px;/)
    expect(toolbar).toMatch(/padding-block: 0;/)
  })

  it('with an icon, the text starts past it and the icon never takes a click', () => {
    expect(rule('.withIcon')).toMatch(/padding-left:/)
    expect(rule('.icon')).toMatch(/pointer-events: none;/)
  })
})

// These two read the stylesheets off disk on purpose. `vitest.config.ts` sets no `css` option, so
// importing a *.module.css yields a proxy that answers EVERY key with a string — an assertion on
// `styles.x` can never fail (.claude/rules/design.md).
describe('the text field is the only one', () => {
  const componentsDir = join(process.cwd(), 'src/renderer/src/components')

  it('states its placeholder in --text-secondary, which clears the contrast floor', () => {
    const css = readFileSync(join(componentsDir, 'TextInput/TextInput.module.css'), 'utf8')
    const rule = /\.input::placeholder\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('var(--text-secondary)')
    // --text-muted is 2.85:1 on --bg-surface. It was the drifted value in one dialog.
    expect(rule).not.toContain('var(--text-muted)')
    expect(rule).not.toContain('var(--text-dim)')
  })

  // TextInput owns `.input`/`.search`/`.textField`; its multi-line sibling TextArea owns
  // `.textArea`. Every other module is an offender — a sixth copy-pasted box is how the first
  // five drifted.
  it('is the only module that draws a text-field box', () => {
    const offenders: string[] = []
    for (const dir of readdirSync(componentsDir, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === 'TextInput' || dir.name === 'TextArea') continue
      for (const file of readdirSync(join(componentsDir, dir.name))) {
        if (!file.endsWith('.module.css')) continue
        const css = readFileSync(join(componentsDir, dir.name, file), 'utf8')
        for (const selector of ['.input', '.search', '.textField', '.textArea']) {
          if (new RegExp(`^\\${selector}[\\s{:,\\[]`, 'm').test(css)) {
            offenders.push(`${dir.name}/${file} → ${selector}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
