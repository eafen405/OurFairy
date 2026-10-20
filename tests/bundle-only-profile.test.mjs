/**
 * Bundle-only profile acceptance for #104.
 *
 * The profile written here declares exactly two dependencies: the product
 * bundle and the test-only baseline probe named by combo.json. The probe is
 * test machinery mounted through `--patch`, not a product package. No product
 * package (`@ourfairy/dsh-identity`, `@ourfairy/dsh-groups`, ...) appears in
 * the profile: every one of them arrives only as the bundle's own `file:`
 * dependencies, installed by real pnpm.
 *
 * The test then boots the pinned dsh CLI directly against that profile — it
 * does not call `scripts/ourfairy-backend.mjs` to install or start anything —
 * and drives one authenticated product HTTP request (sign-in, session create,
 * chat send/read) against a local in-process Messages double. The model
 * endpoint is the only replaced dependency.
 *
 * Beyond the probe report, the installed bundle copy is composed through dsh's
 * own public app-boot reader (`loadOverlayPatches` + `composeEntries`, flattened
 * by the same helper the doctor uses): every product row the bundle's patch
 * contributes must appear as an active row, and every package the bundle
 * manifest declares must be mounted by at least one composed row. A row deleted
 * from the patch therefore fails this acceptance even though the report only
 * lists rows that still exist.
 *
 * The last test proves the same profile fails to boot, naming the package, when
 * the bundle stops declaring one of the packages its own patch mounts.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { flattenEntries, packageOf, readCombo, repoPath } from '../scripts/combo.mjs'
import {
  copyProductRepo, describeRun, httpJson, makeHome, readReport, removeHome, repoRoot,
} from './helpers/backend.mjs'

const { combo } = readCombo(repoRoot)
const { backend } = combo
const dshDir = repoPath(combo, 'dsh')
const dshBin = join(dshDir, 'apps', 'cli', 'lib', 'bin.js')
const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))

const BUNDLE_PACKAGE = backend.bundlePackage
const PROBE_PACKAGE = backend.probePackage
const PROFILE_NAME = backend.profileName
const PNPM_PIN = backend.pnpmPin

const password = 'bundle-only-profile-password'
const successText = 'bundle-only acceptance reply'
const userText = '只声明 bundle 的验收请求'
const roots = []
const homes = []
let model

before(async () => {
  model = await startMockLlmServer({ host: '127.0.0.1', port: 0, apiKey: 'bundle-only-key', sequence: ['success'], successText })
})

after(async () => {
  await model?.close()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  for (const home of homes) removeHome(home)
})

/** A throwaway product copy plus an isolated home, cleaned up after the file. */
function isolatedCopy(label) {
  const root = copyProductRepo(`ourfairy-bundle-only-${label}-`)
  const home = makeHome(`ourfairy-bundle-only-${label}-home-`)
  roots.push(root)
  homes.push(home)
  return { root, home }
}

/** Every harness-written cache and the import anchor stay inside the isolated home. */
function isolatedEnv(home, extra = {}) {
  return {
    ...process.env,
    HOME: join(home, 'user-home'),
    DSH_HOME: join(home, 'dsh-home'),
    OURFAIRY_HOME: home,
    XDG_CACHE_HOME: join(home, 'cache'),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_STATE_HOME: join(home, 'state'),
    npm_config_cache: join(home, 'cache', 'npm'),
    npm_config_store_dir: join(home, 'pnpm-store'),
    PNPM_HOME: join(home, 'pnpm-home'),
    // Shared tool cache, not product state: the launcher uses the same one so
    // repeated installs do not re-extract the corepack archive per test.
    COREPACK_HOME: join(repoRoot, '.corepack'),
    ...extra,
  }
}

