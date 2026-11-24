// OpenAPI facts the mutation run (StrykerJS) showed no test pinned: each catalog read documents
// the errors it can answer (`errorStatuses` in its command file).
import { describe, it, expect } from 'vitest'
import { buildOpenApiDocument } from './openapi'
import { sessionsListCommand } from './commands/sessionsList'
import { workspacesListCommand } from './commands/workspacesList'
import { templatesListCommand } from './commands/templatesList'

describe('buildOpenApiDocument — documented errors', () => {
  it.each([
    ['sessions.list', sessionsListCommand, '/v1/sessions', ['401', '503']],
    ['workspaces.list', workspacesListCommand, '/v1/workspaces', ['400', '401']],
    ['templates.list', templatesListCommand, '/v1/templates', ['400', '401', '404']]
  ])('documents the errors of %s', (_id, command, path, statuses) => {
    const doc = buildOpenApiDocument([command], { port: 1, version: '1' })
    const responses = Object.fromEntries(statuses.map((s) => [s, {}]))
    expect(doc).toMatchObject({ paths: { [path]: { get: { responses } } } })
  })
})
