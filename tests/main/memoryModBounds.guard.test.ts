// What the memory mod may do (memory phase 3, addendum §1): it hooks seven events and nothing
// else, and it never denies, drops, draws, registers a tool, submits a prompt, appends to the
// conversation, runs a process, writes a file or breaks the prompt cache: its file read and its
// requests are its one link to main (the `--mcp-config` file, main's routes). It reads the env var
// and serves the command the protocol names. The bridge mod keeps its four events. Read through the TypeScript AST: a comment that names a banned call is never
// counted, only code.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import ts from 'typescript'
import { CONFIG_ENV, REMEMBER_COMMAND } from '../../src/mod/watcher-memory/hooks/protocol'
import { SRC, parseSource } from './sourceScan'

/** The event names of every `on('<event>', …)` call in the file. */
function eventsOf(rel: string): Set<string> {
  const events = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'on' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      events.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(join(SRC, rel)))
  return events
}

/** The literal names the engine reads from the file: each `$.env.get('<name>')`, each
 *  `$.command.register({ name: '<name>' })` and each `on('command.run', { command: '<name>' })`.
 *  The engine wants these as literals, so they cannot import the protocol's constants. */
function literalNamesOf(rel: string): { env: string[]; registered: string[]; served: string[] } {
  const names: { env: string[]; registered: string[]; served: string[] } = {
    env: [],
    registered: [],
    served: []
  }
  const key = (arg: ts.Expression | undefined, prop: string): string | undefined => {
    if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return undefined
    for (const p of arg.properties) {
      if (
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === prop &&
        ts.isStringLiteral(p.initializer)
      ) {
        return p.initializer.text
      }
    }
    return undefined
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText()
      const [first, second] = node.arguments
      if (callee === '$.env.get' && first !== undefined && ts.isStringLiteral(first)) {
        names.env.push(first.text)
      }
      const registered = callee === '$.command.register' ? key(first, 'name') : undefined
      if (registered !== undefined) names.registered.push(registered)
      const served =
        callee === 'on' &&
        first !== undefined &&
        ts.isStringLiteral(first) &&
        first.text === 'command.run'
          ? key(second, 'command')
          : undefined
      if (served !== undefined) names.served.push(served)
    }
    ts.forEachChild(node, visit)
  }
  visit(parseSource(join(SRC, rel)))
  return names
}

/** The file's code as the compiler prints it, with every comment left out. */
function codeOf(rel: string): string {
  return ts.createPrinter({ removeComments: true }).printFile(parseSource(join(SRC, rel)))
}

describe('the memory mod’s bounds', () => {
  it('the memory mod hooks only its seven events', () => {
    expect(eventsOf('mod/watcher-memory/hooks/register.ts')).toEqual(
      new Set([
        'session.start',
        'prompt.compose',
        'prompt.submit',
        'tool.call',
        'command.run',
        'session.compact',
        'session.end'
      ])
    )
  })

  it('the memory mod never denies, drops, draws, registers a tool, submits, appends or breaks the cache', () => {
    const code = codeOf('mod/watcher-memory/hooks/register.ts')
    expect(
      [
        'deny:',
        'drop:',
        'breakPromptCache',
        '$.ui.',
        '$.tool.register',
        '$.prompt.',
        '$.session.append',
        '$.process.',
        '$.fs.write'
      ].filter((banned) => code.includes(banned))
    ).toEqual([])
  })

  it('the memory mod reads the protocol’s env var and serves the protocol’s command, by literal name', () => {
    expect(literalNamesOf('mod/watcher-memory/hooks/register.ts')).toEqual({
      env: [CONFIG_ENV],
      registered: [REMEMBER_COMMAND.name],
      served: [REMEMBER_COMMAND.name]
    })
  })

  it('the bridge mod still hooks only its four events', () => {
    expect(eventsOf('mod/watcher-bridge/hooks/register.ts')).toEqual(
      new Set(['session.start', 'prompt.context', 'prompt.submit', 'turn.complete'])
    )
  })
})
