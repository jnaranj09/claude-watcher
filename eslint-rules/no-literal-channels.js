/**
 * Story 0.2 — authored `no-literal-channels` ESLint rule (AC-4).
 *
 * Bans string-literal channel names at IPC call sites: the channel (first arg)
 * to `ipcMain.handle` / `ipcMain.on` / `ipcRenderer.invoke` / `ipcRenderer.send`
 * / `ipcRenderer.on` MUST be a member of the typed `CH` contract
 * (`src/shared/ipc/contract.ts`), never a raw string. This makes the main<->
 * renderer seam compiler-enforced and drift-resistant.
 *
 * Mechanism (architecture.md#Enforcement): an AST selector matching those
 * CallExpressions whose first argument is a string Literal (or template literal),
 * reported. A `CH.*` MemberExpression channel passes cleanly.
 *
 * Note: the AUTOMATED fixture-test runner (Vitest) is Story 0.3 — for Story 0.2
 * the rule + fixtures exist and are demonstrated via `eslint <fixture>`.
 *
 * Exported as a flat-config plugin object: `{ rules: { 'no-literal-channels': rule } }`.
 */

/**
 * IPC methods whose FIRST argument is a channel name. Covers the full
 * channel-first surface of ipcMain/ipcRenderer (EventEmitter aliases included)
 * so a literal cannot slip through a less-common subscribe/teardown method.
 * [Review 2026-06-18 — Patch: was missing once/handleOnce/off/addListener/…]
 */
const IPC_METHODS = new Set([
  'handle',
  'handleOnce',
  'on',
  'once',
  'off',
  'invoke',
  'send',
  'addListener',
  'prependListener',
  'prependOnceListener',
  'removeListener',
  'removeAllListeners',
  'removeHandler'
])

/** Objects on which those methods are IPC calls. */
const IPC_OBJECTS = new Set(['ipcMain', 'ipcRenderer'])

/** @type {import('eslint').Rule.RuleModule} */
const noLiteralChannels = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow string-literal IPC channel names; require members of the CH contract (src/shared/ipc/contract.ts).'
    },
    schema: [],
    messages: {
      literalChannel:
        'IPC channel must be a CH.* const from src/shared/ipc/contract.ts, not a string literal. Found {{ method }}({{ value }}, …).',
      computedChannel:
        'IPC channel must be a CH.* const from src/shared/ipc/contract.ts, not a runtime-built string. Found {{ method }}(<concatenation/interpolation>, …).'
    }
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        // Match `<obj>.<method>(...)` where obj is ipcMain/ipcRenderer and method is an IPC method.
        if (callee.type !== 'MemberExpression') return
        // Resolve the method name from BOTH `obj.method(...)` (Identifier property)
        // and computed `obj['method'](...)` (string-Literal property) so bracket
        // access cannot bypass the rule.
        // [Review 2026-06-18 — Patch: computed-member access was a false negative]
        const prop = callee.property
        let method = null
        if (!callee.computed && prop.type === 'Identifier') {
          method = prop.name
        } else if (callee.computed && prop.type === 'Literal' && typeof prop.value === 'string') {
          method = prop.value
        }
        if (method === null || !IPC_METHODS.has(method)) return
        if (callee.object.type !== 'Identifier' || !IPC_OBJECTS.has(callee.object.name)) return

        const firstArg = node.arguments[0]
        if (!firstArg) return

        // A plain string literal channel — banned.
        const isStringLiteral = firstArg.type === 'Literal' && typeof firstArg.value === 'string'
        // A template literal with no expressions is effectively a string literal — banned too.
        const isPlainTemplate =
          firstArg.type === 'TemplateLiteral' && firstArg.expressions.length === 0

        if (isStringLiteral || isPlainTemplate) {
          const value = isStringLiteral
            ? JSON.stringify(firstArg.value)
            : '`' + (firstArg.quasis[0]?.value.raw ?? '') + '`'
          context.report({
            node: firstArg,
            messageId: 'literalChannel',
            data: { method, value }
          })
          return
        }

        // A channel built at runtime from string parts — a concatenation
        // (`'pty' + ':start'`) or an interpolated template (`` `pty:${x}` ``) —
        // is neither a CH member nor type-checked as a Channel; ban it too.
        // [Review 2026-06-18 — Patch: runtime-built literals were a false negative]
        const isStringConcat = firstArg.type === 'BinaryExpression' && firstArg.operator === '+'
        const isInterpolatedTemplate =
          firstArg.type === 'TemplateLiteral' && firstArg.expressions.length > 0

        if (isStringConcat || isInterpolatedTemplate) {
          context.report({
            node: firstArg,
            messageId: 'computedChannel',
            data: { method }
          })
        }
      }
    }
  }
}

export default {
  rules: {
    'no-literal-channels': noLiteralChannels
  }
}
