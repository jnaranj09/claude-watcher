// Programmatic API — THE command list. The router (apiServer.ts) and the OpenAPI document
// (openapi.ts) are both generated from it, so adding an action is one file + one entry here.
//
// It cannot live in `registry.ts`: every command imports `defineCommand` from there, and a list
// beside the definition would close that cycle.
import type { AnyApiCommand } from '../registry'
import { sessionsCreateCommand } from './sessionsCreate'
import { sessionsListCommand } from './sessionsList'
import { sessionsGetCommand } from './sessionsGet'
import { sessionsEventsCommand } from './sessionsEvents'
import { workspacesListCommand } from './workspacesList'
import { templatesListCommand } from './templatesList'

/** Order = the order in the OpenAPI document: create first (the one thing a client comes here to
 *  do), then the two reads, then the stream, then the two catalog reads a caller uses to find a
 *  template to create from. The ROUTER does not depend on it — it matches the
 *  path and then the method, so `POST /v1/sessions` and `GET /v1/sessions` cannot shadow each
 *  other however they are ordered. */
export const apiCommands: readonly AnyApiCommand[] = [
  sessionsCreateCommand,
  sessionsListCommand,
  sessionsGetCommand,
  sessionsEventsCommand,
  workspacesListCommand,
  templatesListCommand
]
