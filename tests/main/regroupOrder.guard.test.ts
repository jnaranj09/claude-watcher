// The one-time memory cleanup (`regroupMemoryTasks`, src/main/memory/sessionGoalStart.ts) runs
// before memory's catch-up in `src/main/index.ts`, so a catch-up save cannot make a goal the
// cleanup then makes again. And the goals store built on the real file passes `backupCopy:`: the
// default copies nothing, so a lost wiring would drop the pre-cleanup copy without a sound.
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import ts from 'typescript'
import { SRC, parseSource } from './sourceScan'

interface Scan {
  regroup: number | null
  catchUp: number | null
  /** One entry per `createGoalsStore({ blobStore: … })` call: whether it also passes `backupCopy`. */
  blobStores: boolean[]
}

function callee(call: ts.CallExpression): string {
  return ts.isIdentifier(call.expression) ? call.expression.text : ''
}

function propNames(call: ts.CallExpression): string[] {
  const [arg] = call.arguments
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return []
  return arg.properties.flatMap((p) =>
    p.name !== undefined && ts.isIdentifier(p.name) ? [p.name.text] : []
  )
}

function scan(text: string): Scan {
  const sf = parseSource(join(SRC, 'main/index.ts'), text)
  const out: Scan = { regroup: null, catchUp: null, blobStores: [] }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = callee(node)
      const at = node.getStart(sf)
      if (name === 'regroupMemoryTasks') out.regroup ??= at
      if (name === 'startMemoryCatchUp') out.catchUp ??= at
      if (name === 'createGoalsStore') {
        const props = propNames(node)
        if (props.includes('blobStore')) out.blobStores.push(props.includes('backupCopy'))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** The offences in one `index.ts` text; empty = the order and the wiring hold. */
function offences(text: string): string[] {
  const s = scan(text)
  const out: string[] = []
  if (s.regroup === null) out.push('no regroupMemoryTasks( call')
  if (s.catchUp === null) out.push('no startMemoryCatchUp() call')
  if (s.regroup !== null && s.catchUp !== null && s.regroup > s.catchUp) {
    out.push('regroupMemoryTasks( comes after startMemoryCatchUp()')
  }
  if (s.blobStores.length === 0) out.push('no createGoalsStore call passes blobStore:')
  if (s.blobStores.includes(false))
    out.push('a createGoalsStore with blobStore: has no backupCopy:')
  return out
}

const GOOD = `
const goalsStore = createGoalsStore({ blobStore: b, backupCopy: () => b.copy('x') })
const mem = createGoalsStore({ proposals: p })
regroupMemoryTasks({ goals: goalsStore })
startMemoryCatchUp()
`

describe('regroup order scan', () => {
  it('passes the cleanup before the catch-up with the backup wired', () => {
    expect(offences(GOOD)).toEqual([])
  })

  it('fails when the cleanup comes after the catch-up', () => {
    const text = GOOD.replace(
      'regroupMemoryTasks({ goals: goalsStore })\nstartMemoryCatchUp()',
      'startMemoryCatchUp()\nregroupMemoryTasks({ goals: goalsStore })'
    )
    expect(offences(text)).toEqual(['regroupMemoryTasks( comes after startMemoryCatchUp()'])
  })

  it('fails when either call is missing', () => {
    expect(offences(GOOD.replace('regroupMemoryTasks({ goals: goalsStore })', ''))).toEqual([
      'no regroupMemoryTasks( call'
    ])
    expect(offences(GOOD.replace('startMemoryCatchUp()', ''))).toEqual([
      'no startMemoryCatchUp() call'
    ])
  })

  it('fails when the blobStore store does not pass backupCopy', () => {
    expect(offences(GOOD.replace(", backupCopy: () => b.copy('x')", ''))).toEqual([
      'a createGoalsStore with blobStore: has no backupCopy:'
    ])
  })

  it('fails when no createGoalsStore call passes blobStore', () => {
    const text = GOOD.replace("{ blobStore: b, backupCopy: () => b.copy('x') }", '{ proposals: p }')
    expect(offences(text)).toEqual(['no createGoalsStore call passes blobStore:'])
  })
})

describe('regroup order guard', () => {
  it('src/main/index.ts runs the cleanup before the catch-up and wires the pre-cleanup copy', () => {
    expect(offences(parseSource(join(SRC, 'main/index.ts')).getFullText())).toEqual([])
  })
})
