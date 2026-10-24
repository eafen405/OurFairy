import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { describeRun, makeHome, readReport, removeHome, runBackend, startArgs, writeOverlay } from './helpers/backend.mjs'

test('start reports a failed readiness check instead of waiting for the ready deadline', () => {
  const home = makeHome('ourfairy-failed-readiness-')
  const env = { OURFAIRY_HOME: home }
  try {
    const overlay = writeOverlay(home, [{ id: 'identity', config: { sessionTtlDays: 30 } }])
    const run = runBackend([...startArgs([overlay]), '--ready-timeout-ms', '15000'], env)
    assert.notEqual(run.code, 0, describeRun('invalid identity start', run))
    const report = readReport(join(home, 'run/start-report.json'))
    assert.equal(report.ok, false)
    assert.match(run.stderr, /reported a failed readiness check/u, describeRun('start', run))
    assert.equal(existsSync(join(home, 'run/backend.json')), false, 'failed start must remove the running state')
    const stopped = runBackend(['stop', '--json'], env)
    assert.equal(stopped.code, 0, describeRun('stop after failed start', stopped))
    assert.match(stopped.stdout, /no recorded backend/u)
  } finally {
    runBackend(['stop'], env)
    removeHome(home)
  }
})

test('start reports a process exit before readiness and removes the running state', () => {
  const home = makeHome('ourfairy-exited-before-ready-')
  const env = { OURFAIRY_HOME: home }
  try {
    const module = join(home, 'exit-on-load.mjs')
    writeFileSync(module, 'export function apply() { process.exit(23) }\n')
    const overlay = writeOverlay(home, [{ insert: [{ id: 'exit-on-load', name: pathToFileURL(module).href }] }])
    const run = runBackend([...startArgs([overlay]), '--ready-timeout-ms', '15000'], env)
    assert.notEqual(run.code, 0, describeRun('exited start', run))
    assert.match(run.stderr, /exited before reporting ready/u, describeRun('start', run))
    assert.equal(existsSync(join(home, 'run/backend.json')), false)
  } finally {
    runBackend(['stop'], env)
    removeHome(home)
  }
})
