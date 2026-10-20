/**
 * Bundle package authority for ticket #96.
 *
 * The bundle's `dependencies` are the product package inventory: the launcher
 * derives the generated profile's dependencies from them (plus the probe named
 * by combo.json), and `doctor` compares that inventory with the rows the
 * bundle's patch mounts and with the packages actually installed in the
 * profile. The assertions drive the real launcher against throwaway copies of
 * the product sources, so a package the bundle stops declaring, a row mounting
 * a package nobody declared, or two rows mounting one module each fail here
 * with the package name and the row id a person has to edit.
 *
 * `doctor` exits non-zero in these copies for an unrelated reason: the copy is
 * not a Git checkout, so its "combo combination" check fails. Only the
 * "bundle packages" check is read.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readCombo, repoPath } from '../scripts/combo.mjs'
import { copyProductRepo, describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'

const roots = []
const homes = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  for (const home of homes) removeHome(home)
})

/** A copied repository plus an isolated home, cleaned up after the file's tests. */
function isolatedRun() {
  const root = copyProductRepo('ourfairy-bundle-packages-')
  const home = makeHome('ourfairy-bundle-packages-home-')
  roots.push(root)
  homes.push(home)
  return { root, home }
}

/** Run `doctor --json` and return its checks; the exit code is deliberately not asserted. */
function doctor({ root, home }) {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  }, { root })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  const report = JSON.parse(run.stdout.slice(start))
  const checks = new Map(report.checks.map(check => [check.name, check]))
  const check = checks.get('bundle packages')
  assert.ok(
    check !== undefined,
    `doctor must run a "bundle packages" check; it ran ${JSON.stringify([...checks.keys()])}`,
  )
  return { check, checks }
}

const bundleDir = root => join(root, 'backend', 'v1-bundle')
const bundleManifest = root => JSON.parse(readFileSync(join(bundleDir(root), 'package.json'), 'utf8'))
const bundlePatch = root => join(bundleDir(root), 'cordis.patch.yml')
const profileDir = home => join(home, 'dsh-home', 'profiles', 'ourfairy')
const profileManifest = home => JSON.parse(readFileSync(join(profileDir(home), 'package.json'), 'utf8'))

