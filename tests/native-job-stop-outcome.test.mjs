/**
 * Ticket #165 (spec #135): `/chat/jobs/stop` maps only the native
 * `JobRegistry.kill` outcomes the product knows.
 *
 * The native vocabulary is an exported *type*, so the compiler cannot check
 * the product's mapping for us. The reconciliation below reads the pinned dsh
 * `JobRegistry.kill` declaration with the TypeScript compiler API and compares
 * it member by member with the product's outcome table; adding or dropping a
 * native member fails here and names it instead of folding the value into
 * "already finished".
 *
 * The adapter test drives the stop handler with a native outcome the table
 * cannot name; the booted suite cannot produce one because the native registry
 * only ever reports its own members. The runtime stub supplies the task-lookup
 * result directly, so the adapter test does not build a whole session
 * projection to reach the outcome mapping.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'
import { repoRoot } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshRoot = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const { installJobs, STOP_OUTCOME } = await import('../backend/chat/dist/jobs.js')

/** The string-literal members of the pinned dsh `JobRegistry.kill` return type. */
function nativeStopOutcomes() {
  const path = join(dshRoot, 'packages', 'jobs', 'jobs', 'lib', 'types', 'index.d.ts')
  const ts = createRequire(join(dshRoot, 'package.json'))('typescript')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const registry = source.statements.find(statement =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'JobRegistry')
  assert.ok(registry !== undefined, `${path} must declare the JobRegistry class`)
  const kill = registry.members.find(member =>
    ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === 'kill')
  assert.ok(kill !== undefined, 'JobRegistry must declare a kill method')
  assert.ok(kill.type !== undefined, 'JobRegistry.kill must declare its return type')
  const members = ts.isUnionTypeNode(kill.type) ? kill.type.types : [kill.type]
  return members.map(member => {
    assert.ok(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
      `JobRegistry.kill must return a union of string literals; got ${member.getText(source)}`)
    return member.literal.text
  })
}

/** One stop call through the adapter, with a native `kill` result the test chooses. */
function stop(result, available = true) {
  const task = { taskId: 'generation-1/job-1', availability: available ? 1 : 0, output: { earliest: 0, total: 0 } }
  const calls = []
  const ctx = { jobs: {
    events: { subscribe: () => {} },
    kill: (...args) => { calls.push(args); return result },
  } }
  const runtime = {
    open: async () => ({ sessionId: 'session-1' }),
    taskOf: () => ({ task, jobId: available ? 'job-1' : null }),
    barrier: async () => {},
  }
  return { done: installJobs(ctx, runtime).jobStop('session-1', { sessionId: 'session-1', taskId: task.taskId }), calls }
}

test('native job stop outcome vocabulary matches the adapter', () => {
  const native = nativeStopOutcomes()
  const mapped = Object.keys(STOP_OUTCOME)
  const unmapped = native.filter(outcome => !mapped.includes(outcome))
  const stale = mapped.filter(outcome => !native.includes(outcome))

  assert.deepEqual({ unmapped, stale }, { unmapped: [], stale: [] },
    `the stop outcome table must match the pinned dsh JobRegistry.kill return type; native members with no wire outcome: ${unmapped.join(', ') || 'none'}; product keys with no native member: ${stale.join(', ') || 'none'}`)
})

test('known native stop outcomes keep their numeric wire contract', async () => {
  const requested = stop('requested')
  assert.equal(await requested.done, 1)
  assert.deepEqual(requested.calls, [['job-1', 'session-1', 'cancelled by the user']],
    'the stop handler kills the native JobId the task lookup returned')
  assert.equal(await stop('already-finished').done, 2)
  const unavailable = stop('requested', false)
  assert.equal(await unavailable.done, 0)
  assert.deepEqual(unavailable.calls, [], 'an unavailable task keeps returning 0 without calling kill')
})

test('an unknown native stop outcome is a 500 product error naming it', async () => {
  await assert.rejects(stop('paused').done, error => {
    assert.equal(error.status, 500, `the stop outcome error must be the documented 500; got ${error.status}`)
    assert.equal(error.code, 'chat/unknown-stop-outcome',
      `the stop outcome error must carry chat/unknown-stop-outcome; got ${error.code}`)
    assert.match(error.message, /paused/, `the stop outcome error must name the native value; got ${error.message}`)
    return true
  })
})
