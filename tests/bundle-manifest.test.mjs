/**
 * The bundle's `agent-default-model` row is the only initial model declaration.
 *
 * Ticket #103 removed the second declaration from `combo.json` and the doctor
 * check that compared the two, so the remaining claim is that the composed row
 * is what a caller reads: the probe's boot report must carry the selection
 * `agentDefaultModel.currentSelection()` returns. Copying the product sources
 * and changing only that row proves the probe follows the bundle rather than a
 * stale copy in `combo.json` or an environment variable.
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { copyProductRepo, describeRun, makeHome, readReport, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const homes = []
after(() => {
  for (const home of homes) removeHome(home)
})

function freshHome(prefix) {
  const home = makeHome(prefix)
  homes.push(home)
  return home
}

/** The checks one `doctor --json` run reports, keyed by name. */
function doctorChecks(root, home) {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  }, { root })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  return new Map(JSON.parse(run.stdout.slice(start)).checks.map(check => [check.name, check]))
}

/** The declared model value inside one bundle's `agent-default-model` row. */
function bundleAgentModel(root) {
  const lines = readFileSync(join(root, 'backend', 'v1-bundle', 'cordis.patch.yml'), 'utf8').split('\n')
  const start = lines.findIndex(line => /^\s*- id: agent-default-model\s*$/.test(line))
  assert.ok(start >= 0, 'the bundle must mount an agent-default-model row')
  for (const line of lines.slice(start + 1)) {
    if (/^\s*- id: /.test(line)) break
    const field = /^\s*model: (.+?)\s*$/.exec(line)
    if (field !== null) return field[1]
  }
  assert.fail('the agent-default-model row must declare a model')
}

test('combo.json declares no second model selection and doctor runs no comparison', () => {
  const { backend } = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
  assert.equal(
    Object.hasOwn(backend, 'agentModel'),
    false,
    `combo.json must not repeat the bundle's model selection; got ${JSON.stringify(backend.agentModel)}`,
  )
  assert.equal(
    Object.hasOwn(backend, 'agentModelNote'),
    false,
    'combo.json must not carry a note describing a second declaration',
  )

  const checks = doctorChecks(repoRoot, freshHome('ourfairy-bundle-manifest-doctor-'))
  assert.equal(
    checks.has('bundle agent model'),
    false,
    `doctor must not compare two model declarations; it ran ${JSON.stringify([...checks.keys()])}`,
  )
})

test('a drifted bundle model row reaches the probe boot report', () => {
  const root = copyProductRepo('ourfairy-model-drift-')
  const home = freshHome('ourfairy-model-drift-home-')
  try {
    const bundlePath = join(root, 'backend', 'v1-bundle', 'cordis.patch.yml')
    const declared = bundleAgentModel(root)
    const source = readFileSync(bundlePath, 'utf8')
    const driftedModel = `${declared}-drifted`
    const drifted = source.replace(`model: ${declared}`, `model: ${driftedModel}`)
    assert.notEqual(drifted, source, `the bundle must declare model: ${declared} so this test can drift it`)
    writeFileSync(bundlePath, drifted)

    const reportPath = join(home, 'boot-report.json')
    const run = runBackend(['probe', '--report', reportPath], {
      OURFAIRY_HOME: home,
      MINIMAX_CN_API_KEY: undefined,
      OURFAIRY_MINIMAX_BASE_URL: undefined,
    }, { root })
    assert.equal(run.code, 0, describeRun('probe (drifted bundle row)', run))
    const report = readReport(reportPath)
    assert.deepEqual(report.failures, [], `probe reported failures:\n${(report.failures ?? []).join('\n')}`)
    assert.deepEqual(
      report.model,
      {
        provider: 'minimax-cn',
        model: driftedModel,
        reasoningEffort: 'max',
        selection: 'agentDefaultModel.currentSelection()',
      },
      `the boot report must read the composed row, not a second declaration; got ${JSON.stringify(report.model)}`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
