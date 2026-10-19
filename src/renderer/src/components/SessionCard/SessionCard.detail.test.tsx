// Needs-you detail — the card's line under the waiting tool's name.
//
// Runs under the `unit` Vitest project (jsdom). Split out of SessionCard.test.tsx, which sits
// near the 1000-line cap (testing.md). [spec 2026-10-18-needs-you-detail §2]

import { afterEach, describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionCard, type SessionCardProps } from './SessionCard'
import { cssRule } from '../../test/cssRule'

const props: SessionCardProps = {
  variant: 'hero',
  sessionName: 'deploy-prod',
  projectPath: '~/work/acme/api',
  status: 'needs-you',
  accent: 'needs-you',
  pid: 4242,
  pendingToolName: 'Bash'
}
const DETAIL = 'kubectl apply -f prod.yaml'

// No RTL auto-cleanup in this project (test/setup.ts): unmount what each test rendered.
let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

describe('SessionCard — the pending tool detail line', () => {
  it('draws the detail with its full text in the title and a public theme hook', () => {
    unmount = render(<SessionCard {...props} pendingToolDetail={DETAIL} />).unmount
    const detail = screen.getByTestId('pending-tool-detail')
    expect(detail).toHaveTextContent(DETAIL)
    expect(detail).toHaveAttribute('title', DETAIL)
    expect(detail).toHaveAttribute('data-pending-tool-detail')
  })

  it('sits right under the tool name', () => {
    unmount = render(<SessionCard {...props} pendingToolDetail={DETAIL} />).unmount
    const tool = screen.getByTestId('pending-tool')
    const detail = screen.getByTestId('pending-tool-detail')
    expect(tool.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is absent without a detail', () => {
    unmount = render(<SessionCard {...props} />).unmount
    expect(screen.queryByTestId('pending-tool-detail')).not.toBeInTheDocument()
  })

  it('is one mono line cut with an ellipsis, in --text-secondary', () => {
    const mono = cssRule(
      'components/SessionCard/SessionCard.module.css',
      '.projectPath, .pendingToolName, .pendingToolDetail'
    )
    expect(mono).toContain('font-family: var(--font-mono)')
    expect(mono).toContain('text-overflow: ellipsis')
    expect(mono).toContain('white-space: nowrap')
    expect(
      cssRule('components/SessionCard/SessionCard.module.css', '.pendingToolDetail')
    ).toContain('color: var(--text-secondary)')
  })
})
