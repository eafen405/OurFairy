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
 * successful install publishes a template under the repository root. The
 * failure cases also read the process result: a failed install must fail the
 * whole `doctor` run, not only its profile check.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { copyProductRepo, describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'
import {
  corepackCalls,
  fakeCorepackEnv,
  installFakeCorepack,
  removeFakeCorepack,
} from './helpers/fake-corepack.mjs'
import { assertPublishedTemplate, checkNamed, linkedBundleManifestPath } from './helpers/profile-install.mjs'

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
 * @returns {{root: string, home: string, fake: object, backend: object, profileDir: string}}
 */
function isolatedCase({ installs, lockfile = 'absent' }) {
  const root = copyProductRepo('ourfairy-install-recovery-repo-')
  roots.push(root)
  const home = makeHome('ourfairy-install-recovery-home-')
  homes.push(home)
  const fake = installFakeCorepack({ installs })
  fakes.push(fake)
  const { backend } = JSON.parse(readFileSync(join(root, 'combo.json'), 'utf8'))
  const profileDir = join(home, 'dsh-home', 'profiles', backend.profileName)
  mkdirSync(profileDir, { recursive: true })
  if (lockfile === 'stale') writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  return { root, home, fake, backend, profileDir }
}

/**
 * Run `doctor --json` against one case's copy and home.
 * @returns {{run: {code: number, stdout: string, stderr: string}, report: object}}
 *   the process result and the report parsed from the first `{` of stdout.
 */
function doctor({ root, home, fake }) {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
    ...fakeCorepackEnv(fake),
  }, { root })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  return { run, report: JSON.parse(run.stdout.slice(start)) }
}

/** The fake's install calls, in the order pnpm was asked to install. */
function installCalls(fake) {
  return corepackCalls(fake).filter(call => call.kind === 'install')
}

/** A failed install must leave no template directory and no source stamp. */
function assertNoInstallArtifacts({ root, profileDir }) {
  const templateRoot = join(root, '.ourfairy-template')
  assert.equal(existsSync(templateRoot), false, `a failed install must not publish a template under ${templateRoot}`)
  assert.equal(
    existsSync(join(profileDir, '.ourfairy-source-hash')),
    false,
    'a failed install must not stamp the profile with a source hash',
  )
}

/** A failure only counts when the whole report and the process say so. */
function assertFailedRun({ report, run }) {
  assert.equal(report.ok, false, `a failed install must fail the whole doctor report: ${JSON.stringify(report.checks)}`)
  assert.notEqual(run.code, 0, `doctor must exit non-zero when the install failed:\n${describeRun('doctor', run)}`)
}

