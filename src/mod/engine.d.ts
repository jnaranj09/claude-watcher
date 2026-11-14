// The slice of claude's mod engine API the mods under `src/mod/` use, copied by hand from the
// engine's declarations (claude 2.1.304; what only `watcher-memory` calls: claude 2.1.323). `prompt.submit`: origin probed on 2.1.309; present in the 2.1.307–2.1.309
// binaries; 2.1.304–2.1.306 unverified. The engine's own file is the authority and it moves
// between releases: `npm run test:mod` runs `claude plugin validate` and `claude plugin test` against the
// real engine. Declare ONLY what a mod's register.ts calls.
//
// One ambient file serves every mod: two files that each `declare module 'claude-code'` with
// their own `export type`s collide under `tsconfig.node.json`. No mod imports it, and it ships in
// no mod folder: the engine lays its own types into a `--plugin-dir` folder.
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
      ) => Promise<HttpResponse>
    }
    fs: {
      read: (path: string) => Promise<string>
    }
    clock: {
      now: () => Promise<number>
      sleep: (ms: number) => Promise<void>
    }
    command: {
      register: (command: CommandSpec) => Promise<{ command: string }>
    }
  }

  export type HttpResponse = { status: number; ok: boolean; text: string }
  export type CommandSpec = { name: string; description: string; argumentHint?: string }
  /** Who sent a prompt or ran a command (`composer` = the person's Enter at the terminal). */
  export type PromptOrigin = { readonly kind: string }

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
  /** The bridge mod reads only `origin` (origin probed on 2.1.309, `prompt.submit` in 2.1.307–2.1.309, 2.1.304–2.1.306 unverified) and never the text; the memory mod also reads `text`, `command`, `isMeta` and `context` (2.1.323). Optional here so the bridge mod's shape stays as it was. */
  export type PromptSubmitInput = {
    readonly origin?: PromptOrigin
    readonly text?: string
    readonly command?: { readonly name: string; readonly args: string }
    readonly isMeta?: true
    readonly context?: readonly string[]
  }
  /** Opaque here: the mod passes it on untouched. */
  export type PromptSubmitResult = Readonly<Record<string, unknown>>

  /** The memory mod reads only `traits` (`analysis`: a `/context` render that sends nothing). */
  export type PromptComposeInput = Readonly<Record<string, unknown>> & {
    readonly traits: readonly string[]
  }
  export type PromptComposeSection = {
    readonly id: string
    readonly text: string
    readonly scope: 'shared' | 'session'
  }
  export type PromptComposeResult = { readonly sections: readonly PromptComposeSection[] }
  /** The file tools' paths; `agentId` is set inside a subagent's loop. */
  export type ToolCallInput = {
    readonly tool: string
    readonly agentId?: string
    readonly file_path?: string
    readonly notebook_path?: string
  }
  export type ToolCallResult = Readonly<Record<string, unknown>> & {
    readonly deny?: string
    readonly isError?: true
    readonly context?: readonly string[]
  }
  export type CommandRunInput = {
    readonly command: string
    readonly args: string
    readonly origin: PromptOrigin
  }
  export type CommandRunResult = { readonly text?: string }
  /** `agentId` is set for a subagent's or a fork's own transcript. */
  export type SessionCompactInput = { readonly trigger: string; readonly agentId?: string }
  export type SessionCompactResult = Readonly<Record<string, unknown>> & { readonly skip?: string }
  export type SessionEndInput = { readonly reason: string }
  /** Opaque here: the mod passes it on untouched. */
  export type SessionEndResult = Readonly<Record<string, unknown>>

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
    (
      event: 'prompt.compose',
      hook: Hook<PromptComposeInput, PromptComposeResult>
    ): Registration<PromptComposeInput, PromptComposeResult>
    (
      event: 'tool.call',
      matcher: { readonly tool: string },
      hook: Hook<ToolCallInput, ToolCallResult>
    ): Registration<ToolCallInput, ToolCallResult>
    (
      event: 'command.run',
      matcher: { readonly command: string },
      hook: ($: Engine, e: CommandRunInput) => CommandRunResult | Promise<CommandRunResult>
    ): unknown
    (
      event: 'session.compact',
      hook: Hook<SessionCompactInput, SessionCompactResult>
    ): Registration<SessionCompactInput, SessionCompactResult>
    (
      event: 'session.end',
      hook: Hook<SessionEndInput, SessionEndResult>
    ): Registration<SessionEndInput, SessionEndResult>
  }

  export type Register = (on: On) => unknown
}