/** Rewrite the copied bundle manifest after the caller changed it. */
function writeBundleManifest(root, manifest) {
  writeFileSync(join(bundleDir(root), 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/** Append one more top-level `insert` patch to the copied bundle's row file. */
function appendRow(root, id, name) {
  writeFileSync(
    bundlePatch(root),
    `${readFileSync(bundlePatch(root), 'utf8')}\n- insert:\n    - id: ${id}\n      name: '${name}'\n`,
  )
}

/** Append one `insert` patch as written, for rows the loader nests or targets. */
function appendPatch(root, patch) {
  writeFileSync(bundlePatch(root), `${readFileSync(bundlePatch(root), 'utf8')}\n${patch}\n`)
}

test('the bundle rows, its declared packages, and the installed profile agree', () => {
  const { root, home } = isolatedRun()
  const { check } = doctor({ root, home })
  assert.equal(check?.ok, true, `the shipped bundle must be internally consistent: ${JSON.stringify(check)}`)
  // The check reports where each declared package is mounted, including the
  // package that contributes two rows.
  for (const needle of ['@ourfairy/dsh-spaces', 'sandbox-policy', 'spaces']) {
    assert.ok(check.detail.includes(needle), `the check must report ${needle}: ${check.detail}`)
  }

  const expected = [
    '@ourfairy/dsh-v1-bundle',
    '@ourfairy/dsh-baseline-probe',
    ...Object.keys(bundleManifest(root).dependencies),
  ].sort()
  assert.deepEqual(
    Object.keys(profileManifest(home).dependencies).sort(),
    expected,
    'the generated profile must install the bundle, the probe, and exactly the packages the bundle declares',
  )
  // pnpm installs the bundle's own `file:` dependencies, so the product
  // packages reach the profile through the bundle rather than a launcher list.
  const installed = readdirSync(join(profileDir(home), 'node_modules', '@ourfairy')).map(name => `@ourfairy/${name}`).sort()
  assert.deepEqual(installed, expected, 'every profile dependency must be installed under the isolated home')
})

test('a package the bundle stops declaring fails and names the row that still mounts it', () => {
  const { root, home } = isolatedRun()
  const manifest = bundleManifest(root)
  delete manifest.dependencies['@ourfairy/dsh-search']
  writeBundleManifest(root, manifest)

  const { check } = doctor({ root, home })
  assert.equal(check.ok, false, `a row mounting an undeclared package must fail the check: ${JSON.stringify(check)}`)
  for (const needle of ['@ourfairy/dsh-search', 'conversation-search']) {
    assert.ok(check.detail.includes(needle), `the failure must name ${needle}: ${check.detail}`)
  }

  // A hand-kept launcher list would keep installing the package; the generated
  // profile must follow the bundle's declaration alone.
  assert.equal(
    Object.hasOwn(profileManifest(home).dependencies, '@ourfairy/dsh-search'),
    false,
    `the profile must not install a package the bundle no longer declares: ${JSON.stringify(profileManifest(home).dependencies)}`,
  )
  assert.equal(
    existsSync(join(profileDir(home), 'node_modules', '@ourfairy', 'dsh-search')),
    false,
    'the undeclared package must not be installed in the generated profile',
  )
})

test('a declared package no row mounts fails and names the package', () => {
  const { root, home } = isolatedRun()
  writeFileSync(
    bundlePatch(root),
    readFileSync(bundlePatch(root), 'utf8')
      .replace("name: '@ourfairy/dsh-identity'", "name: '@deepseek-ai/dsh-identity'"),
  )

  const { check } = doctor({ root, home })
  assert.equal(check.ok, false, `a declared but unmounted package must fail the check: ${JSON.stringify(check)}`)
  assert.ok(check.detail.includes('@ourfairy/dsh-identity'), `the failure must name the package: ${check.detail}`)
  assert.match(check.detail, /no bundle row mounts it/, `the failure must say nothing mounts it: ${check.detail}`)
})

test('two rows mounting one module specifier fail and name the module and both row ids', () => {
  const { root, home } = isolatedRun()
  appendRow(root, 'identity-duplicate', '@ourfairy/dsh-identity')

  const { check } = doctor({ root, home })
  assert.equal(check.ok, false, `a duplicate mount must fail the check: ${JSON.stringify(check)}`)
  for (const needle of ['@ourfairy/dsh-identity', 'identity-duplicate', 'identity']) {
    assert.ok(check.detail.includes(needle), `the failure must name ${needle}: ${check.detail}`)
  }
})

test('a row mounting an undeclared @ourfairy package fails and names the package and row id', () => {
  const { root, home } = isolatedRun()
  appendRow(root, 'ghost', '@ourfairy/dsh-ghost')

  const { check } = doctor({ root, home })
  assert.equal(check.ok, false, `an undeclared mounted package must fail the check: ${JSON.stringify(check)}`)
  for (const needle of ['@ourfairy/dsh-ghost', 'ghost']) {
    assert.ok(check.detail.includes(needle), `the failure must name ${needle}: ${check.detail}`)
  }
})

test('a product package installed without a bundle declaration fails and names it', () => {
  const { root, home } = isolatedRun()
  // The first doctor installs the profile and writes the source-hash stamp; a
  // second doctor reuses it, so the extra directory below survives (pnpm would
  // prune it on a reinstall).
  const installed = doctor({ root, home })
  assert.equal(installed.check.ok, true, `the shipped profile must install cleanly first: ${JSON.stringify(installed.check)}`)
  const ghostDir = join(profileDir(home), 'node_modules', '@ourfairy', 'dsh-ghost')
  mkdirSync(ghostDir, { recursive: true })
  writeFileSync(join(ghostDir, 'package.json'), `${JSON.stringify({
    name: '@ourfairy/dsh-ghost', version: '0.1.0', private: true,
  }, undefined, 2)}\n`)

  const { check } = doctor({ root, home })
  assert.equal(check.ok, false, `an installed but undeclared product package must fail the check: ${JSON.stringify(check)}`)
  assert.ok(check.detail.includes('@ourfairy/dsh-ghost'), `the failure must name @ourfairy/dsh-ghost: ${check.detail}`)
})

test('the installed bundle ships only its declared files, including the locale', () => {
  const { root, home } = isolatedRun()
  const { checks } = doctor({ root, home })

  const installed = join(profileDir(home), 'node_modules', '@ourfairy', 'dsh-v1-bundle')
  assert.deepEqual(
    readdirSync(installed).sort(),
    ['README.md', 'cordis.patch.yml', 'locale', 'package.json'],
    'the installed copy must carry the patch, the README, the locale, and its manifest — and nothing the manifest does not publish',
  )
  const locale = join(installed, 'locale', 'en.json')
  assert.ok(existsSync(locale), `the installed bundle copy must ship locale/en.json; it holds ${readdirSync(join(installed, 'locale'))}`)
  assert.equal(
    readFileSync(locale, 'utf8'),
    readFileSync(join(bundleDir(root), 'locale', 'en.json'), 'utf8'),
    'the installed locale must be the one this checkout publishes',
  )

  // The staleness hash covers what the install copies, so the files above are
  // also what makes a changed bundle reinstall.
  const hashed = checks.get('product packages').detail.split(', ')
  for (const file of [
    'backend/v1-bundle/cordis.patch.yml',
    'backend/v1-bundle/README.md',
    'backend/v1-bundle/locale/en.json',
  ]) {
    assert.ok(hashed.includes(file), `${file} is installed, so the staleness hash must cover it; doctor listed ${hashed.join(', ')}`)
  }
})

test('the installed copy boots with no product source tree behind it', () => {
  const { root, home } = isolatedRun()
  // Install the profile from the copy, then take the copy's product sources
  // away: what remains on disk is exactly what pnpm published into the
  // isolated home. A boot that still reads the checkout would fail here.
  const { check } = doctor({ root, home })
  assert.equal(check.ok, true, `the profile must install cleanly first: ${JSON.stringify(check)}`)
  rmSync(join(root, 'backend'), { recursive: true, force: true })

  const installed = join(profileDir(home), 'node_modules', '@ourfairy')
  const overlay = join(installed, 'dsh-baseline-probe', 'overlay.patch.yml')
  const reportPath = join(home, 'installed-copy-probe.json')
  // A boot reads the model selection from the bundle row; it needs no explicit
  // pair from the environment (#103).
  const { combo } = readCombo(root)
  const dshBin = join(repoPath(combo, 'dsh', root), 'apps', 'cli', 'lib', 'bin.js')
  const result = spawnSync(process.execPath, [dshBin, '--profile', 'ourfairy', '--patch', overlay], {
    cwd: home,
    encoding: 'utf8',
    timeout: 300_000,
    env: {
      ...process.env,
      HOME: join(home, 'user-home'),
      DSH_HOME: join(home, 'dsh-home'),
      OURFAIRY_HOME: home,
      OURFAIRY_PORT: '0',
      OURFAIRY_PROBE_REPORT: reportPath,
      OURFAIRY_PROBE_MODE: 'boot',
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_STATE_HOME: join(home, 'state'),
    },
  })
  assert.equal(result.status, 0, describeRun('installed-copy boot', result))
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  assert.equal(report.ok, true, `the installed copy alone must boot serving: ${JSON.stringify(report.failures)}`)
  const productRows = (report.rows ?? []).filter(row => String(row.name).startsWith('@ourfairy/'))
  assert.ok(productRows.length > 0, `the boot reported no product rows: ${JSON.stringify(report.rows)}`)
})

test('a product row nested in a group is part of the package set', () => {
  const { root, home } = isolatedRun()
  // The loader mounts a group's children too, so a package set that only read
  // the top level would miss a row #99-#101 might nest. A nested undeclared row
  // must be reported like any other.
  appendPatch(root, "- insert:\n    - id: group-test\n      name: '@deepseek-ai/dsh-tool-todo'\n      group: true\n      config:\n        - id: nested-product-row\n          name: '@ourfairy/dsh-nested'")

  const { check } = doctor({ root, home })
  assert.equal(check.ok, false, `a nested undeclared product row must fail the check: ${JSON.stringify(check)}`)
  for (const needle of ['@ourfairy/dsh-nested', 'nested-product-row']) {
    assert.ok(check.detail.includes(needle), `the failure must name ${needle}: ${check.detail}`)
  }
})
