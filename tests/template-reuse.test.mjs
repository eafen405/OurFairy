/**
 * Template reuse across isolated homes, observed through the launcher CLI
 * (ticket #231).
 *
 * The closed loop starts with a real pnpm install: no fake is on PATH for the
 * first home, so the template published under the repository copy and the
 * profile's source stamp are production results, not test fixtures. A second
 * home with the same product-source hash then reuses that template through the
 * launcher's own copy decision. For that home a fake corepack is first on PATH
 * with an outcome that records but refuses every install: the pin query is
 * answered, and any install attempt fails loudly and shows up in the call log,
 * so "copied" cannot quietly hide a second real install. A third home shows the
 * existing error when the reuse input itself is damaged: the template is still
 * there but its linked bundle manifest is gone, no install runs, and the failed
 * copy leaves no source stamp.
 *
 * `doctor` exits non-zero in these copies for an unrelated reason: a copy is
 * not a Git checkout, so its "combo combination" check fails. Only the
 * "profile project linked" check is read, as in the other copy-based suites.
 *
 * Real-pnpm evidence is the first home only. The copy, cached, and damaged
 * template cases are fake-recorder evidence; the fake replaces the pnpm
 * process, while template publication, copying, linked-manifest validation and
 * stamp writing stay the launcher's own code.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { after, test } from 'node:test'
import { copyProductRepo, describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'
import {
  corepackCalls,
  fakeCorepackEnv,
  INSTALL_FORBIDDEN,
  installFakeCorepack,
  removeFakeCorepack,
} from './helpers/fake-corepack.mjs'

/** The one repository copy the whole closed loop reads; the worktree stays untouched. */
const root = copyProductRepo('ourfairy-template-reuse-repo-')
const combination = JSON.parse(readFileSync(join(root, 'combo.json'), 'utf8')).backend
const { bundlePackage, pnpmPin, profileName } = combination

/** One home per lifecycle step: publisher, copier, and a fresh home for the damaged template. */
const homeA = makeHome('ourfairy-template-reuse-home-a-')
const homeB = makeHome('ourfairy-template-reuse-home-b-')
const homeC = makeHome('ourfairy-template-reuse-home-c-')
const homes = [homeA, homeB, homeC]
const fakes = []

const templateRoot = join(root, '.ourfairy-template')
const profileDir = home => join(home, 'dsh-home', 'profiles', profileName)
const stampPath = home => join(profileDir(home), '.ourfairy-source-hash')
/** The linked bundle manifest under one installed tree (profile or template). */
function linkBundlePath(dir) {
  return join(dir, 'node_modules', ...bundlePackage.split('/'), 'package.json')
}
/** The linked bundle manifest in one home's installed profile. */
const linkedManifestPath = home => linkBundlePath(profileDir(home))

after(() => {
  rmSync(root, { recursive: true, force: true })
  for (const home of homes) removeHome(home)
  for (const fake of fakes) removeFakeCorepack(fake)
})

/**
 * Run `doctor --json` against the shared copy and one home.
 *
 * No fake means the real corepack on PATH performs any install (home A). A fake
 * is layered over the environment unchanged, so its PATH entry and state
 * directory reach both the pin query and any install the launcher decides to
 * run.
 * @param {string} home - the isolated home to diagnose.
 * @param {{binDir: string, stateDir: string}} [fake] - a fake corepack, when the
 *   copy/reuse path must not install.
 * @returns the parsed doctor report.
 */
function doctor(home, fake) {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    // The template must be reusable: an ambient no-template switch would turn
    // every home into an installer and erase what this file observes.
    OURFAIRY_NO_TEMPLATE: undefined,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
    ...(fake === undefined ? {} : fakeCorepackEnv(fake)),
  }, { root, timeoutMs: fake === undefined ? 900_000 : 120_000 })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  return JSON.parse(run.stdout.slice(start))
}

/** The doctor check with this name. */
function checkNamed(report, name) {
  const check = report.checks.find(entry => entry.name === name)
  assert.ok(check !== undefined, `doctor must record ${name}; it recorded ${JSON.stringify(report.checks.map(entry => entry.name))}`)
  return check
}

/** The one template the first home published, refusing an empty or ambiguous directory. */
function publishedTemplate() {
  assert.ok(existsSync(templateRoot), `the real install must publish its template under ${templateRoot}`)
  const templates = readdirSync(templateRoot)
  assert.equal(templates.length, 1, `one real install publishes one template: ${JSON.stringify(templates)}`)
  return join(templateRoot, templates[0])
}

/**
 * Every process the fake served, refusing anything but the version query.
 *
 * The pin query is expected once per `doctor`. The log is the evidence that a
 * copy or cached decision did not run pnpm install: an install attempt would be
 * recorded before the fake fails it, so its presence is the failure.
 * @param {{stateDir: string}} fake
 * @param {number} expectedVersions - version queries the doctor runs are cumulative.
 */
function assertOnlyVersionQueries(fake, expectedVersions) {
  const calls = corepackCalls(fake)
  assert.deepEqual(
    calls.map(call => call.kind),
    Array.from({ length: expectedVersions }, () => 'version'),
    `the reuse path may query the pinned pnpm version, but must not run install; the log holds ${JSON.stringify(calls)}`,
  )
  for (const call of calls) {
    assert.deepEqual(call.argv, [`pnpm@${pnpmPin}`, '--version'], `the fake must answer the launcher's pin query: ${JSON.stringify(call)}`)
  }
}

/**
 * A digest of one tree's entries, contents and symlink targets, in a stable
 * order. Reading the template is the only thing a copy is allowed to do to it.
 * @param {string} dir - directory to snapshot.
 */
