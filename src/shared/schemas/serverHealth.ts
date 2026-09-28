// Server health — whether this process's two localhost listeners are actually up (UX-05, R11 in
// docs/reports/2026-09-23-bug-hunt). Main owns it and pushes it over `CH.serverHealth`,
// validated AT SOURCE; the renderer draws the hook banner and the Settings API line from it.
//
// `hooks`:
//   - starting          — the listener has not reported yet (no banner: it binds in milliseconds)
//   - ok                — listening, and the hook settings file was written
//   - port_in_use       — another process holds the hook port; launches carry NO `--settings`
//                         (SEC-6), so every new session runs without status
//   - server_error      — any other bind failure, same consequence
//   - hooks_file_failed — listening, but the settings file could not be written
// `api`: off / starting / listening / port_in_use / failed. Only meaningful while enabled.

import { z } from 'zod'

export const HOOK_HEALTH_STATES = [
  'starting',
  'ok',
  'port_in_use',
  'server_error',
  'hooks_file_failed'
] as const
export const API_HEALTH_STATES = ['off', 'starting', 'listening', 'port_in_use', 'failed'] as const

export const ServerHealthSchema = z
  .object({
    hooks: z.enum(HOOK_HEALTH_STATES),
    hookPort: z.number().int().min(0).max(65535),
    api: z.enum(API_HEALTH_STATES)
  })
  .strict()

export type ServerHealth = z.infer<typeof ServerHealthSchema>
export type HookHealth = ServerHealth['hooks']
export type ApiHealth = ServerHealth['api']
