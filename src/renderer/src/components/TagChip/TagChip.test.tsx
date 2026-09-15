// Tags — TagChip / TagChipWrap / TagChipRow / fitCount. jsdom `unit` project, `renderComponent`
// harness (no @testing-library).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, type ReactElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderComponent, type RenderResult } from '../../test/renderComponent'
import { TagChip, TagChipWrap } from './TagChip'
import { TagChipRow } from './TagChipRow'
import { fitCount } from './fitCount'
import { TOKENS } from '../../styles/tokens'
import { TAG_COLORS } from '../../../../shared/schemas/tag'
import { contrast, hexToRgb } from '../../test/contrast'

const PROD = { id: 't-prod', name: 'prod', color: 'rose' as const }
const DEPLOY = { id: 't-deploy', name: 'deploy', color: 'amber' as const }
const RELEASE = { id: 't-release', name: 'release-2.1', color: 'green' as const }

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.restoreAllMocks()
})

function render(el: ReactElement): RenderResult {
  const r = renderComponent(el)
  cleanup = r.unmount
  return r
}

const chipNames = (r: RenderResult): string[] =>
  [...r.container.querySelectorAll('[data-testid="tag-chip"]')].map((c) => c.textContent ?? '')

describe('TagChip — the one drawing of a tag name (T-7)', () => {
  it('draws the name as text, keeps it in a title, and carries its id', () => {
    const r = render(<TagChip tag={PROD} />)
    const chip = r.container.querySelector('[data-testid="tag-chip"]')
    expect(chip?.textContent).toBe('prod')
    expect(chip?.getAttribute('title')).toBe('prod')
    expect(chip?.getAttribute('data-tag-id')).toBe('t-prod')
  })

  it('TagChipWrap draws every chip, in the order given', () => {
    const r = render(<TagChipWrap tags={[DEPLOY, PROD]} testId="wrap" />)
    expect(chipNames(r)).toEqual(['deploy', 'prod'])
  })
})

describe('TagChipRow — one line, +N for the rest (T-26)', () => {
  it('renders nothing for no tags', () => {
    const r = render(<TagChipRow tags={[]} testId="row" />)
    expect(r.container.querySelector('[data-testid="row"]')).toBeNull()
  })

  it('without layout (jsdom) every chip fits and no +N is drawn', () => {
    const r = render(<TagChipRow tags={[DEPLOY, PROD, RELEASE]} testId="row" />)
    expect(chipNames(r)).toEqual(['deploy', 'prod', 'release-2.1'])
    expect(r.container.querySelector('[data-testid="tag-chip-more"]')).toBeNull()
  })

  it('keeps the leading chips that fit beside the +N, whose title lists the hidden ones in order', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(120)
    const r = render(<TagChipRow tags={[DEPLOY, PROD, RELEASE]} testId="row" />)
    expect(chipNames(r)).toEqual(['deploy'])
    const more = r.container.querySelector('[data-testid="tag-chip-more"]')
    expect(more?.textContent).toBe('+2')
    expect(more?.getAttribute('title')).toBe('prod, release-2.1')
  })

  // Review finding A (T-26): the ResizeObserver must watch the element that tracks AVAILABLE
  // space (the parent slot: `.footerTags` / `.rowTags`), not the row's own span — once fitted,
  // the row is only as wide as the chips it kept, so its own box does not change size when the
  // card/rail gets WIDER, and the old code (observing the row) never saw that as a resize.
  it('re-fits when the SLOT around it widens, not just when it narrows', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(50)
    const clientWidthSpy = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(120)

    class FakeResizeObserver {
      static registrations: { target: Element; cb: () => void }[] = []
      constructor(private cb: () => void) {}
      observe(target: Element): void {
        FakeResizeObserver.registrations.push({ target, cb: this.cb })
      }
      disconnect(): void {
        FakeResizeObserver.registrations = FakeResizeObserver.registrations.filter(
          (r) => r.cb !== this.cb
        )
      }
      static fireResizeOn(target: Element): void {
        for (const r of FakeResizeObserver.registrations) {
          if (r.target === target) r.cb()
        }
      }
    }
    FakeResizeObserver.registrations = []
    const originalRO = globalThis.ResizeObserver
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
    const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean | undefined }
    const originalActEnv = g.IS_REACT_ACT_ENVIRONMENT
    g.IS_REACT_ACT_ENVIRONMENT = true

    const r = render(
      <div data-testid="slot">
        <TagChipRow tags={[DEPLOY, PROD, RELEASE]} testId="row" />
      </div>
    )
    // Narrow: matches the fitted baseline above.
    expect(chipNames(r)).toEqual(['deploy'])

    // The container widens: in the real browser this is a resize of the SLOT (the available
    // space around the row), not the row itself. Widen the stubbed width and fire the resize
    // only on the slot — a fix that still observes the row would never see this.
    clientWidthSpy.mockReturnValue(1000)
    const slot = r.container.querySelector('[data-testid="slot"]')
    act(() => {
      if (slot !== null) FakeResizeObserver.fireResizeOn(slot)
    })

    expect(chipNames(r)).toEqual(['deploy', 'prod', 'release-2.1'])
    expect(r.container.querySelector('[data-testid="tag-chip-more"]')).toBeNull()
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO
    g.IS_REACT_ACT_ENVIRONMENT = originalActEnv
  })
})

