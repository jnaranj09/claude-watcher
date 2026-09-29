// Programmatic API — `POST /v1/sessions`. The one WRITE the API has: it creates a card from a
// template the operator already wrote in the app, and starts claude on that template's own
// initial prompt.
//
// THE PROMPT IS NEVER THE CALLER'S. A client sends a template id and a list of arg VALUES; the
// prose is the template's `initialPrompt`, authored in the app and validated by
// `InitialPromptSchema` when it was saved. That is the whole security posture of this route: an
// HTTP caller can fill `$1..$n` in a sentence the operator wrote, not hand claude a sentence of
// its own. Each value is then held to the template param's OWN rules — count, then max length,
// then the ANCHORED regex (`compileParamPattern` wraps and anchors so a template author cannot
// forget to, and a pattern that does not compile refuses every value rather than accepting them).
//
// The decision ORDER matters and is the thing the tests pin: every gate that can refuse the
// request runs BEFORE `requestLaunch`, so a refused create never leaves a half-made card on the
// operator's board. `awaitSessionId` is the only await after the launch, and its timeout is a 504
// — the card exists, the caller just did not get its id in time.
//
// NEVER-LOG-THE-VALUE: the body carries an operator-typed `name` and the arg values, and the
// expansion carries the template's prose. The only line this file logs is a bare `code=`.
// [.claude/rules/zod-boundaries.md; src/shared/schemas/api.ts; src/shared/prompt/expand.ts]
import {
  EmptySchema,
  SessionsCreateBodySchema,
  SessionsCreateOutputSchema
} from '../../../shared/schemas/api'
import { compileParamPattern, type Template } from '../../../shared/schemas/template'
import { expand } from '../../../shared/prompt/expand'
import { isFolderMissing } from '../../pty/launchSession'
import { defineCommand, type ApiErr } from '../registry'

/** Count, then length, then control characters, then the anchored regex. `path` names the
 *  offending index. Values are never logged or echoed. */
export function validateArgs(
  template: Template,
  args: readonly string[]
): { ok: true } | { ok: false; path: string } {
  if (args.length !== template.params.length) return { ok: false, path: 'args' }
  for (let i = 0; i < args.length; i++) {
    const param = template.params[i]
    const value = args[i]
    if (param === undefined || value === undefined) return { ok: false, path: `args.${i}` }
    if (value.length > param.maxLength) return { ok: false, path: `args.${i}` }
    // Control characters are refused HERE, per index, even though `expand` refuses them too: an
    // operator's pattern can happily admit one (`.` matches ESC, `[^\n]` matches BEL), and the
    // expander reports an index only for a MISSING arg — so without this check the caller is
    // told "something in `args`" and has to guess which value. `expand`'s check stays as the
    // backstop; it also serves the renderer's expander box, which never runs `validateArgs`.
    if (/\p{Cc}/u.test(value)) return { ok: false, path: `args.${i}` }
    const re = compileParamPattern(param.pattern)
    // A pattern that does not compile refuses EVERY value. The template schema already rejects
    // such a pattern on save, so this is the fail-closed backstop for a file edited by hand.
    if (re === null || !re.test(value)) return { ok: false, path: `args.${i}` }
  }
  return { ok: true }
}

const err = (status: ApiErr['status'], code: ApiErr['code'], path?: string): ApiErr => ({
  ok: false,
  status,
  code,
  ...(path !== undefined ? { path } : {})
})