function treeDigest(dir) {
  const hash = createHash('sha256')
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      const path = join(current, entry.name)
      const name = relative(dir, path)
      if (entry.isSymbolicLink()) {
        hash.update(`link ${name} ${readlinkSync(path)}\n`)
      } else if (entry.isDirectory()) {
        hash.update(`dir ${name}\n`)
        walk(path)
      } else {
        hash.update(`file ${name} ${createHash('sha256').update(readFileSync(path)).digest('hex')}\n`)
      }
    }
  }
  walk(dir)
  return hash.digest('hex')
}

test('a real install publishes the profile template and stamps its source hash', () => {
  const report = doctor(homeA)
  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, true, `the real install must succeed: ${JSON.stringify(linked)}`)
  assert.ok(
    linked.detail.endsWith(' (installed)'),
    `the first home must report the install it performed: ${JSON.stringify(linked.detail)}`,
  )

  const stamp = readFileSync(stampPath(homeA), 'utf8').trim()
  const template = publishedTemplate()
  assert.equal(
    template,
    join(templateRoot, `${stamp}-${pnpmPin}`),
    'the published template directory must be named by the stamp the install wrote and the pinned pnpm version',
  )
  assert.ok(
    existsSync(linkBundlePath(template)),
    `the template must carry the linked bundle manifest: ${linkBundlePath(template)}`,
  )
  assert.equal(
    JSON.parse(readFileSync(linkBundlePath(template), 'utf8')).name,
    bundlePackage,
    'the template manifest must name the product bundle',
  )
  assert.ok(
    existsSync(join(template, 'pnpm-lock.yaml')),
    'the template must carry the lockfile the successful install produced',
  )
  // The comparison in the next case needs the publisher's copy of both.
  assert.ok(existsSync(linkedManifestPath(homeA)), `the real install must link the bundle into its profile: ${linkedManifestPath(homeA)}`)
})

test('a second home copies the template and then reports cached, without an install', () => {
  const template = publishedTemplate()
  const bundleInTemplate = linkBundlePath(template)
  assert.ok(existsSync(bundleInTemplate), `the reuse input must be the real install's template: ${bundleInTemplate}`)
  const templateBefore = treeDigest(template)
  assert.equal(existsSync(stampPath(homeB)), false, 'the second home must start without a source stamp')

  const fake = installFakeCorepack({ installs: [INSTALL_FORBIDDEN] })
  fakes.push(fake)

  const copied = doctor(homeB, fake)
  assertOnlyVersionQueries(fake, 1)
  const copiedCheck = checkNamed(copied, 'profile project linked')
  assert.equal(copiedCheck.ok, true, `copying the published template must succeed: ${JSON.stringify(copiedCheck)}`)
  assert.ok(
    copiedCheck.detail.endsWith(' (copied)'),
    `the second home must report the template copy: ${JSON.stringify(copiedCheck.detail)}`,
  )

  assert.ok(existsSync(linkedManifestPath(homeB)), `the copied profile must carry the linked bundle manifest: ${linkedManifestPath(homeB)}`)
  assert.equal(
    readFileSync(stampPath(homeB), 'utf8'),
    readFileSync(stampPath(homeA), 'utf8'),
    'the copied home must stamp the product-source hash the publisher stamped',
  )
  assert.equal(
    readFileSync(linkedManifestPath(homeB), 'utf8'),
    readFileSync(linkedManifestPath(homeA), 'utf8'),
    "the copied linked bundle manifest must be the publisher's installed copy",
  )
  assert.equal(treeDigest(template), templateBefore, 'copying a template is read-only: the published content must not change')

  const cached = doctor(homeB, fake)
  const cachedCheck = checkNamed(cached, 'profile project linked')
  assert.equal(cachedCheck.ok, true, `the copied home must stay valid: ${JSON.stringify(cachedCheck)}`)
  assert.ok(
    cachedCheck.detail.endsWith(' (cached)'),
    `the second decision on the copied home must reuse it: ${JSON.stringify(cachedCheck.detail)}`,
  )
  // The caller's log is cumulative: two doctor runs, two pin queries, still no
  // install. Counting installs only would let a second run install unseen.
  assertOnlyVersionQueries(fake, 2)
  assert.equal(treeDigest(template), templateBefore, 'the cached decision must also leave the template untouched')
})

test('a template missing its linked bundle fails the copy loudly and leaves no stamp', () => {
  const template = publishedTemplate()
  const bundleInTemplate = linkBundlePath(template)
  rmSync(bundleInTemplate)
  assert.equal(existsSync(bundleInTemplate), false, 'this case is defined by the template manifest being gone')
  assert.equal(existsSync(stampPath(homeC)), false, 'the damaged-template home must start without a source stamp')

  const fake = installFakeCorepack({ installs: [INSTALL_FORBIDDEN] })
  fakes.push(fake)

  const report = doctor(homeC, fake)
  assertOnlyVersionQueries(fake, 1)
  const linked = checkNamed(report, 'profile project linked')
  assert.equal(linked.ok, false, `a copy without the linked bundle must fail the profile check: ${JSON.stringify(linked)}`)
  for (const fragment of ['profile template ', ' is missing ', 'delete it and rerun to install a fresh copy']) {
    assert.ok(
      linked.detail.includes(fragment),
      `the existing template-missing error must be reported; ${JSON.stringify(fragment)} is missing from ${JSON.stringify(linked.detail)}`,
    )
  }
  assert.ok(
    linked.detail.includes(linkedManifestPath(homeC)),
    `the failure must name the linked manifest the copy lacked: ${JSON.stringify(linked.detail)}`,
  )
  assert.equal(existsSync(linkedManifestPath(homeC)), false, 'the failed copy must not invent the missing linked manifest')
  assert.equal(existsSync(stampPath(homeC)), false, 'a failed copy must not stamp the home as installed')
})
