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
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { nativeCapabilityFailures, flattenEntries } from '../scripts/combo.mjs'
import { describeRun, makeHome, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const installAnchor = join(dshDir, 'apps', 'cli', 'package.json')
const dshRequire = createRequire(installAnchor)
const boot = dshRequire('@deepseek-ai/dsh-app-boot')
// The entry-list dialect and its YAML implementation, taken from the same
// installation the boot reads them from: `!!js` scalars only round-trip
// through the include's own schema.
const bootRequire = createRequire(dshRequire.resolve('@deepseek-ai/dsh-app-boot'))
const { entryListSchema } = bootRequire('@deepseek-ai/cordis-plugin-include')
const yaml = bootRequire('js-yaml')
const bundlePatch = join(repoRoot, combo.backend.bundlePathInRepo, 'cordis.patch.yml')
const historyExport = '@deepseek-ai/dsh-agent/session-history'

/**
 * The capability rows the bundle mounts, read through dsh's own patch loader.
 * `flattenEntries` returns the leaf rows, so a row inside a group is one row
 * here just as it is one mounted row, and a disabled group's state is already
 * on its children.
 */
function composedRows() {
  return flattenEntries(boot.composeEntries([boot.loadOverlayPatches('dsh', bundlePatch)]))
}

/** Resolve the public export from the same installation the launcher boots. */
function resolveFromDsh(specifier) {
  return dshRequire.resolve(specifier)
}

/**
 * Remove the row with `id` from an entry list, wherever it is mounted: a
 * group's `config` nests rows exactly like the top level does. Returns whether
 * the row was found, so a rename makes the caller fail instead of skipping.
 */
function removeRow(entries, id) {
  const index = entries.findIndex(entry => entry.id === id)
  if (index >= 0) {
    entries.splice(index, 1)
    return true
  }
  return entries.some(entry => entry.group && Array.isArray(entry.config) && removeRow(entry.config, id))
}

test('the shipped composition satisfies every required native capability', () => {
  assert.deepEqual(nativeCapabilityFailures(composedRows(), resolveFromDsh), [])
})

test('a required row nested in a group is still found', () => {
  const nested = [{ id: 'kernel', name: 'cordis:group', group: true, config: composedRows() }]
  assert.deepEqual(nativeCapabilityFailures(nested, resolveFromDsh), [])
})

test('a required row inside a disabled group is reported as disabled', () => {
  const disabled = [{
    id: 'plugins',
    name: 'cordis:group',
    group: true,
    disabled: true,
    config: composedRows(),
  }]
  const failures = nativeCapabilityFailures(disabled, resolveFromDsh)
  const required = ['llm-retry', 'spill-local', 'spill-policy', 'subprocess']
  assert.equal(failures.length, required.length,
    `every required row inherits the group's disabled state; got ${JSON.stringify(failures)}`)
  for (const id of required) {
    const failure = failures.find(message => message.includes(`the ${id} row`))
    assert.ok(failure !== undefined, `the ${id} row must be reported; got ${JSON.stringify(failures)}`)
    assert.match(failure, /disabled/u, `the ${id} row must be reported as disabled; got ${failure}`)
  }
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
    const patches = boot.loadOverlayPatches('dsh', installedPatch)
    // Nest the inserted rows in a group only when the bundle is still flat:
    // after #161 the shipped insert already has the kernel/plugins groups, and
    // wrapping those in a second `kernel` group would reuse the loader's entry
    // id for both parent and child (a cyclic parent chain at boot).
    const alreadyGrouped = patches.some(patch => Array.isArray(patch.insert)
      && patch.insert.some(row => row.group === true))
    const grouped = alreadyGrouped ? patches : patches.map(patch => Array.isArray(patch.insert)
      ? { ...patch, insert: [{ id: 'kernel', name: 'cordis:group', group: true, config: patch.insert }] }
      : patch)
    const groupedIds = []
    const collectIds = rows => rows.forEach(row => {
      groupedIds.push(row.id)
      if (Array.isArray(row.config)) collectIds(row.config)
    })
    grouped.forEach(patch => collectIds(patch.insert ?? []))
    assert.equal(new Set(groupedIds).size, groupedIds.length,
      `the mutated composition must not reuse a row id: ${JSON.stringify(groupedIds)}`)
    // pnpm installs a `file:` package by hard-linking its files: writing the
    // installed path in place would rewrite the worktree's own bundle. Replace
    // the directory entry instead so the source inode stays untouched.
    const replaceInstalledPatch = text => {
      const temp = `${installedPatch}.next`
      writeFileSync(temp, text)
      renameSync(temp, installedPatch)
    }
    replaceInstalledPatch(yaml.dump(grouped, { schema: entryListSchema, noRefs: true }))
    assert.equal(doctorCheck(runBackend(['doctor', '--json'], env)).ok, true,
      'the check must pass with the required rows inside a group')

    // Remove the row by id, wherever it is nested — not by matching its
    // indentation, which grouping changes.
    const removed = grouped.some(patch => Array.isArray(patch.insert) && removeRow(patch.insert, 'llm-retry'))
    assert.ok(removed, 'the installed bundle must declare the llm-retry row for this test to remove it')
    replaceInstalledPatch(yaml.dump(grouped, { schema: entryListSchema, noRefs: true }))

    const failed = doctorCheck(runBackend(['doctor', '--json'], env))
    assert.equal(failed.ok, false, `a profile without llm-retry must fail the check; doctor reported ${JSON.stringify(failed)}`)
    assert.match(failed.detail, /llm-retry/u)
    assert.match(failed.detail, /@deepseek-ai\/dsh-llm-retry/u)
    assert.match(failed.detail, /--reinstall/u)
  } finally {
    removeHome(home)
  }
})
