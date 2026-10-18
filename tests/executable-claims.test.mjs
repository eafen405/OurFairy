/**
 * A drifted bundle model row must make `doctor` fail (review F1).
 *
 * `combo.json backend.agentModel` and the bundle's `agent-default-model` row are
 * two declarations of one selection, and both documents say `doctor` keeps them
 * together. That claim is worth only the check that runs it: the comparison
 * used to test with `String.includes`, so a row declaring
 * `model: deepseek-flash-drifted` still satisfied `model: deepseek-flash` and
 * the check stayed green while the pair had drifted.
 *
 * The assertion drives the real launcher against a copy of the product sources
 * and changes the bundle's model there, so a regression to the substring
 * comparison fails here rather than only in review.
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { copyProductRepo, describeRun, makeHome, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const home = makeHome('ourfairy-model-drift-')
after(() => removeHome(home))

/** The pair `combo.json` locks: the input this comparison is against. */
function lockedAgentModel() {
  const pair = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8')).backend?.agentModel
  assert.ok(
    typeof pair?.provider === 'string' && typeof pair?.model === 'string',
    `combo.json must declare backend.agentModel.provider and .model; got ${JSON.stringify(pair)}`,
  )
  return pair
}

/** The `bundle agent model` check from one `doctor --json` run. */
function bundleAgentModelCheck({ root = repoRoot, isolatedHome = home } = {}) {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: isolatedHome,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  }, { root })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  const checks = new Map(JSON.parse(run.stdout.slice(start)).checks.map(check => [check.name, check]))
  const check = checks.get('bundle agent model')
  assert.ok(check !== undefined, `doctor must run a "bundle agent model" check; it ran ${JSON.stringify([...checks.keys()])}`)
  return check
}

test('a bundle row declaring a drifted model fails the doctor check', () => {
  const pair = lockedAgentModel()
  assert.equal(bundleAgentModelCheck().ok, true, 'the check must pass while the two declarations agree')

  const root = copyProductRepo('ourfairy-model-drift-')
  const driftHome = makeHome('ourfairy-model-drift-home-')
  try {
    const bundlePath = join(root, 'backend', 'v1-bundle', 'cordis.patch.yml')
    const source = readFileSync(bundlePath, 'utf8')
    // The exact drift the substring comparison accepted: the row still contains
    // `model: deepseek-flash` as a prefix of the changed value.
    const drifted = source.replace(`model: ${pair.model}`, `model: ${pair.model}-drifted`)
    assert.notEqual(drifted, source, `the bundle must declare model: ${pair.model} so this test can drift it`)
    writeFileSync(bundlePath, drifted)

    const check = bundleAgentModelCheck({ root, isolatedHome: driftHome })
    assert.equal(
      check.ok,
      false,
      `a row declaring model: ${pair.model}-drifted must fail the check that promises the two`
      + ` declarations cannot drift; doctor reported ${JSON.stringify(check)}`,
    )
    assert.ok(
      check.detail.includes(`${pair.model}-drifted`) && check.detail.includes(pair.model),
      `the failure must name the drifted declaration and the locked pair; it reported ${JSON.stringify(check.detail)}`,
    )
  } finally {
    removeHome(driftHome)
    rmSync(root, { recursive: true, force: true })
  }
})
