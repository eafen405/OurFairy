/**
 * Claims about this product's own checks must be executable (ticket #64).
 *
 * The v1 bundle README is where a reader learns what backs what: which list
 * owns the absent-row expectation (ticket #47), and which command keeps the two
 * model declarations together (ticket #46). A claim there is worth only the
 * check that runs it — #46 was a dead function while the README and
 * `combo.json backend.agentModelNote` both promised `doctor` ran the comparison,
 * and nothing failed because nothing executed the promise.
 *
 * These assertions pin the two claims of that kind to what executes them, and
 * assert the model pair from the two live declarations themselves, so a drifted
 * row fails `npm test` whatever `doctor`'s own comparison happens to accept.
 * `CODING_STANDARDS.md` states the rule this file applies: a claim that "A and B
 * cannot disagree" must come with a check that fails when they do, or the claim
 * is deleted.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { describeRun, makeHome, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const home = makeHome('ourfairy-executable-claims-')
after(() => removeHome(home))

/** The pair `combo.json` locks, read from the record itself. */
function lockedAgentModel() {
  const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
  const pair = combo.backend?.agentModel
  assert.ok(
    typeof pair?.provider === 'string' && typeof pair?.model === 'string',
    `combo.json must declare backend.agentModel.provider and .model; got ${JSON.stringify(pair)}`,
  )
  return pair
}

/**
 * The pair the bundle's `agent-default-model` row declares, read from the patch
 * file rather than from whatever reports about it.
 * @returns {{provider?: string, model?: string}}
 */
function declaredAgentModel() {
  const lines = readFileSync(join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml'), 'utf8').split('\n')
  const start = lines.findIndex(line => /^\s*- id: agent-default-model\s*$/.test(line))
  assert.ok(start >= 0, 'backend/v1-bundle/cordis.patch.yml must keep an agent-default-model row')
  const row = {}
  for (const line of lines.slice(start + 1)) {
    if (/^\s*- id: /.test(line)) break
    const field = /^\s*(provider|model): (.+?)\s*$/.exec(line)
    if (field !== null) row[field[1]] = field[2]
  }
  return row
}

/**
 * Run `doctor --json` and report its checks by name.
 *
 * The exit code deliberately is not asserted: an unrelated check (another
 * checkout in the version combination drifting) must not decide what these
 * claim assertions observe.
 */
function doctorChecks() {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    DEEPSEEK_API_KEY: undefined,
    DEEPSEEK_BASE_URL: undefined,
  })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  return new Map(JSON.parse(run.stdout.slice(start)).checks.map(check => [check.name, check]))
}

test('the bundle row declares the pair combo.json locks', () => {
  const pair = lockedAgentModel()
  const declared = declaredAgentModel()

  // backend/v1-bundle/README.md: the bundle's agent-default-model row and
  // combo.json backend.agentModel are two declarations of one selection, and
  // "the two declarations cannot drift apart" is the claim this exercises.
  assert.equal(
    declared.provider,
    pair.provider,
    `the agent-default-model row declares provider ${declared.provider}, combo.json locks ${pair.provider}`,
  )
  assert.equal(
    declared.model,
    pair.model,
    `the agent-default-model row declares model ${declared.model}, combo.json locks ${pair.model}`,
  )
})

test('doctor runs the "bundle agent model" check the README and combo.json promise', () => {
  const pair = lockedAgentModel()
  const checks = doctorChecks()
  const check = checks.get('bundle agent model')

  // `combo.json backend.agentModelNote` and `backend/v1-bundle/README.md` both
  // say `doctor` compares the bundle against this pair. If that check is gone,
  // the two declarations can drift apart while both documents keep promising
  // they cannot — #46, again.
  assert.ok(
    check !== undefined,
    'doctor must run a "bundle agent model" check: combo.json backend.agentModelNote and'
    + ' backend/v1-bundle/README.md both say the bundle is compared against the recorded pair;'
    + ` doctor ran ${JSON.stringify([...checks.keys()])}. If the check is deliberately gone,`
    + ' delete those claims (or this test) in the same change',
  )
  assert.equal(
    check.ok,
    true,
    `the "bundle agent model" check must pass while the two declarations agree: ${JSON.stringify(check)}`,
  )
  assert.ok(
    check.detail.includes(pair.provider) && check.detail.includes(pair.model),
    `the check must compare against the pair combo.json locks (${pair.provider}/${pair.model});`
    + ` it reported ${JSON.stringify(check.detail)}`,
  )
})

test('the bundle declares the patch file its README calls the row set', () => {
  // backend/v1-bundle/README.md: "`cordis.patch.yml` **is** the row set: it is
  // the file the profile loads". The loader follows the package's
  // `dsh.bundle.patch` declaration, so that declaration is what makes the
  // sentence true — and what `tests/bundle-readme.test.mjs` compares the
  // document against.
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'backend', 'v1-bundle', 'package.json'), 'utf8'))
  const declared = manifest.dsh?.bundle?.patch
  const patches = typeof declared === 'string' ? [declared] : declared
  assert.deepEqual(
    patches,
    ['./cordis.patch.yml'],
    'backend/v1-bundle/package.json must declare dsh.bundle.patch ./cordis.patch.yml:'
    + ' the README calls that file the row set because the profile loads it, so pointing the'
    + ' bundle elsewhere would leave both the claim and the row-table check reading the wrong file',
  )
})
