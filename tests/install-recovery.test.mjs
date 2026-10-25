/**
 * Install recovery, observed through the launcher CLI (ticket #230).
 *
 * The launcher's install is a subprocess, so its failure and retry behavior is
 * only visible through the process it spawns. A fake `corepack` first on PATH
 * stands in for pnpm: it records every call (including whether the profile
 * lockfile existed when it ran) and produces the artifacts a successful install
 * would. Production is untouched — the fake only replaces the pnpm process, and
 * the launcher still performs its own linked-manifest validation, template
 * publication and stamp write.
 *
 * Every case uses a throwaway repository copy and an isolated home, because a
 * successful install publishes a template under the repository root.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { copyProductRepo, makeHome, removeHome, runBackend } from './helpers/backend.mjs'
import {
  corepackCalls,
  fakeCorepackEnv,
  installFakeCorepack,
  removeFakeCorepack,
} from './helpers/fake-corepack.mjs'

const roots = []
const homes = []
const fakes = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  for (const home of homes) removeHome(home)
  for (const fake of fakes) removeFakeCorepack(fake)
})

/**
 * One case's isolated world: a repository copy the launcher reads, an empty
 * home, and the fake corepack that answers its pnpm calls.
 * @param {{installs: string[], lockfile?: 'stale'|'absent'}} options - the fake's
 *   per-install outcomes, and whether the profile starts with a stale lockfile.
 * @returns {{root: string, home: string, fake: object, combination: object, profileDir: string}}
 */
function isolatedCase({ installs, lockfile = 'absent' }) {
  const root = copyProductRepo('ourfairy-install-recovery-repo-')
  roots.push(root)
  const home = makeHome('ourfairy-install-recovery-home-')
  homes.push(home)
  const fake = installFakeCorepack({ installs })
  fakes.push(fake)
  const combination = JSON.parse(readFileSync(join(root, 'combo.json'), 'utf8'))
  const profileDir = join(home, 'dsh-home', 'profiles', combination.backend.profileName)
  mkdirSync(profileDir, { recursive: true })
  if (lockfile === 'stale') writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  return { root, home, fake, combination, profileDir }
}

/**
 * Run `doctor --json` against one case's copy and home.
 * @returns the report parsed from the first `{` of stdout.
 */
function doctor({ root, home, fake }) {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
    ...fakeCorepackEnv(fake),
  }, { root })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${run.stdout}\n${run.stderr}`)
  return JSON.parse(run.stdout.slice(start))
}

/**
 * The doctor check with this name.
 * @param {{checks: Array<{name: string}>}} report - a parsed doctor report.
 * @param {string} name - the check to read.
 */
function checkNamed(report, name) {
  const check = report.checks.find(entry => entry.name === name)
  assert.ok(check !== undefined, `doctor must record ${name}; it recorded ${JSON.stringify(report.checks.map(entry => entry.name))}`)
  return check
}

/** The fake's install calls, in the order pnpm was asked to install. */
function installCalls(fake) {
  return corepackCalls(fake).filter(call => call.kind === 'install')
}

/** A failed install must leave neither a published template nor a source stamp. */
function assertNoInstallArtifacts({ root, profileDir }) {
  const templateRoot = join(root, '.ourfairy-template')
  const templates = existsSync(templateRoot) ? readdirSync(templateRoot) : []
  assert.deepEqual(templates, [], `a failed install must not publish a template: ${JSON.stringify(templates)}`)
  assert.equal(
    existsSync(join(profileDir, '.ourfairy-source-hash')),
    false,
    'a failed install must not stamp the profile with a source hash',
  )
}

test('an install that fails with a stale lockfile is retried once and reports installed', () => {
  const c = isolatedCase({ installs: ['fail', 'succeed'], lockfile: 'stale' })
  const report = doctor(c)

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, true, `the retried install must succeed: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.endsWith(' (installed)'),
    `the profile check must report the mode of the performed install: ${JSON.stringify(linked.detail)}`,
  )
  assert.equal(
    checkNamed(report, 'corepack pnpm pin available').ok,
    true,
    'the fake corepack must answer the pin probe doctor runs before installing',
  )

  const calls = corepackCalls(c.fake)
  const versions = calls.filter(call => call.kind === 'version')
  assert.equal(versions.length, 1, `doctor must ask the pin once; the log holds ${JSON.stringify(calls)}`)
  assert.deepEqual(versions[0].argv, [`pnpm@${c.combination.backend.pnpmPin}`, '--version'])

  const installs = installCalls(c.fake)
  assert.equal(installs.length, 2, `a stale-lockfile failure must be retried exactly once: ${JSON.stringify(installs)}`)
  // The lockfile the launcher read at the start of each call: present before the
  // first attempt, gone before the retry. That is the whole recovery contract.
  assert.deepEqual(installs.map(call => call.lockfile), [true, false], JSON.stringify(installs))
  assert.deepEqual(installs.map(call => call.attempt), [1, 2])
  assert.deepEqual(installs.map(call => call.outcome), ['fail', 'succeed'])
  assert.deepEqual(installs.map(call => call.cwd), [c.profileDir, c.profileDir])
  assert.deepEqual(installs[0].argv, [
    `pnpm@${c.combination.backend.pnpmPin}`,
    'install',
    '--ignore-scripts',
    '--package-import-method',
    'copy',
    '--store-dir',
    join(c.home, 'pnpm-store'),
  ])

  // The successful retry publishes the shared template and stamps the profile
  // with the hash its directory name carries.
  const templateRoot = join(c.root, '.ourfairy-template')
  assert.ok(existsSync(templateRoot), 'a successful install must publish its template under the repository root')
  const templates = readdirSync(templateRoot)
  assert.equal(templates.length, 1, `one install publishes one template: ${JSON.stringify(templates)}`)
  const template = join(templateRoot, templates[0])
  const stampPath = join(c.profileDir, '.ourfairy-source-hash')
  assert.ok(existsSync(stampPath), 'a successful install must stamp the profile with the hash it installed')
  const stamp = readFileSync(stampPath, 'utf8').trim()
  assert.equal(
    templates[0],
    `${stamp}-${c.combination.backend.pnpmPin}`,
    'the stamp must name the template hash the install published',
  )
  const linkedManifest = join(template, 'node_modules', ...c.combination.backend.bundlePackage.split('/'), 'package.json')
  assert.ok(existsSync(linkedManifest), `the template must carry the linked bundle manifest: ${linkedManifest}`)
  assert.equal(JSON.parse(readFileSync(linkedManifest, 'utf8')).name, c.combination.backend.bundlePackage)
  assert.equal(
    readFileSync(join(template, 'pnpm-lock.yaml'), 'utf8'),
    readFileSync(join(c.profileDir, 'pnpm-lock.yaml'), 'utf8'),
    'the template lockfile must be the one the successful install produced',
  )
})

