/**
 * The disposable verification runner (#297).
 *
 * These cases exercise the runner directly: a real bwrap namespace, a real
 * `/bin/bash -lc` command, a real exit code, a bounded timeout and abort, and
 * the invariant that the shared environment root is never written. The
 * backend suite then proves the same runner through `skill_manage create`.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { after, test } from 'node:test'
import { runVerification } from '../backend/skill-creator/dist/verify.js'

const cleanup = []
after(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
})

/** A temporary skill data root with one valid package. */
function fixture(prefix = 'skill-verify-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(root)
  const packageDir = join(root, 'source')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'SKILL.md'), '---\nname: verify-demo\ndescription: Use when verifying.\n---\n\n# Workflow\n\nDo it.\n')
  writeFileSync(join(packageDir, 'check.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return { root, packageDir }
}

const TIMEOUT_MS = 30_000

test('a scenario runs for real inside a disposable bwrap directory and its report names the command and exit code', async () => {
  const { root, packageDir } = fixture()
  const sharedEnv = join(root, '..', 'env')
  mkdirSync(sharedEnv, { recursive: true })
  writeFileSync(join(sharedEnv, 'sentinel'), 'untouched')
  const before = readFileSync(join(sharedEnv, 'sentinel'), 'utf8')

  const report = await runVerification({
    root,
    packageDir,
    timeoutMs: TIMEOUT_MS,
    scenarios: [
      { name: 'reads its own package', command: 'test -f SKILL.md && cat SKILL.md' },
      { name: 'exits non-zero', command: 'echo bad >&2; exit 3' },
    ],
  })

  assert.equal(report.complete, true, 'a completed run is complete even when a scenario fails')
  assert.equal(report.executed.length, 1)
  assert.equal(report.failed.length, 1)
  assert.deepEqual(report.reused, [])

  const [executed] = report.executed
  assert.equal(executed.name, 'reads its own package')
  assert.equal(executed.command, 'test -f SKILL.md && cat SKILL.md')
  assert.equal(executed.exitCode, 0)
  assert.equal(executed.status, 'executed')
  assert.ok(executed.durationMs >= 0)
  assert.ok(executed.stdoutSummary.includes('verify-demo'), 'the command read the copied package')
  assert.ok(executed.environment.cwd.includes(`${sep}verify${sep}`), `the cwd is under verify/: ${executed.environment.cwd}`)
  assert.ok(executed.environment.home.includes(`${sep}verify${sep}`), `HOME is under verify/: ${executed.environment.home}`)
  assert.ok(!executed.environment.cwd.includes(`${sep}candidates${sep}`), 'the candidate directory itself is never the cwd')

  const [failed] = report.failed
  assert.equal(failed.name, 'exits non-zero')
  assert.equal(failed.exitCode, 3)
  assert.match(failed.stderrSummary, /bad/u)

  assert.deepEqual(readdirSync(join(root, 'verify')), [], 'the disposable directory is deleted after the run')
  assert.equal(readFileSync(join(sharedEnv, 'sentinel'), 'utf8'), before, 'the shared env root is untouched')
  assert.ok(report.environment.includes('bwrap'), `the report names the confinement: ${report.environment}`)
})

test('a scenario past its timeout is stopped and recorded as failed, not executed', async () => {
  const { root, packageDir } = fixture('skill-verify-timeout-')
  const started = Date.now()
  const report = await runVerification({
    root,
    packageDir,
    timeoutMs: TIMEOUT_MS,
    scenarios: [{ name: 'sleeps', command: 'sleep 5', timeoutMs: 1_000 }],
  })
  const elapsed = Date.now() - started

  assert.equal(report.executed.length, 0)
  assert.equal(report.failed.length, 1)
  assert.equal(report.failed[0].timedOut, true)
  assert.equal(report.failed[0].exitCode, null)
  assert.ok(elapsed < 4_500, `the verifier stopped the child at its bound; took ${elapsed}ms`)
})

test('an abort stops the running command and leaves the remaining scenarios unexecuted', async () => {
  const { root, packageDir } = fixture('skill-verify-abort-')
  const controller = new AbortController()
  const running = runVerification({
    root,
    packageDir,
    timeoutMs: TIMEOUT_MS,
    signal: controller.signal,
    scenarios: [
      { name: 'long', command: 'sleep 5', timeoutMs: 10_000 },
      { name: 'never runs', command: 'true' },
    ],
  })
  setTimeout(() => controller.abort(), 300)
  const report = await running

  assert.equal(report.complete, false, 'an aborted run is incomplete')
  assert.equal(report.executed.length, 0)
  assert.equal(report.failed.length, 1)
  assert.match(report.failed[0].reason ?? '', /abort/iu)
  assert.deepEqual(report.unexecuted.map(entry => entry.name), ['never runs'])
  assert.equal(report.unexecuted[0].status, 'unexecuted')
})

test('without a working bwrap the runner reports unexecuted scenarios and an incomplete report', async () => {
  const { root, packageDir } = fixture('skill-verify-nobwrap-')
  const report = await runVerification({
    root,
    packageDir,
    timeoutMs: TIMEOUT_MS,
    bwrapPath: '/nonexistent/does-not-run',
    scenarios: [{ name: 'never', command: 'true' }],
  })

  assert.equal(report.complete, false)
  assert.equal(report.executed.length, 0)
  assert.equal(report.unexecuted.length, 1)
  assert.match(report.unexecuted[0].reason ?? '', /bwrap/u)
  assert.ok(!existsSync(join(root, 'verify')) || readdirSync(join(root, 'verify')).length === 0,
    'the failed run leaves no disposable directory behind')
})
