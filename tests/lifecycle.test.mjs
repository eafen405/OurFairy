/**
 * Lifecycle evidence for ticket #24: start, status, duplicate start, stop.
 *
 * The supervised process is the real pinned-dsh boot with the product bundle
 * plus the test-only probe; `start` returns only after the probe reports ready.
 * The assertions cover the ticket's requirement that repeated start/destroy
 * leaks neither ports nor child processes.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'

const home = makeHome('ourfairy-lifecycle-')
const env = { OURFAIRY_HOME: home, DEEPSEEK_API_KEY: undefined, DEEPSEEK_BASE_URL: undefined }
after(() => removeHome(home))

function parseSummary(text, label) {
  const start = text.indexOf('{')
  assert.ok(start >= 0, `${label} printed no JSON summary:\n${text}`)
  return JSON.parse(text.slice(start))
}

test('duplicate start is refused, stop is clean, and nothing leaks across cycles', async () => {
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const started = runBackend(['start'], env)
    assert.equal(started.code, 0, describeRun(`start (cycle ${cycle})`, started))
    const summary = parseSummary(started.stdout, 'start')
    assert.equal(summary.ready, true, `start must wait for probe readiness; got ${JSON.stringify(summary)}`)
    assert.deepEqual(
      summary.listeningPorts,
      [],
      `the v1 baseline binds no ports; pid ${summary.pid} listened on ${JSON.stringify(summary.listeningPorts)}`,
    )

    const status = runBackend(['status'], env)
    assert.equal(status.code, 0, describeRun('status', status))
    const state = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')))
    assert.equal(state.running, true, `status must report the started pid as running: ${status.stdout}`)
    assert.equal(state.pid, summary.pid, 'status must report the same pid start returned')
    assert.equal(state.probe?.ok, true, `status must surface the probe result: ${status.stdout}`)

    const duplicate = runBackend(['start'], env)
    assert.notEqual(duplicate.code, 0, 'a second start must be refused, not silently spawn a second backend')
    assert.ok(
      /already running/.test(`${duplicate.stdout}\n${duplicate.stderr}`),
      `duplicate start must say the backend is already running; output was:\n${duplicate.stdout}\n${duplicate.stderr}`,
    )

    const stopped = runBackend(['stop'], env)
    assert.equal(stopped.code, 0, describeRun('stop', stopped))
    const stoppedSummary = parseSummary(stopped.stdout, 'stop')
    assert.equal(stoppedSummary.exited, true, `stop must observe the pid exit: ${stopped.stdout}`)
    assert.deepEqual(stoppedSummary.leakedProcesses, [], `stop reported leaked processes: ${JSON.stringify(stoppedSummary.leakedProcesses)}`)
    assert.deepEqual(stoppedSummary.portsAfter, [], `ports still bound after stop: ${JSON.stringify(stoppedSummary.portsAfter)}`)

    const afterStop = runBackend(['status'], env)
    assert.equal(afterStop.code, 0, describeRun('status after stop', afterStop))
    assert.match(afterStop.stdout, /"running": false/, `status after stop must report not running:\n${afterStop.stdout}`)

    const stopAgain = runBackend(['stop'], env)
    assert.equal(stopAgain.code, 0, `stopping an already-stopped backend must be a no-op success:\n${stopAgain.stdout}\n${stopAgain.stderr}`)
  }
})

test('doctor passes on a clean isolated home and names its checks', () => {
  const run = runBackend(['doctor', '--json'], env)
  const report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')))
  assert.equal(run.code, 0, describeRun('doctor', run))
  assert.equal(report.ok, true, `doctor failures: ${JSON.stringify(report.checks.filter(check => !check.ok))}`)
  const names = report.checks.map(check => check.name)
  for (const required of ['node version', 'combo combination', 'dsh CLI build', 'product packages', 'isolated home']) {
    assert.ok(names.includes(required), `doctor must check ${required}; checks were ${JSON.stringify(names)}`)
  }
})

test('a missing dsh checkout fails loudly instead of booting something else', () => {
  const run = runBackend(['probe'], { ...env, OURFAIRY_DSH_DIR: join(home, 'no-such-dsh') })
  assert.notEqual(run.code, 0, 'probe with a missing dsh checkout must fail')
  const output = `${run.stdout}\n${run.stderr}`
  assert.ok(
    output.includes('no-such-dsh') && output.includes('OURFAIRY_DSH_DIR'),
    `diagnostic must name the bad path and the override variable; output was:\n${output}`,
  )
})
