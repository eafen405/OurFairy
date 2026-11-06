/** Reproducer cleanup regression; substitutes only the acceptance subprocess, never starts a backend. */
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mock, test } from 'node:test'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

test('comparison cleanup retains interrupted and failed-stop copies, and ignores stale reports', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'ourfairy-312-cleanup-check-'))
  const resolvedParent = realpathSync(parent)
  const actualSpawn = childProcess.spawnSync
  const argv = process.argv
  const exitCode = process.exitCode
  let mode
  const calls = []
  mock.method(childProcess, 'spawnSync', (command, args, options) => {
    if (command !== process.execPath || args[0] !== 'scripts/persona-acceptance.ts') return actualSpawn(command, args, options)
    const report = args[args.indexOf('--out') + 1]
    calls.push({ root: options.cwd, resolvedRoot: realpathSync(options.cwd), report })
    if (mode !== 'missing') writeFileSync(report, JSON.stringify(mode === 'checkpoint' ? { samples: [] } : {
      finishedAt: new Date().toISOString(), ...(mode === 'stop-failed' ? { cleanupError: 'fixture: stop failed' } : {}) }))
    return { status: mode === 'checkpoint' ? null : 1, signal: mode === 'checkpoint' ? 'SIGKILL' : null }
  })
  syncBuiltinESMExports()
  try {
    for (const name of ['a', 'merged']) writeFileSync(join(parent, `${name}-real.json`), JSON.stringify({ finishedAt: new Date().toISOString() }))
    for (mode of ['checkpoint', 'missing', 'stop-failed', 'finished']) {
      const before = calls.length
      process.argv = [process.execPath, 'compare.mjs', parent, 'tool-grounding']
      await import(`./compare.mjs?cleanup=${mode}`)
      const run = calls.slice(before)
      assert.equal(run.length, 2)
      assert.notEqual(dirname(run[0].report), parent, 'stale parent reports must not be reused')
      for (const call of run) assert.equal(existsSync(call.root), mode !== 'finished', mode)
      process.exitCode = exitCode
    }
    assert.equal(new Set(calls.map(call => dirname(call.report))).size, 4)
  } finally {
    process.argv = argv
    process.exitCode = exitCode
    mock.restoreAll()
    syncBuiltinESMExports()
    // No backend was started; all retained roots below were created by this test.
    for (const call of calls) if (existsSync(call.root)) {
      assert.equal(realpathSync(call.root), call.resolvedRoot)
      rmSync(call.root, { recursive: true })
    }
    assert.equal(realpathSync(parent), resolvedParent)
    rmSync(parent, { recursive: true })
  }
})
