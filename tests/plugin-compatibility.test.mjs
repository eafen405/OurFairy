/**
 * Product packages declare the dsh version line they belong to (ticket #98).
 *
 * A `workspace:` peer only resolves inside a pnpm workspace, and the generated
 * profile installs these packages through `file:` dependencies. The peer
 * requirement therefore has to be an explicit range that names the dsh version
 * line. `doctor` judges every installed product package with dsh's own public
 * `evaluatePluginCompatibility` against the pinned dsh runtime version, and
 * these assertions drive the real launcher: a package declaring a range the
 * pinned dsh does not satisfy must fail the compatibility check with the
 * package, the peer, and the range.
 *
 * The copies are not Git checkouts, so doctor's "combo combination" check fails
 * in them for an unrelated reason; only the compatibility check is read.
 *
 * The last test holds every product package to the minimal plugin metadata the
 * dsh plugin page reads: a package description, an exported English locale with
 * a title and description, and the locale declared in both `exports` and
 * `files` so the installed copy publishes it.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readCombo, repoPath } from '../scripts/combo.mjs'
import { copyProductRepo, describeRun, makeHome, productPackageDirs, removeHome, repoRoot, runBackend } from './helpers/backend.mjs'

const roots = []
const homes = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  for (const home of homes) removeHome(home)
})

/** A copied repository plus an isolated home, cleaned up after the file's tests. */
function isolatedRun() {
  const root = copyProductRepo('ourfairy-plugin-compatibility-')
  const home = makeHome('ourfairy-plugin-compatibility-home-')
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
  const check = checks.get('plugin compatibility')
  assert.ok(
    check !== undefined,
    `doctor must run a "plugin compatibility" check; it ran ${JSON.stringify([...checks.keys()])}`,
  )
  return { check, checks }
}

/** The dsh runtime version the pinned checkout publishes, an independent expectation. */
function pinnedDshVersion(root) {
  const { combo } = readCombo(root)
  const manifest = join(repoPath(combo, 'dsh', root), 'packages', 'boot', 'app-boot', 'package.json')
  const version = JSON.parse(readFileSync(manifest, 'utf8')).version
  assert.equal(typeof version, 'string', `${manifest} must publish the dsh runtime version`)
  return version
}

/** The product packages the bundle installs, read from the copied manifest. */
function declaredPackages(root) {
  return Object.keys(JSON.parse(readFileSync(join(root, 'backend', 'v1-bundle', 'package.json'), 'utf8')).dependencies ?? {})
}

test('every installed product package is compatible with the pinned dsh', () => {
  const { root, home } = isolatedRun()
  const { check } = doctor({ root, home })
  assert.equal(check.ok, true, `the shipped product packages must be compatible: ${JSON.stringify(check)}`)

  // The check must say which dsh version it judged against, or a green result
  // cannot be told apart from one judged against another runtime.
  const version = pinnedDshVersion(root)
  assert.ok(
    check.detail.includes(version),
    `the check must report the dsh version it judged (${version}): ${check.detail}`,
  )
  for (const name of declaredPackages(root)) {
    assert.ok(check.detail.includes(name), `the check must report ${name} as checked: ${check.detail}`)
  }
  // The judged set is what the profile installed, not what the bundle declared:
  // the bundle and the test-only probe are installed product packages too.
  const installed = readdirSync(join(home, 'dsh-home', 'profiles', 'ourfairy', 'node_modules', '@ourfairy'))
    .map(name => `@ourfairy/${name}`)
  for (const name of installed) {
    assert.ok(check.detail.includes(name), `the check must judge ${name} because the profile installed it: ${check.detail}`)
  }
})

test('a product package peer the pinned dsh does not satisfy fails naming the package, peer, and range', () => {
  const { root, home } = isolatedRun()
  const manifestPath = join(root, 'backend', 'chat', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // The pinned dsh is 0.2.1-alpha.2: a 9.x peer can never be satisfied by it.
  manifest.peerDependencies['@deepseek-ai/dsh-agent'] = '^9.0.0'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)

  const { check } = doctor({ root, home })
  const version = pinnedDshVersion(root)
  assert.equal(check.ok, false, `a peer outside the pinned dsh range must fail the check: ${JSON.stringify(check)}`)
  for (const needle of ['@ourfairy/dsh-chat', '@deepseek-ai/dsh-agent', '^9.0.0', version]) {
    assert.ok(check.detail.includes(needle), `the failure must name ${needle}: ${check.detail}`)
  }
})

test('every product package declares an explicit semver peer range, not the workspace protocol', () => {
  const offenders = []
  for (const dir of productPackageDirs()) {
    const path = join(dir, 'package.json')
    const peers = JSON.parse(readFileSync(join(repoRoot, path), 'utf8')).peerDependencies ?? {}
    for (const [name, range] of Object.entries(peers)) {
      if (typeof range !== 'string' || !/^\^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(range)) {
        offenders.push(`${path}: ${name} -> ${JSON.stringify(range)}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every peer must be an explicit caret range on the version line it was built against; offenders:${'\n'}${offenders.join('\n')}`,
  )
})

/**
 * The metadata dsh's `readPluginMeta` reads for a plugin page: the package
 * description is the fallback, and `locale/en.json` supplies the title and
 * description that replace it. The locale must be exported and published, or
 * the installed copy cannot answer the reader. `backend/probe` is test
 * machinery, not a product package; the bundle already complies.
 */
test('every product package ships a description and an exported English locale', () => {
  const packageDirs = productPackageDirs({ exclude: ['probe'] })
  assert.ok(packageDirs.length > 0, 'backend/ must contain product packages with manifests')

  const failures = []
  for (const dir of packageDirs) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'))
    const label = `${dir} (${manifest.name ?? 'unnamed'})`
    if (typeof manifest.description !== 'string' || manifest.description.trim() === '') {
      failures.push(`${label}: package.json needs a non-empty description fallback`)
    }
    if (manifest.exports?.['./locale/*.json'] !== './locale/*.json') {
      failures.push(`${label}: exports must declare "./locale/*.json": "./locale/*.json"`)
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes('locale/*.json')) {
      failures.push(`${label}: files must include "locale/*.json"`)
    }
    const localePath = join(repoRoot, dir, 'locale', 'en.json')
    if (!existsSync(localePath)) {
      failures.push(`${label}: locale/en.json is missing`)
      continue
    }
    let meta
    try {
      meta = JSON.parse(readFileSync(localePath, 'utf8')).meta
    } catch (error) {
      failures.push(`${label}: locale/en.json is not valid JSON: ${error.message}`)
      continue
    }
    for (const field of ['title', 'description']) {
      if (typeof meta?.[field] !== 'string' || meta[field].trim() === '') {
        failures.push(`${label}: locale/en.json needs a non-empty meta.${field}`)
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    `product packages must ship the minimal plugin metadata the plugin page reads:${'\n'}${failures.join('\n')}`,
  )
})
