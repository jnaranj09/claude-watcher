import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cssRule, readCss } from '../../test/cssRule'
import { CountPill } from './CountPill'

const PILL_CSS = 'components/CountPill/CountPill.module.css'
const SWITCHER_CSS = 'components/WorkspaceSwitcher/WorkspaceSwitcher.module.css'

describe('CountPill', () => {
  it('draws the value with its kind as data-count', () => {
    render(<CountPill value={3} kind="open-tasks" testId="p" />)
    const pill = screen.getByTestId('p')
    expect(pill).toHaveTextContent('3')
    expect(pill).toHaveAttribute('data-count', 'open-tasks')
  })

  it('hidden marks it aria-hidden', () => {
    render(<CountPill value={1} kind="total" testId="h" hidden />)
    expect(screen.getByTestId('h')).toHaveAttribute('aria-hidden', 'true')
  })

  it('the pill shape lives in CountPill.module.css only', () => {
    const pill = cssRule(PILL_CSS, '.pill')
    expect(pill).toMatch(/min-width:/)
    expect(pill).toMatch(/height:\s*14px/)
    expect(pill).toMatch(/border-radius:\s*var\(--rounded-full\)/)
    expect(pill).toMatch(/font-size:\s*10px/)
    const switcher = readCss(SWITCHER_CSS)
    expect(switcher).not.toMatch(/height:\s*14px/)
    expect(switcher).not.toMatch(/border-radius:\s*var\(--rounded-full\)/)
  })

  it('the pill min width matches the switcher width math', () => {
    const pillMin = /min-width:\s*([^;]+);/.exec(cssRule(PILL_CSS, '.pill'))?.[1]?.trim()
    const switcherPill = /--switcher-pill:\s*([^;]+);/.exec(readCss(SWITCHER_CSS))?.[1]?.trim()
    expect(switcherPill).toBe('14px')
    expect(pillMin).toBe(switcherPill)
  })
})
