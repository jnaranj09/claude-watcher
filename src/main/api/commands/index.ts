// Programmatic API — THE command list. The router (apiServer.ts) and the OpenAPI document
// (openapi.ts) are both generated from it, so adding an action is one file + one entry here.
//
// It cannot live in `registry.ts`: every command imports `defineCommand` from there, and a list
// beside the definition would close that cycle.
import type { AnyApiCommand } from '../registry'
import { sessionsListCommand } from './sessionsList'
import { sessionsGetCommand } from './sessionsGet'

/** Order = the order in the OpenAPI document. Tasks 12-13 append create + events. */
export const apiCommands: readonly AnyApiCommand[] = [sessionsListCommand, sessionsGetCommand]
