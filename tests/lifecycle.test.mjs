/**
 * Lifecycle evidence for ticket #24: start, status, duplicate start, stop.
 *
 * The supervised process is the real pinned-dsh boot with the product bundle
 * plus the test-only probe; `start` returns only after the probe reports ready.
 * The assertions cover the ticket's requirement that repeated start/destroy
 * leaks neither ports nor child processes.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { describeRun, makeHome, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const home = makeHome('ourfairy-lifecycle-')
// The v1 composition mounts the product's web carrier, so it binds a port by
// design. Ask for an ephemeral one: the default 3080 is the port `dsh web`
// itself serves the harness UI on, so the default collides on a developer
// machine. What the ticket requires is that the port is *released* across
// cycles, not that none is ever bound.
const env = {
  OURFAIRY_HOME: home,
  OURFAIRY_PORT: '0',
  MINIMAX_CN_API_KEY: undefined,
  OURFAIRY_MINIMAX_BASE_URL: undefined,
}
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
    assert.equal(
      summary.listeningPorts.length,
      1,
      `the v1 composition binds exactly one port (the product's web carrier); `
        + `pid ${summary.pid} listened on ${JSON.stringify(summary.listeningPorts)}`,
    )

    const status = runBackend(['status'], env)
    assert.equal(status.code, 0, describeRun('status', status))
    const state = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')))
    assert.equal(state.running, true, `status must report the started pid as running: ${status.stdout}`)
    assert.equal(state.pid, summary.pid, 'status must report the same pid start returned')
    assert.equal(state.probe?.ok, true, `status must surface the probe result: ${status.stdout}`)

    const duplicate = runBackend(['start'], env)
    assert.notEqual(duplicate.code, 0, 'a second start must be refused, not silently spawn a second backend')
    // The dynamic pid and timestamp are read from the state the first start
    // wrote, so the whole rendered line is pinned rather than a fragment.
    const recorded = JSON.parse(readFileSync(join(home, 'run', 'backend.json'), 'utf8'))
    assert.equal(
      duplicate.stderr,
      `ourfairy-backend: backend already running with pid ${recorded.pid} (started ${recorded.startedAt}); run 'stop' first\n`,
      `duplicate start must print the exact already-running line:\n${duplicate.stdout}\n${duplicate.stderr}`,
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

test('doctor reports its checks on a clean isolated home', () => {
  const run = runBackend(['doctor', '--json'], env)
  const report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')))
  const checks = new Map(report.checks.map(check => [check.name, check]))
  for (const required of ['node version', 'combo combination', 'dsh CLI build', 'product packages', 'isolated home']) {
    assert.ok(checks.has(required), `doctor must check ${required}; it ran ${JSON.stringify([...checks.keys()])}`)
  }

  // The combination's third row is the client's provenance, and doctor reports it
  // with the commit the in-repo declaration holds. Asserting the value keeps
  // doctor's answer tied to what `combo.mjs verify` reads, not to combo.json alone.
  const sourceCommit = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8')).androidSource.commit
  assert.match(
    checks.get('combo combination').detail,
    new RegExp(`android source@${sourceCommit.slice(0, 12)}`, 'u'),
    `doctor's combination check must name the client source commit it read; it reported`
    + ` ${JSON.stringify(checks.get('combo combination').detail)}`,
  )
  // Companion checkouts are pinned by `npm run combo:verify`, the hook's other
  // step. A worktree sits on moveable integration tips, so doctor's answer about
  // the other repositories is a fact to report, not a regression of this code.
  const local = ['node version', 'corepack pnpm pin available', 'product packages', 'isolated home',
    'profile project linked', 'model double']
  const failed = local.filter(name => checks.get(name)?.ok !== true)
  assert.deepEqual(failed, [], `worktree-local doctor checks failed: ${JSON.stringify(failed.map(name => checks.get(name)))}`)
  assert.equal(run.code, report.ok ? 0 : 1, `doctor must exit 0 only when every check passed:\n${describeRun('doctor', run)}`)
})

test('a missing dsh checkout fails loudly instead of booting something else', () => {
  const run = runBackend(['probe'], { ...env, OURFAIRY_DSH_DIR: join(home, 'no-such-dsh') })
  assert.notEqual(run.code, 0, 'probe with a missing dsh checkout must fail')
  const remoteUrl = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8')).repos.dsh.remoteUrl
  assert.equal(
    run.stderr,
    `ourfairy-backend: dsh checkout missing at ${join(home, 'no-such-dsh')}; set OURFAIRY_DSH_DIR or clone ${remoteUrl}\n`,
    `probe must print the exact missing-checkout line naming the path and override:\n${run.stdout}\n${run.stderr}`,
  )
})

test('doctor --json records an unsafe isolated home as its first failed check', () => {
  const hostHome = process.env.HOME
  assert.ok(
    typeof hostHome === 'string' && hostHome !== '',
    'the test needs HOME to name the host home the launcher must refuse',
  )
  const run = runBackend(['doctor', '--json'], { ...env, OURFAIRY_HOME: hostHome })
  let report
  assert.doesNotThrow(() => {
    report = JSON.parse(run.stdout)
  }, `doctor --json must still print one JSON report when the isolated home is refused:\n${describeRun('doctor --json', run)}`)
  assert.equal(run.code, 1, `doctor must exit 1 when the isolated home is refused:\n${describeRun('doctor --json', run)}`)
  assert.equal(report.ok, false, `the report must mark the run failed:\n${JSON.stringify(report)}`)
  // The refusal must be the only check: every later check can write (corepack
  // cache, profile install), so doctor has to stop here.
  assert.equal(
    report.checks.length,
    1,
    `doctor must stop before checks that could write; it ran ${JSON.stringify(report.checks.map(entry => entry.name))}`,
  )
  const check = report.checks[0]
  assert.equal(check.name, 'isolated home', `the first recorded check must be the isolation check: ${JSON.stringify(check)}`)
  assert.equal(check.ok, false, `an unsafe isolated home must fail its check: ${JSON.stringify(check)}`)
  assert.equal(
    check.detail,
    `refusing OURFAIRY_HOME=${hostHome}: it is the host home (${hostHome}) or an ancestor of it.`
      + ` Backend state must stay isolated; unset OURFAIRY_HOME to use ${join(repoRoot, '.ourfairy')}.`,
    `the check must carry the exact refusal message: ${JSON.stringify(check.detail)}`,
  )
})

test('doctor --json records a profile install failure instead of dying', () => {
  const installHome = makeHome('ourfairy-lifecycle-install-failure-')
  try {
    // pnpm cannot use a regular file as its store directory, so the install
    // fails inside the "profile project linked" check.
    writeFileSync(join(installHome, 'pnpm-store'), 'not a directory\n')
    const run = runBackend(['doctor', '--json'], { ...env, OURFAIRY_HOME: installHome })
    let report
    assert.doesNotThrow(() => {
      report = JSON.parse(run.stdout)
    }, `doctor --json must still print one JSON report when the profile install fails:\n${describeRun('doctor --json', run)}`)
    assert.notEqual(run.code, 0, `doctor must exit non-zero when a check fails:\n${describeRun('doctor --json', run)}`)
    assert.equal(report.ok, false, `the report must mark the run failed:\n${JSON.stringify(report)}`)
    const check = report.checks.find(entry => entry.name === 'profile project linked')
    assert.ok(
      check !== undefined,
      `the report must carry the profile check; it ran ${JSON.stringify(report.checks.map(entry => entry.name))}`,
    )
    assert.equal(check.ok, false, `a failed install must fail the profile check: ${JSON.stringify(check)}`)
    const profileDir = join(installHome, 'dsh-home', 'profiles', 'ourfairy')
    assert.ok(
      check.detail.startsWith(`profile install failed in ${profileDir} (exit `),
      `the failed check must carry the install message naming ${profileDir}: ${JSON.stringify(check.detail)}`,
    )
  } finally {
    removeHome(installHome)
  }
})

test('doctor --json records a missing dsh checkout as a failed check instead of dying', () => {
  const missing = join(home, 'no-such-dsh-doctor')
  const run = runBackend(['doctor', '--json'], { ...env, OURFAIRY_DSH_DIR: missing })
  assert.notEqual(
    run.code,
    0,
    `doctor must exit non-zero when a check fails:\n${describeRun('doctor --json', run)}`,
  )
  let report
  assert.doesNotThrow(() => {
    report = JSON.parse(run.stdout)
  }, `doctor --json must still print one JSON report when a check fails:\n${describeRun('doctor --json', run)}`)
  assert.equal(report.ok, false, `the report must mark the run failed:\n${JSON.stringify(report)}`)
  const check = report.checks.find(entry => entry.name === 'dsh CLI build')
  assert.ok(check !== undefined, `the report must carry the dsh CLI build check; it ran ${JSON.stringify(report.checks.map(entry => entry.name))}`)
  assert.equal(check.ok, false, `a missing dsh checkout must fail the dsh CLI build check: ${JSON.stringify(check)}`)
  assert.ok(
    check.detail.includes(missing),
    `the failed check must name the missing path ${missing}; its detail was ${JSON.stringify(check.detail)}`,
  )
})
