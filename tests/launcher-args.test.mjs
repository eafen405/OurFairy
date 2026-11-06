/**
 * The test helper's drift decision has one authority (ticket #318).
 *
 * The launcher enforces the combination's pinned dsh commit: running against any
 * other checkout is refused unless `--allow-drift` is passed. A suite that sets
 * an explicit `OURFAIRY_DSH_DIR` is doing exactly that deliberately, and the
 * helper says so — but it used to say so only for `start`, through `startArgs`,
 * while `doctor` and `probe` were called straight through `runBackend`. A
 * checkout that moved for an unrelated reason then failed those calls with a
 * drift refusal that had nothing to do with what the suite asserted.
 *
 * Two things are pinned here:
 *
 * - the decision itself, as a pure function of the child's environment, so it
 *   cannot silently become "always allow" (a genuinely drifted checkout with no
 *   override must still be refused) or "never allow"; and
 * - the decision as the launcher actually receives it: `doctor` called directly
 *   is refused on a drifted checkout, while the same call through the helper
 *   reaches the check it exists to run.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readCombo, repoPath } from '../scripts/combo.ts'
import {
  deliberateDshExperiment, dshDir, launcherArgs, makeHome, removeHome, repoRoot, runBackend, startArgs,
} from './helpers/backend.mjs'

const { combo } = readCombo(repoRoot)

/** The commit `combo.json` pins for the harness checkout. */
const lockedCommit = repoPath(combo, 'dsh', repoRoot) === dshDir ? combo.repos.dsh.productCommit : undefined

const homes = []

after(() => {
  for (const home of homes) removeHome(home)
})

/** A fresh isolated home, cleaned up after this file. */
function freshHome() {
  const home = makeHome('ourfairy-launcher-args-')
  homes.push(home)
  return home
}

/** The commit the selected checkout is at, or `undefined` when git cannot say. */
function headOf(dir) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : undefined
}

/** Run one launcher command directly, with no helper involvement at all. */
function launchDirect(args, home) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ourfairy-backend.ts'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, OURFAIRY_HOME: home, OURFAIRY_SKIP_BUILD: '1', OURFAIRY_PORT: '0' },
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
}

test('the drift decision is an explicit, non-empty OURFAIRY_DSH_DIR and nothing else', () => {
  assert.equal(deliberateDshExperiment({ OURFAIRY_DSH_DIR: '/somewhere/else' }), true)
  assert.equal(deliberateDshExperiment({}), false, 'an unset override keeps the pinned combination enforced')
  assert.equal(deliberateDshExperiment({ OURFAIRY_DSH_DIR: '' }), false, 'an empty value is not an override')

  // The flag is appended, never replaces the command, and is not duplicated.
  assert.deepEqual(launcherArgs(['doctor', '--json'], { OURFAIRY_DSH_DIR: '/somewhere/else' }),
    ['doctor', '--json', '--allow-drift'])
  assert.deepEqual(launcherArgs(['doctor', '--json'], {}), ['doctor', '--json'])
})

test('every launcher command receives the same drift decision, start included', () => {
  const previous = process.env.OURFAIRY_DSH_DIR
  try {
    process.env.OURFAIRY_DSH_DIR = '/somewhere/else'
    for (const command of ['start', 'probe', 'doctor', 'stop']) {
      assert.equal(launcherArgs([command]).includes('--allow-drift'), true,
        `${command} must receive the drift decision the helper makes`)
    }
    assert.equal(startArgs().includes('--allow-drift'), true, 'start keeps the flag it has always had')
    assert.deepEqual(startArgs(['overlay.yml']).slice(-2), ['--patch', 'overlay.yml'],
      'overlays still follow the command')

    delete process.env.OURFAIRY_DSH_DIR
    for (const command of ['start', 'probe', 'doctor', 'stop']) {
      assert.equal(launcherArgs([command]).includes('--allow-drift'), false,
        `${command} must not be granted the flag without an explicit override`)
    }
    assert.equal(startArgs().includes('--allow-drift'), false, 'start must also withhold it without an override')
  } finally {
    if (previous === undefined) delete process.env.OURFAIRY_DSH_DIR
    else process.env.OURFAIRY_DSH_DIR = previous
  }
})

test('a drifted checkout is refused by the launcher itself and accepted through the helper', () => {
  const head = headOf(dshDir)
  assert.ok(lockedCommit !== undefined,
    `combo.json must pin the harness commit this run uses; ${repoPath(combo, 'dsh', repoRoot)} is not ${dshDir}`)

  if (head === lockedCommit) {
    // The pinned combination: there is no drift for the launcher to refuse, so
    // the gate itself is what the case above pins. The decision still follows
    // its one authority — an explicit override — rather than the checkout's
    // state, so a machine that pins the same commit through an override is not
    // mistaken for an experiment-free run.
    assert.equal(deliberateDshExperiment(), (process.env.OURFAIRY_DSH_DIR ?? '') !== '',
      'the drift decision follows the explicit override, not whether the checkout happens to be pinned')
    return
  }

  // A probe is the cheapest command that reaches the drift gate: it resolves
  // the checkout before anything else, so the refusal arrives in a fraction of
  // a second. Called directly, the launcher enforces the lock and names both
  // commits; the run itself must not be blamed.
  const direct = launchDirect(['probe', '--report', join(freshHome(), 'direct.json')], freshHome())
  assert.notEqual(direct.status, 0, `a drifted checkout must be refused: ${direct.stdout}${direct.stderr}`)
  assert.match(`${direct.stdout}${direct.stderr}`,
    new RegExp(`is at ${head} but combo\\.json locks ${lockedCommit}`),
    'the refusal must name both commits so a reader knows which checkout is wrong')

  // Through the helper the same checkout is a deliberate experiment, and the
  // probe runs to its verdict instead of stopping at the gate.
  assert.equal(deliberateDshExperiment(), true, 'this run names an explicit OURFAIRY_DSH_DIR')
  const reportPath = join(freshHome(), 'helper.json')
  const run = runBackend(['probe', '--report', reportPath], {
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  })
  assert.equal(run.code, 0, `the helper must let the probe run: ${run.stdout}\n${run.stderr}`)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  assert.equal(report.ok, true, `the probe must report a healthy boot: ${JSON.stringify(report.failures)}`)
  // The launcher records the checkout it accepted, so the report itself proves
  // the flag travelled rather than the assertion trusting the helper's copy.
  assert.equal(report.launcher?.dshHead, head, 'the probe ran against the checkout this case found drifted')
  assert.equal(report.launcher?.dshDrifted, true, 'the launcher ran it as a tolerated experiment, not as the pinned combination')
})
