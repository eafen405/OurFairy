/**
 * Ticket #163 (spec #135): the native `JobStatus` vocabulary stays reconciled
 * with the product's wire task status.
 *
 * The native vocabulary is an exported *type*, so the compiler cannot check a
 * runtime table for us. The reconciliation below reads the pinned dsh
 * declaration with the TypeScript compiler API and compares it member by
 * member with the product's mapping keys; adding or dropping a native member
 * fails here and names it instead of leaking `undefined` into the projection.
 *
 * The adapter test drives `/chat/jobs/output`'s handler with a native job
 * status the table cannot name; the booted suite cannot produce one because
 * the native registry only ever reports its own members. The runtime stub
 * supplies the task-lookup result directly, so the adapter test does not build
 * a whole session projection to reach the status mapping.
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
const units = await import('../backend/chat/dist/units.js')

/** The string-literal members of the pinned dsh `JobStatus` declaration. */
function nativeJobStatuses() {
  const path = join(dshRoot, 'packages', 'jobs', 'jobs', 'lib', 'types', 'view.d.ts')
  const ts = createRequire(join(dshRoot, 'package.json'))('typescript')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(statement =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === 'JobStatus')
  assert.ok(declaration !== undefined, `${path} must declare the exported JobStatus type`)
  const members = ts.isUnionTypeNode(declaration.type) ? declaration.type.types : [declaration.type]
  return members.map(member => {
    assert.ok(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
      `JobStatus must be a union of string literals; got ${member.getText(source)}`)
    return member.literal.text
  })
}

test('native job status vocabulary matches the projection', () => {
  const native = nativeJobStatuses()
  const projected = Object.keys(units.TASK_STATUS)
  const unmapped = native.filter(status => !projected.includes(status))
  const stale = projected.filter(status => !native.includes(status))

  assert.deepEqual({ unmapped, stale }, { unmapped: [], stale: [] },
    `the task status table must match the pinned dsh JobStatus; native members with no wire status: ${unmapped.join(', ') || 'none'}; product keys with no native member: ${stale.join(', ') || 'none'}`)
})

test('an unmapped native job status is an explicit unknown in /chat/jobs/output', async () => {
  const { installJobs } = await import('../backend/chat/dist/jobs.js')
  const native = { id: 'job-1', owner: 'session-1', kind: 'bash', label: 'unmapped status',
    status: 'paused', startedAt: 1, output: { earliest: 0, total: 0 } }
  const ctx = { jobs: {
    events: { subscribe: () => {} },
    get: () => native,
    readAt: () => ({ chunks: [], next: 0, lossy: false }),
  } }
  // The operation reads the task through the runtime's narrow lookup: the stub
  // supplies the row and native identity instead of constructing a projection.
  const task = { taskId: 'generation-1/job-1', kind: 'bash', label: 'unmapped status', status: 0,
    availability: 1, startedAt: 1, output: { earliest: 0, total: 0 }, report: { status: 0 } }
  const runtime = {
    open: async () => ({ sessionId: 'session-1' }),
    taskOf: (_state, taskId) => taskId === task.taskId ? { task, jobId: 'job-1' } : null,
  }
  const { jobOutput } = installJobs(ctx, runtime)
  const output = await jobOutput('session-1', { sessionId: 'session-1', taskId: 'generation-1/job-1', from: 0 })

  assert.ok(Object.hasOwn(output, 'status'), 'the output status must be present, never undefined')
  assert.equal(output.status, 0)
})
