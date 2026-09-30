// Action feedback (spec 2026-09-29 §2.6) — "No templates yet" must not be told apart from "the load
// failed" by guesswork: each dialog says `Could not load <x>.` in place of its empty sentence.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { renderComponent, type RenderResult } from '../test/renderComponent'
import { TemplatesDialog } from '../components/TemplatesDialog/TemplatesDialog'
import { ShortcutsDialog } from '../components/ShortcutsDialog/ShortcutsDialog'
import { TagsDialog } from '../components/TagsDialog/TagsDialog'
import { RulesDialog } from '../components/RulesDialog/RulesDialog'
import { WorkspacesDialog } from '../components/WorkspacesDialog/WorkspacesDialog'
import { templatesStore } from '../stores/templatesStore'
import { shortcutsStore } from '../stores/shortcutsStore'
import { tagsStore } from '../stores/tagsStore'
import { rulesStore } from '../stores/rulesStore'
import { workspacesStore } from '../stores/workspacesStore'

let r: RenderResult | undefined
beforeEach(() => {
  act(() => {
    templatesStore.setState({ templates: [], loaded: false, loadFailed: true })
    shortcutsStore.setState({ shortcuts: [], loaded: false, loadFailed: true })
    tagsStore.setState({ tags: [], loaded: false, loadFailed: true, activeTagId: null })
    rulesStore.setState({ rules: [], brokenIds: [], loaded: false, loadFailed: true })
    workspacesStore.setState({
      workspaces: [],
      activeId: 'default',
      loaded: false,
      loadFailed: true
    })
  })
})
afterEach(() => {
  r?.unmount()
  r = undefined
  act(() => {
    templatesStore.setState({ loaded: false, loadFailed: false })
    shortcutsStore.setState({ loaded: false, loadFailed: false })
    tagsStore.setState({ loaded: false, loadFailed: false })
    rulesStore.setState({ loaded: false, loadFailed: false })
    workspacesStore.setState({ loaded: false, loadFailed: false })
  })
})

describe('a failed startup load is named in each dialog', () => {
  it.each([
    ['Templates', <TemplatesDialog key="t" onClose={() => {}} />, 'Could not load templates.'],
    ['Shortcuts', <ShortcutsDialog key="s" onClose={() => {}} />, 'Could not load shortcuts.'],
    ['Tags', <TagsDialog key="g" onClose={() => {}} />, 'Could not load tags.'],
    ['Rules', <RulesDialog key="r" onClose={() => {}} />, 'Could not load rules.'],
    ['Workspaces', <WorkspacesDialog key="w" onClose={() => {}} />, 'Could not load workspaces.']
  ])('%s', (_name, element, copy) => {
    r = renderComponent(element)
    expect(r.container.textContent).toContain(copy)
    expect(r.container.textContent).not.toMatch(/yet/)
  })

  it('a later successful hydrate clears it (Templates)', () => {
    r = renderComponent(<TemplatesDialog onClose={() => {}} />)
    act(() => templatesStore.getState().hydrate([]))
    expect(r.container.textContent).not.toContain('Could not load templates.')
    expect(r.container.textContent).toContain('No templates yet')
  })

  it('a later successful hydrate clears it (Rules)', () => {
    r = renderComponent(<RulesDialog onClose={() => {}} />)
    act(() => rulesStore.getState().hydrate({ rules: [], brokenIds: [] }))
    expect(r.container.textContent).not.toContain('Could not load rules.')
    expect(r.container.textContent).toContain('No rules yet')
  })
})