test('an install that fails twice keeps both failures and publishes nothing', () => {
  const c = isolatedCase({ installs: ['fail', 'fail'], lockfile: 'stale' })
  const report = doctor(c)

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `two failed installs must fail the profile check: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.startsWith(`profile install failed in ${c.profileDir} (exit 1):\n`),
    `the check must keep the install-failure contract: ${JSON.stringify(linked.detail)}`,
  )
  assert.ok(
    linked.detail.includes('the profile lockfile was stale and has been dropped; the retry failed too.'),
    `the check must say the retry after dropping the lockfile also failed: ${JSON.stringify(linked.detail)}`,
  )
  assert.ok(
    linked.detail.includes('the first failure was:'),
    `the check must carry the first failure instead of replacing it: ${JSON.stringify(linked.detail)}`,
  )
  for (const fragment of [
    'fake corepack: install attempt 1 failed',
    'fake corepack stderr: simulated pnpm failure on attempt 1',
    'fake corepack: install attempt 2 failed',
    'fake corepack stderr: simulated pnpm failure on attempt 2',
  ]) {
    assert.ok(
      linked.detail.includes(fragment),
      `both installs' output must survive in the error; ${JSON.stringify(fragment)} is missing from ${JSON.stringify(linked.detail)}`,
    )
  }

  const installs = installCalls(c.fake)
  assert.equal(installs.length, 2, `a stale lockfile is dropped once and the install retried once: ${JSON.stringify(installs)}`)
  assert.deepEqual(installs.map(call => call.lockfile), [true, false], JSON.stringify(installs))
  assert.deepEqual(installs.map(call => call.outcome), ['fail', 'fail'])
  assertNoInstallArtifacts(c)
})

test('a first install failure without a stale lockfile is not retried', () => {
  const c = isolatedCase({ installs: ['fail'], lockfile: 'absent' })
  const report = doctor(c)

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `a failed install must fail the profile check: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.startsWith(`profile install failed in ${c.profileDir} (exit 1):\n`),
    `the check must keep the install-failure contract: ${JSON.stringify(linked.detail)}`,
  )
  assert.ok(
    linked.detail.includes('fake corepack stderr: simulated pnpm failure on attempt 1'),
    `the check must carry the install's own failure: ${JSON.stringify(linked.detail)}`,
  )
  // Without a lockfile to blame, a retry would be a second blind attempt; the
  // launcher must stop and report the one failure it has.
  assert.ok(
    !linked.detail.includes('the profile lockfile was stale'),
    `no lockfile means no lockfile-retry note: ${JSON.stringify(linked.detail)}`,
  )
  assert.ok(
    !linked.detail.includes('the first failure was:'),
    `no retry means no first-failure section: ${JSON.stringify(linked.detail)}`,
  )

  const installs = installCalls(c.fake)
  assert.equal(installs.length, 1, `an install failure with no lockfile is not retried: ${JSON.stringify(installs)}`)
  assert.deepEqual(installs.map(call => call.lockfile), [false])
  assert.deepEqual(installs.map(call => call.outcome), ['fail'])
  assertNoInstallArtifacts(c)
})

test('an install that reports success without the linked bundle fails loudly', () => {
  const c = isolatedCase({ installs: ['succeed-without-linked'] })
  const report = doctor(c)

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `a success with no linked bundle must fail the profile check: ${JSON.stringify(linked)}`)
  const linkedManifest = join(c.profileDir, 'node_modules', ...c.combination.backend.bundlePackage.split('/'), 'package.json')
  assert.ok(
    linked.detail.includes(`profile install reported success but ${linkedManifest} is missing;`),
    `the check must name the missing linked bundle: ${JSON.stringify(linked.detail)}`,
  )
  assert.ok(
    linked.detail.includes('the product bundle would be silently skipped instead of failing the boot'),
    `the check must explain why a missing linked bundle is fatal: ${JSON.stringify(linked.detail)}`,
  )

  const installs = installCalls(c.fake)
  assert.equal(installs.length, 1, `the fake reported success, so there is nothing to retry: ${JSON.stringify(installs)}`)
  assert.deepEqual(installs.map(call => call.outcome), ['succeed-without-linked'])
  // The install really did report success at the process seam: the fake wrote
  // its lockfile and only the linked bundle manifest is absent.
  assert.ok(existsSync(join(c.profileDir, 'pnpm-lock.yaml')), 'the fake must leave the lockfile a successful install writes')
  assert.equal(existsSync(linkedManifest), false, 'this case is defined by the linked bundle manifest being absent')
  assertNoInstallArtifacts(c)
})