/** Write the bundle-only profile project (manifest, pnpm settings, empty user layer). */
function writeBundleOnlyProfile({ root, home }) {
  const profileDir = join(home, 'dsh-home', 'profiles', PROFILE_NAME)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE_NAME}`,
    private: true,
    // Deliberately no product package: only the declaration layer and the
    // probe. A launcher-provided package list has no place to enter here.
    dependencies: {
      [BUNDLE_PACKAGE]: `file:${join(root, 'backend', 'v1-bundle')}`,
      [PROBE_PACKAGE]: `file:${join(root, 'backend', 'probe')}`,
    },
    dsh: { profile: { bundles: [BUNDLE_PACKAGE] } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return profileDir
}

/** Install the written profile with the pinned real pnpm, not through the launcher. */
function installProfile({ home, profileDir }) {
  mkdirSync(join(home, 'user-home'), { recursive: true })
  const run = spawnSync('corepack', [
    `pnpm@${PNPM_PIN}`, 'install', '--ignore-scripts', '--store-dir', join(home, 'pnpm-store'),
  ], {
    cwd: profileDir,
    env: isolatedEnv(home),
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const result = { code: run.status ?? -1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
  assert.equal(result.code, 0, describeRun('corepack pnpm install (bundle-only profile)', result))
}

/**
 * The profile names the bundle and the probe only; the product packages that
 * land under `@ourfairy/` are exactly the bundle manifest's dependency set.
 * That equality is what proves no launcher-provided inventory was involved.
 */
function assertBundleOnlyInstall({ root, profileDir }) {
  const profile = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.deepEqual(
    Object.keys(profile.dependencies).sort(),
    [BUNDLE_PACKAGE, PROBE_PACKAGE].sort(),
    `the profile must name only the bundle and the probe; it named ${JSON.stringify(Object.keys(profile.dependencies))}`,
  )
  assert.deepEqual(profile.dsh.profile.bundles, [BUNDLE_PACKAGE])

  const bundle = JSON.parse(readFileSync(join(root, 'backend', 'v1-bundle', 'package.json'), 'utf8'))
  const declared = Object.keys(bundle.dependencies).sort()
  assert.ok(declared.includes('@ourfairy/dsh-groups'), `the shipped bundle must declare the groups package: ${JSON.stringify(declared)}`)
  const installed = readdirSync(join(profileDir, 'node_modules', '@ourfairy'))
    .map(name => `@ourfairy/${name}`)
    .sort()
  // The bundle is the declaration layer itself and the probe is test
  // machinery; every other installed @ourfairy package is a product package
  // and must be exactly what the bundle's own manifest declares.
  const productDependencies = installed.filter(name => name !== BUNDLE_PACKAGE && name !== PROBE_PACKAGE)
  assert.deepEqual(
    productDependencies,
    declared,
    'the installed product packages must be exactly the bundle manifest dependencies, supplied by the bundle itself',
  )
  assert.deepEqual(
    installed,
    [BUNDLE_PACKAGE, PROBE_PACKAGE, ...declared].sort(),
    'the profile install must also hold the bundle and the probe',
  )
  assert.ok(existsSync(installedPath(profileDir, BUNDLE_PACKAGE, 'cordis.patch.yml')),
    'the installed bundle copy must carry its patch')
  assert.ok(existsSync(probeOverlay(profileDir)), 'the installed probe copy must carry its overlay')
}

/** A path inside one package installed in the profile. */
function installedPath(profileDir, packageName, ...parts) {
  return join(profileDir, 'node_modules', ...packageName.split('/'), ...parts)
}

/** The probe overlay inside the installed probe package. */
function probeOverlay(profileDir) {
  return installedPath(profileDir, PROBE_PACKAGE, 'overlay.patch.yml')
}

/**
 * The rows the installed bundle's own patch composes.
 *
 * Read through dsh's public app-boot reader — the same functions a boot uses —
 * rather than parsing YAML here, and flattened by the helper the doctor's
 * package check uses, so group-nested rows count exactly as the loader mounts
 * them.
 * @param {string} profileDir the profile the bundle was installed into.
 * @returns {{id: string, name: string}[]}
 */
function composedBundleRows(profileDir) {
  const installAnchor = join(dshDir, 'apps', 'cli', 'package.json')
  const boot = createRequire(installAnchor)('@deepseek-ai/dsh-app-boot')
  const patchPath = installedPath(profileDir, BUNDLE_PACKAGE, 'cordis.patch.yml')
  return flattenEntries(boot.composeEntries([boot.loadOverlayPatches('dsh', patchPath)]))
    .filter(row => typeof row.name === 'string')
}

/**
 * The acceptance the probe report alone cannot express: every product row the
 * installed bundle patch contributes is composed and active, and every package
 * the bundle manifest declares is mounted by at least one composed row.
 *
 * Deleting a row from the patch while leaving its package declared passes the
 * report-only assertions (there is no row left to observe) and this assertion
 * is what fails.
 * @param {{profileDir: string, report: any}} context
 */
function assertBundleRowsComposedAndMounted({ profileDir, report }) {
  const manifest = JSON.parse(
    readFileSync(installedPath(profileDir, BUNDLE_PACKAGE, 'package.json'), 'utf8'),
  )
  const declared = Object.keys(manifest.dependencies ?? {}).sort()
  const composed = composedBundleRows(profileDir)
  const productRows = composed.filter(row => row.name.startsWith('@ourfairy/'))
  assert.ok(productRows.length > 0, `the bundle patch composed no product rows: ${JSON.stringify(composed)}`)

  const reported = new Map((report.rows ?? []).map(row => [row.id, row]))
  for (const row of productRows) {
    const id = String(row.id)
    const observed = reported.get(id)
    assert.ok(
      observed !== undefined,
      `bundle product row "${id}" (${row.name}) must appear in the probe report;`
      + ` it reported ${JSON.stringify([...reported.keys()])}`,
    )
    assert.equal(observed.disabled, false,
      `bundle product row "${id}" (${row.name}) must not be disabled`)
    assert.equal(observed.fiberState, 'active',
      `bundle product row "${id}" (${row.name}) must be active`)
  }

  const mounted = new Set(productRows.map(row => packageOf(row.name)))
  for (const name of declared) {
    assert.ok(
      mounted.has(name),
      `the bundle declares ${name} but no composed bundle row mounts it;`
      + ` mounted packages: ${JSON.stringify([...mounted].sort())}`,
    )
  }
}

/** A free loopback port for the product web carrier. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const hasExited = child => child.exitCode !== null || child.signalCode !== null

/** Poll until `predicate` is true; the caller turns a timeout into a diagnostic. */
async function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(intervalMs)
  }
  return predicate()
}

/** Spawn the pinned dsh CLI directly, owning its process group and output. */
function spawnDsh({ root, home, port, reportPath, profileDir }) {
  const child = spawn(process.execPath, [
    dshBin, '--profile', PROFILE_NAME, '--patch', probeOverlay(profileDir),
  ], {
    cwd: root,
    env: isolatedEnv(home, {
      OURFAIRY_PORT: String(port),
      OURFAIRY_PHAETHON_NAME: 'phaethon',
      OURFAIRY_PHAETHON_PASSWORD: password,
      OURFAIRY_PROBE_REPORT: reportPath,
      OURFAIRY_PROBE_MODE: 'hold',
      // Bounded: a hung boot fails the test instead of holding forever.
      OURFAIRY_PROBE_HOLD_MS: String(120_000),
      MINIMAX_CN_API_KEY: 'bundle-only-key',
      OURFAIRY_MINIMAX_BASE_URL: model.baseURL,
    }),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8').on('data', chunk => { output.stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { output.stderr += chunk })
  return { child, output }
}

function describeChild(label, { child, output }) {
  return `${label} (pid ${child.pid}) exited ${child.exitCode ?? child.signalCode}`
    + `\n--- stdout ---\n${output.stdout}\n--- stderr ---\n${output.stderr}`
}

/** Wait for the probe's report to declare ok, failing loudly on an early exit. */
async function awaitProbeReady({ child, output }, reportPath, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let report
    try {
      report = readReport(reportPath)
    } catch {
      report = undefined
    }
    // `ok: true` is the readiness signal; `ok: false` accompanies a non-zero
    // exit, so the exit check below reports the probe's own failures at once.
    if (report?.ok === true) return report
    if (hasExited(child)) {
      throw new Error(`dsh exited before reporting ready; report: ${report === undefined ? 'not written' : JSON.stringify(report)}`
        + `\n${describeChild('dsh (bundle-only profile)', { child, output })}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`the probe did not report ok within ${timeoutMs}ms; report: ${report === undefined ? 'not written' : JSON.stringify(report)}`
        + `\n${describeChild('dsh (bundle-only profile)', { child, output })}`)
    }
    await delay(100)
  }
}

