/**
 * Ticket #161: the bundle's rows are two loader-native segments.
 *
 * The composition is read through dsh's own loader (`loadOverlayPatches` +
 * `composeEntries`) and the kernel-only boot goes through the real launcher.
 * Nothing here parses the YAML or asserts indentation.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { describeRun, makeHome, readReport, removeHome, repoRoot, runBackend, writeOverlay } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const dshRequire = createRequire(join(dshDir, 'apps', 'cli', 'package.json'))
const boot = dshRequire('@deepseek-ai/dsh-app-boot')
const bundlePatch = join(repoRoot, combo.backend.bundlePathInRepo, 'cordis.patch.yml')

/** The rows the shipped bundle composes, group rows included. */
function composedRows() {
  return boot.composeEntries([boot.loadOverlayPatches('dsh', bundlePatch)])
}

/** One report row by id, refusing a report that did not compose the row. */
function rowById(report, id) {
  const row = report.rows.find(candidate => candidate.id === id)
  assert.ok(row !== undefined,
    `the report must include the "${id}" row; got ${JSON.stringify(report.rows.map(candidate => candidate.id))}`)
  return row
}

test('the composition is two segments and every row belongs to one', () => {
  const rows = composedRows()
  assert.deepEqual(rows.map(row => row.id), ['kernel', 'plugins'])
  for (const group of rows) {
    assert.equal(group.name, 'cordis:group', `${group.id} must be a loader-native group`)
    assert.equal(group.group, true, `${group.id} must declare group: true`)
    assert.ok(Array.isArray(group.config), `${group.id} must nest its rows in a config list`)
  }
  assert.deepEqual(rows.filter(row => row.group !== true), [],
    'a non-group row at the top level would escape the segment decision')

  const flattened = rows.flatMap(row => [row, ...row.config])
  assert.equal(flattened.length, 48, '46 mounted rows plus the two group rows')
  const ids = flattened.map(row => row.id)
  assert.equal(new Set(ids).size, ids.length, `row ids must be unique: ${JSON.stringify(ids)}`)
})

test('disabling the plugins group leaves the kernel booting', () => {
  const home = makeHome('ourfairy-bundle-groups-')
  const reportPath = join(home, 'plugins-disabled.json')
  const overlay = writeOverlay(home, [{ id: 'plugins', disabled: true }], 'disable-plugins.patch.yml')
  const rows = composedRows()
  const kernel = rows.find(row => row.id === 'kernel')
  const plugins = rows.find(row => row.id === 'plugins')
  try {
    const run = runBackend(['probe', '--report', reportPath, '--patch', overlay], {
      OURFAIRY_HOME: home,
      MINIMAX_CN_API_KEY: undefined,
      OURFAIRY_MINIMAX_BASE_URL: undefined,
    })
    assert.equal(run.code, 0, describeRun('probe with the plugins group disabled', run))
    const report = readReport(reportPath)
    assert.equal(report.ok, true, `the kernel-only boot must pass: ${JSON.stringify(report.failures)}`)
    assert.deepEqual(report.failures, [])

    for (const service of ['sessions', 'tools', 'llm', 'agents', 'sessionPersistence', 'sessionQuery', 'sessionProjections']) {
      assert.equal(report.services?.[service]?.live, true, `kernel service "${service}" must stay live`)
    }

    for (const child of plugins.config) {
      assert.equal(rowById(report, child.id).disabled, true,
        `plugin row "${child.id}" must be disabled with its group`)
    }
    for (const child of kernel.config) {
      assert.equal(rowById(report, child.id).disabled, false,
        `kernel row "${child.id}" must stay enabled`)
    }
    assert.equal(rowById(report, 'plugins').disabled, false,
      'the group row itself reports enabled; its children carry the disabled state')
    assert.equal(rowById(report, 'kernel').disabled, false, 'the kernel group row reports enabled')
  } finally {
    removeHome(home)
  }
})
