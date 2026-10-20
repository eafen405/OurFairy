/**
 * Product rows declare their config, and an invalid one fails the boot (#102).
 *
 * identity, spaces and attachments export a schemastery `Config`, so the loader
 * validates the row config before `apply` runs. A wrong type or a missing
 * required field leaves the row's fiber failed; the probe must report every
 * bundle product row that is not active, naming the row and package, and exit
 * non-zero. Nothing serves a request in these runs: the failure happens while
 * the composition loads, not on the first request.
 *
 * The field path comes from the rejected config (`$.root`, `$.path`), which the
 * loader logs with the row id; the probe's own failure names the row and
 * package. A row disabled through an operator overlay is deliberate and is not
 * an activation failure, so these cases only override `config`.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  describeRun, makeHome, readReport, removeHome, runBackendAsync, writeOverlay,
} from './helpers/backend.mjs'

const password = 'config-contracts-password'
const homes = []

after(() => {
  for (const home of homes) removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-config-contracts-')
  homes.push(home)
  return home
}

/** The product rows this ticket gives a config contract, and the service each mounts. */
const PRODUCT_ROWS = {
  identity: { name: '@ourfairy/dsh-identity', service: 'identity' },
  spaces: { name: '@ourfairy/dsh-spaces', service: 'ourfairySpaces' },
  attachments: { name: '@ourfairy/dsh-attachments', service: 'ourfairyAttachments' },
}

/** Run one probe with the given overlays and read the report it wrote. */
async function probe(home, { overlays = [], report = 'report.json' } = {}) {
  const reportPath = join(home, report)
  const args = ['probe', '--report', reportPath]
  for (const overlay of overlays) args.push('--patch', overlay)
  const run = await runBackendAsync(args, { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password }, { timeoutMs: 300_000 })
  assert.ok(existsSync(reportPath), `probe wrote no report: ${describeRun('probe', run)}`)
  return { run, report: readReport(reportPath) }
}

test('the shipped composition activates the configured product rows and their services', async () => {
  const home = freshHome()
  const { run, report } = await probe(home)
  assert.equal(run.code, 0, `the shipped composition must probe cleanly: ${describeRun('probe', run)}`)
  assert.equal(report.ok, true, `probe failures: ${JSON.stringify(report.failures)}`)

  const rows = new Map(report.rows.map(row => [row.id, row]))
  for (const [id, expected] of Object.entries(PRODUCT_ROWS)) {
    assert.equal(rows.get(id)?.name, expected.name, `row "${id}" must mount ${expected.name}`)
    assert.equal(rows.get(id)?.fiberState, 'active', `row "${id}" must be active with a valid config`)
    assert.equal(report.services[expected.service]?.live, true, `service "${expected.service}" must be live`)
    assert.equal(report.services[expected.service]?.expectedRow, id,
      `service "${expected.service}" must be owned by row "${id}"`)
    assert.equal(report.services[expected.service]?.fiberState, 'active',
      `row "${id}" must keep its service's fiber active`)
  }
})

/**
 * One invalid row config per product row, with the schema path the rejection
 * must name. Each overlay replaces the row's config, as an operator patch does.
 */
const INVALID_CONFIGS = [
  { row: 'spaces', config: { root: 42 }, field: '$.root', why: 'root is a number instead of a string' },
  { row: 'identity', config: { sessionTtlDays: 30 }, field: '$.path', why: 'path is missing' },
  { row: 'attachments', config: {}, field: '$.root', why: 'root is missing' },
]

for (const scenario of INVALID_CONFIGS) {
  test(`an invalid ${scenario.row} config fails at load and names the row and ${scenario.field}`, async () => {
    const home = freshHome()
    const overlay = writeOverlay(home, [{ id: scenario.row, config: scenario.config }], `${scenario.row}.patch.yml`)
    const { run, report } = await probe(home, { overlays: [overlay], report: `${scenario.row}.json` })

    // The boot exits non-zero before readiness: no request is ever served.
    assert.notEqual(run.code, 0, `probe must fail while loading (${scenario.why}): ${describeRun('probe', run)}`)
    assert.equal(report.ok, false, `probe must report the failed row (${scenario.why})`)
    assert.equal(report.rows.find(row => row.id === scenario.row)?.fiberState, 'failed',
      `row "${scenario.row}" must be failed, not active`)

    const failures = report.failures.join('\n')
    assert.ok(failures.includes(`bundle product row "${scenario.row}"`),
      `the probe must name row "${scenario.row}"; got:\n${failures}`)
    assert.ok(failures.includes(PRODUCT_ROWS[scenario.row].name),
      `the probe must name the package ${PRODUCT_ROWS[scenario.row].name}; got:\n${failures}`)
    assert.equal(report.services[PRODUCT_ROWS[scenario.row].service]?.live, false,
      `service "${PRODUCT_ROWS[scenario.row].service}" must not be live under an invalid config`)
    // The configuration rejection names the field path in the row's boot log.
    assert.ok(run.stderr.includes(scenario.field),
      `the failure must name field "${scenario.field}" (${scenario.why}); stderr:\n${run.stderr}`)
  })
}