/** Stop the boot with SIGTERM and verify the probe exited without SIGKILL. */
async function stopDsh(child) {
  if (hasExited(child)) return { code: child.exitCode ?? child.signalCode, forced: false }
  try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch { /* already gone */ } }
  let forced = false
  if (!await waitFor(() => hasExited(child), 15_000)) {
    forced = true
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* already gone */ } }
    await waitFor(() => hasExited(child), 5_000)
  }
  return { code: child.exitCode ?? child.signalCode, forced }
}

test('a profile declaring only the bundle installs, boots every product row, and serves an authenticated chat turn', async () => {
  const { root, home } = isolatedCopy('accept')
  const profileDir = writeBundleOnlyProfile({ root, home })
  installProfile({ home, profileDir })
  assertBundleOnlyInstall({ root, profileDir })

  const port = await freePort()
  const reportPath = join(home, 'probe-report.json')
  const boot = spawnDsh({ root, home, port, reportPath, profileDir })
  let stopped
  try {
    const report = await awaitProbeReady(boot, reportPath)

    assert.equal(report.ok, true, `the bundle-only profile must probe cleanly: ${JSON.stringify(report.failures)}`)
    assert.deepEqual(report.failures, [], `probe failures:\n${(report.failures ?? []).join('\n')}`)

    // Every row the bundle mounts as a product row must be live, including the
    // new #99-#101 rows that exist only because the bundle declares them.
    const productRows = (report.rows ?? []).filter(row => String(row.name).startsWith('@ourfairy/'))
    assert.ok(productRows.length > 0, `the boot composed no product rows: ${JSON.stringify(report.rows)}`)
    for (const row of productRows) {
      assert.equal(row.disabled, false, `product row "${row.id}" (${row.name}) must not be disabled`)
      assert.equal(row.fiberState, 'active', `product row "${row.id}" (${row.name}) must be active`)
    }
    // And the installed bundle's own patch must still compose every row and
    // mount every declared package: a deleted row is invisible to the report
    // loop above, so the expectation is derived from the patch the loader reads.
    assertBundleRowsComposedAndMounted({ profileDir, report })

    // Every service the probe checks is live; the probe already turns a failed
    // expected row into a failure, so report.ok covers the row's fiber state.
    assert.ok(Object.keys(report.services ?? {}).length > 0, 'the boot reported no services')
    for (const [name, service] of Object.entries(report.services)) {
      assert.equal(service.live, true, `service "${name}" must be live (expected row "${service.expectedRow}")`)
    }

    // The initial model comes from agentDefaultModel, not a launcher or test
    // environment declaration (#103).
    assert.ok(report.model !== null && report.model !== undefined,
      `the boot report must carry the composed model selection: ${JSON.stringify(report.model)}`)
    assert.equal(report.model.provider, 'minimax-cn')
    assert.equal(report.model.model, 'MiniMax-M3.1-Flash')
    assert.equal(report.model.reasoningEffort, 'max')
    assert.equal(report.model.selection, 'agentDefaultModel.currentSelection()')

    // One authenticated product request path: sign in, create a session, send,
    // then read the projection until the assistant reply has settled.
    const auth = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password } })
    assert.ok(typeof auth.token === 'string' && auth.token !== '', `sign-in returned no token: ${JSON.stringify(auth)}`)
    const created = await httpJson(port, '/sessions/create', { token: auth.token })
    const sessionId = created.session?.id
    assert.ok(typeof sessionId === 'string' && sessionId !== '', `sessions/create returned no session: ${JSON.stringify(created)}`)
    const sent = await httpJson(port, '/chat/send', {
      token: auth.token,
      body: { sessionId, requestId: 'bundle-only-acceptance', text: userText },
    })
    assert.ok(sent.receipt?.messageId !== undefined, `chat/send returned no receipt: ${JSON.stringify(sent)}`)

    const final = await eventually(
      () => httpJson(port, '/chat/read', { token: auth.token, body: { sessionId } }),
      body => body.projection?.replyStatus === 0
        && body.projection.messages.some(message => message.role === 2),
    )
    const reply = final.projection.messages.find(message => message.role === 2)
    assert.equal(reply.text, successText, `the assistant reply must reach the product projection: ${JSON.stringify(final.projection.messages)}`)

    // The model double received the turn: the only replaced dependency is the
    // endpoint, and the request carried the product user text.
    assert.ok(model.requests.length >= 1, 'no model request reached the local double')
    const modelRequest = model.requests.find(record => JSON.stringify(record.body ?? {}).includes(userText))
    assert.ok(modelRequest, `the model double did not receive the product turn: ${JSON.stringify(model.requests.map(record => record.path))}`)
    assert.equal(modelRequest.path, '/v1/messages', `the model request must use the Messages path; got ${modelRequest.path}`)
  } finally {
    stopped = await stopDsh(boot.child)
  }
  assert.equal(stopped.forced, false, `the boot must stop on SIGTERM without SIGKILL: ${JSON.stringify(stopped)}`)
  assert.equal(stopped.code, 0, `the probe must exit cleanly after its hold: ${JSON.stringify(stopped)}`)
})