test('an install that fails with a stale lockfile is retried once and reports installed', () => {
  const world = isolatedCase({ installs: ['fail', 'succeed'], lockfile: 'stale' })
  const { bundlePackage, pnpmPin } = world.backend
  const { report } = doctor(world)

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, true, `the retried install must succeed: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.endsWith(' (installed)'),
    `the profile check must report the mode of the performed install: ${JSON.stringify(linked.detail)}`,
  )

  const calls = corepackCalls(world.fake)
  assert.deepEqual(
    calls.filter(call => call.kind !== 'version').map(call => call.kind),
    ['install', 'install'],
    `beyond the pin query, the launcher must only ask pnpm to install: ${JSON.stringify(calls)}`,
  )
  const installs = installCalls(world.fake)
  assert.equal(installs.length, 2, `a stale-lockfile failure must be retried exactly once: ${JSON.stringify(installs)}`)
  // The lockfile the launcher read at the start of each call: present before the
  // first attempt, gone before the retry. That is the whole recovery contract.
  assert.deepEqual(installs.map(call => call.lockfile), [true, false], JSON.stringify(installs))
  assert.deepEqual(installs.map(call => call.attempt), [1, 2])
  assert.deepEqual(installs.map(call => call.outcome), ['fail', 'succeed'])
  assert.deepEqual(installs.map(call => call.cwd), [world.profileDir, world.profileDir])

  // The successful retry publishes the shared template and stamps the profile
  // with the hash its directory name carries.
  const stampPath = join(world.profileDir, '.ourfairy-source-hash')
  assert.ok(existsSync(stampPath), 'a successful install must stamp the profile with the hash it installed')
  const { template } = assertPublishedTemplate({
    templateRoot: join(world.root, '.ourfairy-template'),
    stamp: readFileSync(stampPath, 'utf8').trim(),
    pnpmPin,
    bundlePackage,
  })
  assert.equal(
    readFileSync(join(template, 'pnpm-lock.yaml'), 'utf8'),
    readFileSync(join(world.profileDir, 'pnpm-lock.yaml'), 'utf8'),
    'the template lockfile must be the one the successful install produced',
  )
})

test('an install that fails twice keeps both failures and publishes nothing', () => {
  const world = isolatedCase({ installs: ['fail', 'fail'], lockfile: 'stale' })
  const { report, run } = doctor(world)
  assertFailedRun({ report, run })

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `two failed installs must fail the profile check: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.startsWith(`profile install failed in ${world.profileDir} (exit 1):\n`),
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

  const installs = installCalls(world.fake)
  assert.equal(installs.length, 2, `a stale lockfile is dropped once and the install retried once: ${JSON.stringify(installs)}`)
  assert.deepEqual(installs.map(call => call.lockfile), [true, false], JSON.stringify(installs))
  assert.deepEqual(installs.map(call => call.outcome), ['fail', 'fail'])
  assertNoInstallArtifacts(world)
})

test('a first install failure without a stale lockfile is not retried', () => {
  const world = isolatedCase({ installs: ['fail'], lockfile: 'absent' })
  const { report, run } = doctor(world)
  assertFailedRun({ report, run })

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `a failed install must fail the profile check: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.startsWith(`profile install failed in ${world.profileDir} (exit 1):\n`),
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

  const installs = installCalls(world.fake)
  assert.equal(installs.length, 1, `an install failure with no lockfile is not retried: ${JSON.stringify(installs)}`)
  assert.deepEqual(installs.map(call => call.lockfile), [false])
  assert.deepEqual(installs.map(call => call.outcome), ['fail'])
  assertNoInstallArtifacts(world)
})

test('an install that reports success without the linked bundle fails loudly', () => {
  const world = isolatedCase({ installs: ['succeed-without-linked'] })
  const { bundlePackage } = world.backend
  const { report, run } = doctor(world)
  assertFailedRun({ report, run })

  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `a success with no linked bundle must fail the profile check: ${JSON.stringify(linked)}`)
  const linkedManifest = linkedBundleManifestPath(world.profileDir, bundlePackage)
  assert.ok(
    linked.detail.includes(`profile install reported success but ${linkedManifest} is missing;`),
    `the check must name the missing linked bundle: ${JSON.stringify(linked.detail)}`,
  )
  assert.ok(
    linked.detail.includes('the product bundle would be silently skipped instead of failing the boot'),
    `the check must explain why a missing linked bundle is fatal: ${JSON.stringify(linked.detail)}`,
  )

  const installs = installCalls(world.fake)
  assert.equal(installs.length, 1, `the fake reported success, so there is nothing to retry: ${JSON.stringify(installs)}`)
  assert.deepEqual(installs.map(call => call.outcome), ['succeed-without-linked'])
  // The install really did report success at the process seam: the fake wrote
  // its lockfile and only the linked bundle manifest is absent.
  assert.ok(existsSync(join(world.profileDir, 'pnpm-lock.yaml')), 'the fake must leave the lockfile a successful install writes')
  assert.equal(existsSync(linkedManifest), false, 'this case is defined by the linked bundle manifest being absent')
  assertNoInstallArtifacts(world)
})
