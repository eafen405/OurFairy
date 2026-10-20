/**
 * Ticket #86: the adopted native capabilities stay present, and doctor says so.
 *
 * The upgrade record (`docs/decisions/native-capability-dependencies.md`) names
 * the four dsh capabilities the product relies on. A record is only worth the
 * check that fails when one disappears, so the same four rows and the public
 * history export are asserted here through dsh's own profile loader — not a
 * YAML reader kept beside it.
 *
 * The row expectations live in one place (`scripts/combo.mjs`), and the
 * `doctor` check runs the same function against the *installed* profile. The
 * tests below mutate the composed bundle to prove each failure names what is
 * missing instead of failing generically.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { nativeCapabilityFailures } from '../scripts/combo.mjs'
import { describeRun, makeHome, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const installAnchor = join(dshDir, 'apps', 'cli', 'package.json')
const dshRequire = createRequire(installAnchor)
const boot = dshRequire('@deepseek-ai/dsh-app-boot')
const bundlePatch = join(repoRoot, combo.backend.bundlePathInRepo, 'cordis.patch.yml')
const historyExport = '@deepseek-ai/dsh-agent/session-history'

/** The rows the bundle mounts, read through dsh's own patch loader. */
function composedRows() {
  return boot.composeEntries([boot.loadOverlayPatches('dsh', bundlePatch)])
}

/** Resolve the public export from the same installation the launcher boots. */
function resolveFromDsh(specifier) {
  return dshRequire.resolve(specifier)
}

test('the shipped composition satisfies every required native capability', () => {
  assert.deepEqual(nativeCapabilityFailures(composedRows(), resolveFromDsh), [])
})

test('a missing required row fails by row id, package, and remedy', () => {
  const rows = composedRows().filter(row => row.id !== 'llm-retry')
  const failures = nativeCapabilityFailures(rows, resolveFromDsh)
  assert.equal(failures.length, 1, `exactly the removed row is reported; got ${JSON.stringify(failures)}`)
  assert.match(failures[0], /llm-retry/u)
  assert.match(failures[0], /@deepseek-ai\/dsh-llm-retry/u)
  assert.match(failures[0], /cordis\.patch\.yml/u)
  assert.match(failures[0], /--reinstall/u)
})

test('a required row mounting a different package names both packages', () => {
  const rows = composedRows().map(row => row.id === 'spill-policy'
    ? { ...row, name: '@deepseek-ai/dsh-spill-policy-other' }
    : row)
  const failures = nativeCapabilityFailures(rows, resolveFromDsh)
  assert.equal(failures.length, 1, `exactly the drifted row is reported; got ${JSON.stringify(failures)}`)
  assert.match(failures[0], /spill-policy/u)
  assert.match(failures[0], /dsh-spill-policy-other/u)
  assert.match(failures[0], /@deepseek-ai\/dsh-spill-policy\b/u)
})

test('a disabled required row is not treated as mounted', () => {
  const rows = composedRows().map(row => row.id === 'subprocess' ? { ...row, disabled: true } : row)
  const failures = nativeCapabilityFailures(rows, resolveFromDsh)
  assert.equal(failures.length, 1, `exactly the disabled row is reported; got ${JSON.stringify(failures)}`)
  assert.match(failures[0], /subprocess/u)
  assert.match(failures[0], /disabled/u)
  assert.match(failures[0], /@deepseek-ai\/dsh-subprocess-local/u)
})

test('a missing public export is named with its remedy', () => {
  const failures = nativeCapabilityFailures(composedRows(), () => {
    throw new Error(`Cannot find module '${historyExport}'`)
  })
  assert.equal(failures.length, 1, `the export failure is reported alone; got ${JSON.stringify(failures)}`)
  assert.match(failures[0], /@deepseek-ai\/dsh-agent\/session-history/u)
  assert.match(failures[0], /combo\.json/u)
  assert.match(failures[0], /build:lib:host/u)
})

test('doctor passes on the shipped composition and fails when a required row is removed', () => {
  const home = makeHome('ourfairy-native-capabilities-')
  const env = { OURFAIRY_HOME: home, MINIMAX_CN_API_KEY: undefined, OURFAIRY_MINIMAX_BASE_URL: undefined }
  const doctorCheck = run => {
    const start = run.stdout.indexOf('{')
    assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
    const checks = new Map(JSON.parse(run.stdout.slice(start)).checks.map(check => [check.name, check]))
    const check = checks.get('native capabilities')
    assert.ok(check !== undefined, `doctor must run a "native capabilities" check; it ran ${JSON.stringify([...checks.keys()])}`)
    return check
  }
  try {
    assert.equal(doctorCheck(runBackend(['doctor', '--json'], env)).ok, true,
      'the check must pass on the installed shipped profile')

    // Mutate the *installed* bundle copy, not the worktree: doctor reads the
    // profile a boot would use, and the source hash still matches so the next
    // run reuses this installation.
    const installedPatch = join(home, 'dsh-home', 'profiles', combo.backend.profileName,
      'node_modules', ...combo.backend.bundlePackage.split('/'), 'cordis.patch.yml')
    const source = readFileSync(installedPatch, 'utf8')
    const removed = source.replace(`    - id: llm-retry\n      name: '@deepseek-ai/dsh-llm-retry'\n`, '')
    assert.notEqual(removed, source, 'the installed bundle must declare the llm-retry row for this test to remove it')
    writeFileSync(installedPatch, removed)

    const failed = doctorCheck(runBackend(['doctor', '--json'], env))
    assert.equal(failed.ok, false, `a profile without llm-retry must fail the check; doctor reported ${JSON.stringify(failed)}`)
    assert.match(failed.detail, /llm-retry/u)
    assert.match(failed.detail, /@deepseek-ai\/dsh-llm-retry/u)
    assert.match(failed.detail, /--reinstall/u)
  } finally {
    removeHome(home)
  }
})