describe('fitCount — how many leading chips fit on one line', () => {
  function row(widths: number[], probe: number, available: number): HTMLElement {
    const el = document.createElement('span')
    Object.defineProperty(el, 'clientWidth', { value: available })
    for (const w of widths) {
      const chip = document.createElement('span')
      chip.setAttribute('data-testid', 'tag-chip')
      Object.defineProperty(chip, 'offsetWidth', { value: w })
      el.appendChild(chip)
    }
    const more = document.createElement('span')
    more.setAttribute('data-testid', 'tag-chip-more')
    Object.defineProperty(more, 'offsetWidth', { value: probe })
    el.appendChild(more)
    return el
  }

  it('every chip when they all fit (the +N probe is not counted)', () => {
    expect(fitCount(row([30, 30], 20, 60))).toBe(2)
  })

  it('reserves room for the +N chip', () => {
    expect(fitCount(row([40, 40, 40], 24, 100))).toBe(1)
  })

  it('0 when not even one chip fits beside the +N', () => {
    expect(fitCount(row([80], 24, 70))).toBe(0)
  })
})

// Asserted on the token VALUES and the stylesheet TEXT: a CSS-module import is a proxy in Vitest,
// so a class-existence check would pass on an empty sheet (design.md).
describe('tag colours', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/TagChip/TagChip.module.css'),
    'utf8'
  )

  it('every colour has fill / border / text tokens, and its text clears 4.5:1 on its fill', () => {
    for (const c of TAG_COLORS) {
      const ratio = contrast(hexToRgb(TOKENS[`tag-${c}-text`]), hexToRgb(TOKENS[`tag-${c}-fill`]))
      expect(ratio, `${c} text on its fill`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('each colour class paints with its OWN three tokens', () => {
    for (const c of TAG_COLORS) {
      const rule = new RegExp(`\\.${c}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
      expect(rule, `.${c}`).toContain(`var(--tag-${c}-fill)`)
      expect(rule, `.${c}`).toContain(`var(--tag-${c}-border)`)
      expect(rule, `.${c}`).toContain(`var(--tag-${c}-text)`)
    }
  })

  it('the +N chip is opaque --bg-surface with --text-secondary (clears 4.5:1 on every surface)', () => {
    const rule = /\.more\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('var(--bg-surface)')
    expect(rule).toContain('var(--text-secondary)')
    expect(
      contrast(hexToRgb(TOKENS['text-secondary']), hexToRgb(TOKENS['bg-surface']))
    ).toBeGreaterThanOrEqual(4.5)
  })

  // `overflow: hidden` + `line-height: 1` cut the tail of every p/g/y flat and sat the lowercase body
  // ~1px low (measured in Electron's Chromium). The name clips SIDEWAYS only, and centres its x-height.
  it('the name clips sideways only (never a descender) and centres on the lowercase body', () => {
    const rule = /\.name\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/overflow-x:\s*clip/)
    expect(rule).toMatch(/overflow-y:\s*visible/)
    expect(rule).not.toMatch(/overflow:\s*hidden/)
    expect(rule).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule).toMatch(/text-box:\s*trim-both ex alphabetic/)
  })
})
