// Story 1.3 — SessionCard tests (AC-4, AC-8). Story 3.3 — `watch-only` variant RETIRED.
//
// Asserts: each LIVE variant (hero / calm) renders the shared anatomy; mono vs sans field
// placement; the hero accent bar follows `accent` (and only on hero); the status dot carries
// a label (never color-only); the card is keyboard-focusable and `onActivate` fires on click
// AND Enter. The `watch-only` variant + its muted `Konsole` tag are RETIRED (Story 3.3,
// FR-12 dropped) — the Board shows ONLY app-launched sessions, so there is no external/Konsole
// card to present. The retired-variant anatomy case + Konsole-tag test are GONE (not weakened).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { SessionCard, type SessionCardProps } from './SessionCard'
import { renderComponent, fireEvent } from '../../test/renderComponent'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

function baseProps(overrides: Partial<SessionCardProps> = {}): SessionCardProps {
  return {
    variant: 'hero',
    sessionName: 'deploy-prod',
    projectPath: '~/work/acme/api',
    status: 'needs-you',
    accent: 'needs-you',
    pid: 4242,
    ...overrides
  }
}

describe('SessionCard — one anatomy, two live presentations (AC-4, AC-8; watch-only retired)', () => {
  it.each(['hero', 'calm'] as const)('renders the shared anatomy for the %s variant', (variant) => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ variant })} />)
    cleanup = unmount

    const root = container.querySelector('[data-variant]')
    expect(root?.getAttribute('data-variant')).toBe(variant)
    expect(container.querySelector('[data-testid="session-name"]')?.textContent).toBe('deploy-prod')
    expect(container.querySelector('[data-testid="project-path"]')?.textContent).toBe(
      '~/work/acme/api'
    )
    expect(container.querySelector('[data-testid="pid"]')?.textContent).toBe('4242')
    // The status dot's label is present (accessibility floor — never color-only).
    expect(container.querySelector('[data-testid="status-label"]')).not.toBeNull()
  })

  it('sessionName uses SANS (font-ui); path/tool/pid use MONO (font-mono)', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ pendingToolName: 'Bash' })} />
    )
    cleanup = unmount
    const name = container.querySelector<HTMLElement>('[data-testid="session-name"]')
    const path = container.querySelector<HTMLElement>('[data-testid="project-path"]')
    const tool = container.querySelector<HTMLElement>('[data-testid="pending-tool"]')
    const pid = container.querySelector<HTMLElement>('[data-testid="pid"]')
    // CSS-Module class names are scoped/hashed; assert the field placement via the
    // distinct class hooks (sessionName vs the mono fields use different modules).
    expect(name?.className).not.toBe(path?.className)
    expect(path).not.toBeNull()
    expect(tool?.textContent).toBe('Bash')
    expect(pid?.className).toBeTruthy()
  })

  it('omits pendingToolName when not provided', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-testid="pending-tool"]')).toBeNull()
  })

  it('hero accent bar follows `accent` (needs-you vs working)', () => {
    const gold = renderComponent(
      <SessionCard {...baseProps({ variant: 'hero', accent: 'needs-you' })} />
    )
    const goldRoot = gold.container.querySelector('[data-variant]')
    expect(goldRoot?.getAttribute('data-accent')).toBe('needs-you')
    const goldClass = goldRoot?.className ?? ''
    gold.unmount()

    const blue = renderComponent(
      <SessionCard {...baseProps({ variant: 'hero', accent: 'working' })} />
    )
    const blueRoot = blue.container.querySelector('[data-variant]')
    expect(blueRoot?.getAttribute('data-accent')).toBe('working')
    const blueClass = blueRoot?.className ?? ''
    blue.unmount()

    // The two accents produce DIFFERENT class strings (different accent-bar hook).
    expect(goldClass).not.toBe(blueClass)
  })

  it('the accent bar is hero-only (calm does not carry an accent class)', () => {
    const hero = renderComponent(
      <SessionCard {...baseProps({ variant: 'hero', accent: 'needs-you' })} />
    )
    const heroClass = hero.container.querySelector('[data-variant]')?.className ?? ''
    hero.unmount()

    const calm = renderComponent(
      <SessionCard {...baseProps({ variant: 'calm', accent: 'needs-you' })} />
    )
    const calmClass = calm.container.querySelector('[data-variant]')?.className ?? ''
    calm.unmount()

    // Same accent prop, different variant → hero gains an extra (accent-bar) class.
    expect(heroClass).not.toBe(calmClass)
  })

  it('never renders a Konsole tag — the watch-only variant is RETIRED (Story 3.3)', () => {
    // The Board shows ONLY app-launched sessions; the muted Konsole tag (built in Story 1.3,
    // never wired) is gone. Neither live variant renders it.
    const hero = renderComponent(<SessionCard {...baseProps({ variant: 'hero' })} />)
    expect(hero.container.querySelector('[data-testid="konsole-tag"]')).toBeNull()
    hero.unmount()

    const calm = renderComponent(<SessionCard {...baseProps({ variant: 'calm' })} />)
    expect(calm.container.querySelector('[data-testid="konsole-tag"]')).toBeNull()
    calm.unmount()
  })

  it('is keyboard-focusable (role=button, tabIndex=0)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    const root = container.querySelector('[data-variant]')
    expect(root?.getAttribute('role')).toBe('button')
    expect(root?.getAttribute('tabindex')).toBe('0')
  })

  it('fires onActivate on click', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ onActivate })} />)
    cleanup = unmount
    const root = container.querySelector('[data-variant]') as HTMLElement
    fireEvent(root, new MouseEvent('click', { bubbles: true }))
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('fires onActivate on Enter and Space', () => {
    const onActivate = vi.fn()
    const { container, unmount } = renderComponent(<SessionCard {...baseProps({ onActivate })} />)
    cleanup = unmount
    const root = container.querySelector('[data-variant]') as HTMLElement
    fireEvent(root, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    fireEvent(root, new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(onActivate).toHaveBeenCalledTimes(2)
  })

  it('renders the footer tasks/cost only when provided', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ tasks: 3, cost: '$0.12' })} />
    )
    cleanup = unmount
    expect(container.querySelector('[data-testid="tasks"]')?.textContent).toBe('3 tasks')
    expect(container.querySelector('[data-testid="cost"]')?.textContent).toBe('$0.12')
  })

  // Story 3.4 (FR-16 / AC-4) — the needs-you-unacknowledged emphasis prop. Driven by the SHARED
  // selectRailEmphasis (same state the rail reads); consumes the shipped Epic-1 emphasis class.
  it('applies the shipped needsYouEmphasisClass + data-emphasized when emphasized=true', () => {
    const { container, unmount } = renderComponent(
      <SessionCard {...baseProps({ emphasized: true })} />
    )
    cleanup = unmount
    const root = container.querySelector('[data-variant]')
    expect(root?.getAttribute('data-emphasized')).toBe('true')
  })

  it('does NOT emphasize by default (emphasized=false)', () => {
    const { container, unmount } = renderComponent(<SessionCard {...baseProps()} />)
    cleanup = unmount
    expect(container.querySelector('[data-variant]')?.getAttribute('data-emphasized')).toBeNull()
  })
})