test('the same profile fails to boot and names a product package the bundle stops declaring', async () => {
  const { root, home } = isolatedCopy('missing')
  const missingPackage = '@ourfairy/dsh-groups'
  const manifestPath = join(root, 'backend', 'v1-bundle', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.ok(Object.hasOwn(manifest.dependencies, missingPackage),
    `the bundle must declare ${missingPackage} so this test can remove it: ${JSON.stringify(manifest.dependencies)}`)
  delete manifest.dependencies[missingPackage]
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  // The row that mounts the removed package stays in the bundle's patch.

  const profileDir = writeBundleOnlyProfile({ root, home })
  installProfile({ home, profileDir })

  const port = await freePort()
  const reportPath = join(home, 'missing-package-report.json')
  const boot = spawnDsh({ root, home, port, reportPath, profileDir })
  const exited = await waitFor(() => hasExited(boot.child), 120_000)
  if (!exited) {
    const stopped = await stopDsh(boot.child)
    assert.fail(`the boot must fail instead of hanging (stop forced=${stopped.forced})`
      + `\n${describeChild('dsh (missing bundle package)', boot)}`)
  }

  assert.equal(boot.child.signalCode, null,
    `the boot must exit by itself, not by a signal`
    + `\n${describeChild('dsh (missing bundle package)', boot)}`)
  assert.notEqual(boot.child.exitCode, 0,
    `the boot must fail when a mounted package is not declared by the bundle`
    + `\n${describeChild('dsh (missing bundle package)', boot)}`)
  assert.ok(boot.output.stderr.includes(missingPackage),
    `the failure must name the undeclared package ${missingPackage}; stderr was:\n${boot.output.stderr}`)
})

/** Poll an async request until `check` accepts its body. */
async function eventually(work, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last
  do {
    last = await work()
    if (check(last)) return last
    await delay(50)
  } while (Date.now() < deadline)
  assert.fail(`condition not reached; last response: ${JSON.stringify(last)}`)
}
