import { describe, it, expect } from 'vitest'
import { createTemplatesStore, TEMPLATE_ERROR } from '../persistence/templates'
import { resolveTemplateLaunch } from './launchFromTemplate'

describe('resolveTemplateLaunch — template id + name → LaunchRequest', () => {
  function storeWith(): ReturnType<typeof createTemplatesStore> {
    const store = createTemplatesStore({ newId: () => 'tpl-1' })
    store.save({
      name: 'api',
      cwd: '/home/op/api',
      model: 'opus',
      permissionMode: 'acceptEdits',
      effort: 'max',
      workspaceId: null,
      initialPrompt: null,
      params: []
    })
    return store
  }
  it('resolves cwd + flags from the store and uses the OPERATOR name, trimmed', () => {
    expect(resolveTemplateLaunch(storeWith(), { templateId: 'tpl-1', name: ' api 2 ' })).toEqual({
      cwd: '/home/op/api',
      name: 'api 2',
      templateId: 'tpl-1',
      flags: { model: 'opus', permissionMode: 'acceptEdits', effort: 'max' }
    })
  })
  it('null template flags become null launch flags', () => {
    const store = createTemplatesStore({ newId: () => 'tpl-2' })
    store.save({
      name: 'x',
      cwd: '/x',
      model: null,
      permissionMode: null,
      effort: null,
      workspaceId: null,
      initialPrompt: null,
      params: []
    })
    expect(resolveTemplateLaunch(store, { templateId: 'tpl-2', name: 'x' }).flags).toEqual({
      model: null,
      permissionMode: null,
      effort: null
    })
  })
  it('unknown id throws template_not_found', () => {
    expect(() => resolveTemplateLaunch(storeWith(), { templateId: 'ghost', name: 'x' })).toThrow(
      TEMPLATE_ERROR.notFound
    )
  })
  it('malformed arg throws BEFORE touching the store (parse-and-throw)', () => {
    expect(() => resolveTemplateLaunch(storeWith(), { templateId: 'tpl-1' })).toThrow()
    expect(() => resolveTemplateLaunch(storeWith(), { templateId: 'tpl-1', name: '' })).toThrow()
    expect(() => resolveTemplateLaunch(storeWith(), null)).toThrow()
  })
})