export const sessionsCreateCommand = defineCommand({
  id: 'sessions.create',
  method: 'POST',
  path: '/v1/sessions',
  summary: 'Create a card from a template and start claude on its initial prompt',
  description:
    "The prompt is the template's own `initialPrompt` (written in the app). `args` fill `$1..$n` in order; " +
    "each value must match the template param's regex and max length. The card lands in the template's " +
    'workspace, or the active one for a global template. Returns once the session id is bound (≤ 5 s). ' +
    "409 `folder_missing`: the template's folder no longer exists (deleted, renamed or unmounted). " +
    '503 `hooks_unavailable`: the app is not receiving claude hooks (its hook port is taken), so the ' +
    'card could never report a status — retry once the app shows its hooks healthy.',
  params: EmptySchema,
  query: EmptySchema,
  body: SessionsCreateBodySchema,
  output: SessionsCreateOutputSchema,
  successStatus: 201,
  errorStatuses: [400, 401, 404, 409, 503, 504],
  async handler(ctx, { body }) {
    const template = ctx.templates.get(body.templateId)
    if (template === null) return err(404, 'template_not_found')
    // A template with no prompt is a UI-only template (the `+ New session` popover launches it
    // into a terminal). There is nothing for an API caller to fill, so this is its own code
    // rather than an `arg_invalid` the caller cannot act on.
    if (template.initialPrompt === null) return err(400, 'template_has_no_prompt')
    const args = validateArgs(template, body.args)
    if (!args.ok) return err(400, 'arg_invalid', args.path)
    const expanded = expand(template.initialPrompt, body.args)
    if (!expanded.ok) {
      // `too_long` is the ONE expander failure that is not about a single value: the caps compose
      // (a ≤ 2000-char prompt plus ≤ 200-char values can exceed 2000), so it names no path. Every
      // other failure is about the values as a whole — the expander reports an INDEX only for a
      // MISSING arg, which `validateArgs` has already refused — so it is `args`.
      return expanded.error.code === 'too_long'
        ? err(400, 'prompt_too_long')
        : err(400, 'arg_invalid', 'args')
    }
    // THE GUARD BELONGS ON THE RESULT, not on the template text. `InitialPromptSchema` refuses a
    // prompt that STARTS with `-` (claude would parse it as a flag), but a placeholder-first
    // template (`$1 …`, or just `$1`) passes that gate and the CALLER's value lands in front of
    // it — so a free pattern (`.+`, a plausible "ticket title" param) would let
    // `--dangerously-skip-permissions` reach claude as the last argv token. A flag is worse than
    // a sentence, and "a caller fills a sentence, never hands claude one" is the whole posture of
    // this route. The index of the leading placeholder is not cheaply knowable here (`$7` may be
    // what sits first), so the path is the whole `args` field. `composeClaudeCommand` also emits
    // ` -- ` before the positional prompt; that is the belt to this brace, and it covers every
    // launch path rather than just this one.
    if (/^\s*-/.test(expanded.value)) return err(400, 'arg_invalid', 'args')
    // UX-11 — the template's folder must still exist. node-pty spawns into a missing cwd without
    // throwing: the child fails its chdir and exits, and the caller used to get a 201 for a card
    // that flashed and died. 409, not 400: the request is well-formed, the WORLD disagrees, and
    // retrying cannot fix it — the operator re-creates the folder or edits the template. It comes
    // BEFORE the 503s so a caller learns it whether or not a window is open. The launch service
    // refuses the same folder again (the backstop for the moment between here and the launch).
    if (!ctx.isDirectory(template.cwd)) return err(409, 'folder_missing')
    // 503s are RETRYABLE and come last among the refusals: a caller whose request is malformed
    // should learn that whether or not a window happens to be open right now.
    if (!ctx.claudeVersionAllowsLaunch()) return err(503, 'claude_version')
    // SEC-6 — the hook port is held by another program (or the server failed), so main would
    // spawn claude WITHOUT `--settings` and the card could never move. A 201 for a card nobody can
    // watch is the silent failure the server-health banner exists to prevent; an HTTP caller never
    // sees that banner, so it gets this code. Retryable: freeing the port and restarting fixes it.
    if (!ctx.hooksListening()) return err(503, 'hooks_unavailable')
    const seam = ctx.seam()
    if (seam === null) return err(503, 'no_window')
    // A template scoped to a workspace lands there; a GLOBAL one (null) lands in whatever the
    // operator is looking at. A scope that no longer exists is refused rather than silently
    // redirected to the active workspace — a card appearing somewhere the template does not
    // belong is worse than a 400 the caller can fix by re-scoping the template.
    let workspaceId: string
    if (template.workspaceId === null) {
      workspaceId = ctx.workspaces.activeId()
    } else {
      if (ctx.workspaces.get(template.workspaceId) === null) {
        return err(400, 'template_workspace_gone')
      }
      workspaceId = template.workspaceId
    }
    let launched: { terminalId: string }
    try {
      launched = seam.requestLaunch({
        cwd: template.cwd,
        name: body.name,
        templateId: template.id,
        flags: {
          model: template.model,
          permissionMode: template.permissionMode,
          effort: template.effort
        },
        initialPrompt: expanded.value,
        workspaceId
      })
    } catch (e) {
      // The launch service's own preflight (the backstop for a folder that vanished since the
      // check above). Anything else is not ours to name: rethrow → the router's 500 `internal`.
      if (isFolderMissing(e)) return err(409, 'folder_missing')
      throw e
    }
    const { terminalId } = launched
    try {
      const sessionId = await seam.awaitSessionId(terminalId, ctx.spawnTimeoutMs)
      return { ok: true, status: 201, body: { sessionId, terminalId, workspaceId } }
    } catch {
      // The thrown value is DROPPED: it is the seam's own Error and can quote the launch. The
      // card itself is real and stays on the board — only the binding did not arrive in time.
      ctx.log('[claude-watcher][api] code=spawn_timeout')
      return err(504, 'spawn_timeout')
    }
  }
})
