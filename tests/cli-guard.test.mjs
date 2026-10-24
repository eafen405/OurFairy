/**
 * The CLI guard must fail loudly on a Node that cannot answer the question.
 *
 * `import.meta.main` landed in Node 22.18.0, and on the 24.x line in 24.2.0. A
 * Node below that leaves the field `undefined` — not `false` — so a guard that
 * reads it as a boolean turns "I cannot tell" into "I am not the entry point".
 * The CLI then exits 0 having done nothing, and `npm run build` becomes a
 * silent no-op: the gate passes without building anything. The repository's
 * floor is `^22.19.0 || >=24.2.0` for exactly that reason.
 *
 * The claim is executable in two ways. The helper is called with `undefined`
 * directly, and a load hook rewrites `isCliEntry(import.meta.main)` into
 * `isCliEntry(undefined)` so a real script is loaded the way a Node without
 * the field would load it. The guard then has to throw, and the message has to
 * name the Node the repository needs.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { REQUIRED_NODE_RANGE, isCliEntry } from '../scripts/cli-guard.ts'
import { nodeSatisfies } from '../scripts/ourfairy-backend.ts'
import { repoRoot } from './helpers/backend.mjs'

test('the helper answers for a Node that has the field', () => {
  assert.equal(isCliEntry(true), true, 'the entry point is the entry point')
  assert.equal(isCliEntry(false), false, 'an imported module is not the entry point')
})

test('the helper refuses a Node without the field, naming the Node it needs', () => {
  assert.throws(() => isCliEntry(undefined), (error) => {
    assert.match(error.message, /import\.meta\.main is undefined/u, 'the error must say the field is missing')
    assert.match(error.message, /\^22\.19\.0 \|\| >=24\.2\.0/u, 'the error must name the Node version the repository needs')
    return true
  })
})

test('a CLI loaded as a Node without import.meta.main fails loudly', async () => {
  // The rewrite is the code, not the message: only the call the guard makes is
  // replaced, so the error still names `import.meta.main` and the Node range.
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context)
      const source = result.source
      if (source === null || source === undefined) return result
      const text = Buffer.isBuffer(source) ? source.toString('utf8') : source
      if (typeof text !== 'string' || !text.includes('isCliEntry(import.meta.main)')) return result
      const rewritten = text.replaceAll('isCliEntry(import.meta.main)', 'isCliEntry(undefined)')
      return { ...result, source: Buffer.isBuffer(source) ? Buffer.from(rewritten, 'utf8') : rewritten }
    },
  })
  try {
    await assert.rejects(import('../scripts/bench-gate.ts'), (error) => {
      assert.match(error.message, /import\.meta\.main is undefined/u, 'the CLI must fail, not exit 0 having done nothing')
      assert.match(error.message, /\^22\.19\.0 \|\| >=24\.2\.0/u, 'the error must name the Node version the repository needs')
      return true
    })
  } finally {
    hooks.deregister()
  }
})

test('the declared floor excludes the Node versions without import.meta.main', () => {
  assert.equal(nodeSatisfies(REQUIRED_NODE_RANGE, '24.0.0'), false, '24.0 has no import.meta.main')
  assert.equal(nodeSatisfies(REQUIRED_NODE_RANGE, '24.1.0'), false, '24.1 has no import.meta.main')
  assert.equal(nodeSatisfies(REQUIRED_NODE_RANGE, '24.2.0'), true, '24.2 is the first 24.x that has it')
  assert.equal(nodeSatisfies(REQUIRED_NODE_RANGE, '22.19.0'), true, 'the floor on the 22.x line')
  assert.equal(nodeSatisfies(REQUIRED_NODE_RANGE, '22.18.0'), false, 'the field landed in 22.18.0, but the floor asks for 22.19')
})

test('package.json, combo.json and the guard name the same Node range', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
  assert.equal(manifest.engines.node, REQUIRED_NODE_RANGE, 'package.json engines.node must be the range the guard names')
  assert.equal(combo.backend.nodeRange, REQUIRED_NODE_RANGE, 'combo.json backend.nodeRange must be the range the guard names')
})
