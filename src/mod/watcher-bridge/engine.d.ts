// The slice of claude's mod engine API the bridge mod uses, copied by hand from the engine's
// declarations (claude 2.1.304). `prompt.submit`: origin probed on 2.1.309; present in the 2.1.307–2.1.309
// binaries; 2.1.304–2.1.306 unverified. The engine's own file is the authority and it moves
// between releases: `npm run test:mod` runs `claude plugin validate` and `claude plugin test` against the
// real engine. Declare ONLY what register.ts calls.
declare module 'claude-code' {
  export type InstructionFile = {
    path: string
    kind: string
    content: string
    parent?: string
  }

  export type SessionContextBreakdown = {
    memoryFiles: { path: string; type: string; tokens: number }[]
    mcpTools: { name: string; serverName: string; tokens: number; isLoaded: boolean }[]
    agents: { agentType: string; source: string; tokens: number }[]
    slashCommands?: { totalCommands: number; includedCommands: number; tokens: number }
    skills?: {
      totalSkills: number
      includedSkills: number
      tokens: number
      skillFrontmatter: { name: string; source: string; pluginName?: string; tokens: number }[]
    }
  }

  export type SettingsSource = 'user' | 'project' | 'local' | 'flag' | 'policy'

  export interface Engine {
    session: {
      id: () => Promise<string>
      usage: (args?: {
        breakdown?: 'summary' | 'full'
      }) => Promise<{ context: { breakdown?: SessionContextBreakdown } }>
    }
    settings: {
      read: (args?: { source?: SettingsSource }) => Promise<Readonly<Record<string, unknown>>>
    }
    env: {
      get: (name: string) => Promise<string | undefined>
    }
    http: {
      fetch: (
        url: string,
        init?: { method?: string; headers?: Record<string, string>; body?: string }
      ) => Promise<{ status: number; ok: boolean }>
    }
  }

  type Next<I, R> = ((e: I) => Promise<R>) & { readonly called: boolean }
  type Hook<I, R> = ($: Engine, e: I, next: Next<I, R>) => R | Promise<R>
  interface Registration<I, R> {
    catch(handler: Hook<I, R>): Registration<I, R>
  }

  export type SessionStartInput = { cwd: string }
  export type SessionStartResult = { cwd: string }
  export type PromptContextInput = { instructionFiles?: readonly InstructionFile[] }
  /** Opaque here: the mod passes it on untouched. */
  export type PromptContextResult = { readonly blocks: unknown }
  export type TurnCompleteInput = Readonly<Record<string, unknown>>
  /** Opaque here: the mod passes it on untouched. */
  export type TurnCompleteResult = Readonly<Record<string, unknown>> | undefined
  /** Only `origin` is read (who sent the prompt; origin probed on 2.1.309, `prompt.submit` in 2.1.307–2.1.309, 2.1.304–2.1.306 unverified); the text is never read. */
  export type PromptSubmitInput = { readonly origin?: { readonly kind: string } }
  /** Opaque here: the mod passes it on untouched. */
  export type PromptSubmitResult = Readonly<Record<string, unknown>>

  export interface On {
    (
      event: 'session.start',
      hook: Hook<SessionStartInput, SessionStartResult>
    ): Registration<SessionStartInput, SessionStartResult>
    (
      event: 'prompt.context',
      hook: Hook<PromptContextInput, PromptContextResult>
    ): Registration<PromptContextInput, PromptContextResult>
    (
      event: 'turn.complete',
      hook: Hook<TurnCompleteInput, TurnCompleteResult>
    ): Registration<TurnCompleteInput, TurnCompleteResult>
    (
      event: 'prompt.submit',
      hook: Hook<PromptSubmitInput, PromptSubmitResult>
    ): Registration<PromptSubmitInput, PromptSubmitResult>
  }

  export type Register = (on: On) => unknown
}
