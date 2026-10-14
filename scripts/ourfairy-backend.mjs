#!/usr/bin/env node
/**
 * OurFairy v1 backend launcher.
 *
 * Every command drives the real dsh CLI entry (`apps/cli/lib/bin.js`) with the
 * pinned `ourfairy` profile — no plugin is assembled by hand. The profile and
 * all data live under an isolated OURFAIRY_HOME (default `<worktree>/.ourfairy`);
 * the child runs with DSH_HOME and HOME pinned inside it, so nothing reaches the
 * host's real home.
 *
 * Commands:
 *   probe [--turn] [--report <path>]   boot, run the test-only liveness probe, exit with its result
 *   boot-product [--report <path>]     boot the product profile with NO overlay and report the outcome
 *   start [--hold-ms <n>]              boot detached, wait until the probe reports ready
 *   stop                               signal the whole process group and verify nothing leaked
 *   status                             pid/readiness/port facts of the last start
 *   doctor                             dependency, pin, build, and isolation diagnostics
 *
 * `--allow-drift` (also on `combo.mjs verify`) is an explicit, opt-in escape
 * hatch for investigating a checkout that has moved past its pinned commit. It
 * is never used by `probe`, `boot-product`, `start`, or `doctor`; those fail on
 * drift and say which commit is expected.
 *
 * Missing required configuration is a hard failure naming the variable or path
 * and the command that fixes it.
 */
import { createHash } from 'node:crypto'
import { openSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { readCombo, repoPath, verifyCombination } from './combo.mjs'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The pinned combination, read once from combo.json.
 *
 * Profile name, package names, repo-relative paths, and the pnpm pin all come
 * from the recorded combination: hardcoding them here would make combo.json's
 * pins decorative, so a recorded version could drift from what actually runs
 * without anything failing.
 */
function readCombination() {
  const { combo, path } = readCombo(repoRoot)
  const backend = combo.backend ?? {}
  for (const field of ['profileName', 'bundlePackage', 'probePackage', 'bundlePathInRepo', 'probePathInRepo', 'pnpmPin', 'nodeRange']) {
    if (typeof backend[field] !== 'string' || backend[field] === '') {
      fail(`${path} backend.${field} must be a non-empty string; the launcher reads its pins from combo.json`)
    }
  }
  return backend
}

const COMBINATION = readCombination()
const PROFILE_NAME = COMBINATION.profileName
const BUNDLE_PACKAGE = COMBINATION.bundlePackage
const PROBE_PACKAGE = COMBINATION.probePackage
// The identity module is a product package the bundle mounts by name. combo.json
// records no identity field (and this ticket must not edit that file), so the
// name stays a launcher constant while its sources join the staleness hash below.
const IDENTITY_PACKAGE = '@ourfairy/dsh-identity'
const BUNDLE_DIR = join(repoRoot, COMBINATION.bundlePathInRepo)
const PROBE_DIR = join(repoRoot, COMBINATION.probePathInRepo)
const PNPM = ['corepack', [`pnpm@${COMBINATION.pnpmPin}`]]

/** Files whose content decides whether the linked profile is stale. */
const PRODUCT_SOURCES = [
  join(COMBINATION.bundlePathInRepo, 'package.json'),
  join(COMBINATION.bundlePathInRepo, 'cordis.patch.yml'),
  join(COMBINATION.probePathInRepo, 'package.json'),
  join(COMBINATION.probePathInRepo, 'src', 'index.mjs'),
  join(COMBINATION.probePathInRepo, 'overlay.patch.yml'),
  'backend/identity/package.json',
  'backend/identity/src/codes.mjs',
  'backend/identity/src/store.mjs',
  'backend/identity/src/http.mjs',
  'backend/identity/src/index.mjs',
]

function fail(message, code = 1) {
  process.stderr.write(`ourfairy-backend: ${message}\n`)
  process.exit(code)
}

function parseArgv(argv) {
  const options = { command: undefined, report: undefined, json: false, turn: false, reinstall: false, allowDrift: false, holdMs: 0, home: undefined, stopTimeoutMs: 15000, readyTimeoutMs: 120000 }
  const args = argv.slice(2)
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const value = () => {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('--')) fail(`${arg} requires a value`)
      index += 1
      return next
    }
    switch (arg) {
      case '--report': options.report = resolve(value()); break
      case '--home': options.home = resolve(value()); break
      case '--turn': options.turn = true; break
      case '--json': options.json = true; break
      case '--reinstall': options.reinstall = true; break
      case '--allow-drift': options.allowDrift = true; break
      case '--hold-ms': options.holdMs = Number(value()); break
      case '--stop-timeout-ms': options.stopTimeoutMs = Number(value()); break
      case '--ready-timeout-ms': options.readyTimeoutMs = Number(value()); break
      default:
        if (arg.startsWith('--')) fail(`unknown flag ${arg}`)
        else if (options.command === undefined) options.command = arg
        else fail(`unexpected argument ${arg}`)
    }
  }
  return options
}

/** Resolved isolated layout; every durable path lives under `home`. */
function layoutOf(options) {
  const home = resolve(options.home ?? process.env.OURFAIRY_HOME ?? join(repoRoot, '.ourfairy'))
  return {
    home,
    dshHome: join(home, 'dsh-home'),
    userHome: join(home, 'user-home'),
    runDir: join(home, 'run'),
    logDir: join(home, 'logs'),
    pnpmStore: join(home, 'pnpm-store'),
    profileDir: join(home, 'dsh-home', 'profiles', PROFILE_NAME),
    statePath: join(home, 'run', 'backend.json'),
  }
}

/** Refuse a home that would write into the host's real home tree. */
function assertIsolatedHome(layout) {
  const host = homedir()
  if (layout.home === '/' || layout.home === host || host.startsWith(layout.home + sep)) {
    fail(`refusing OURFAIRY_HOME=${layout.home}: it is the host home (${host}) or an ancestor of it.`
      + ` Backend state must stay isolated; unset OURFAIRY_HOME to use ${join(repoRoot, '.ourfairy')}.`)
  }
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout?.trim()
}

/** Locate the pinned dsh installation, refusing a drifted commit unless allowed. */
function resolveDsh(options) {
  const { combo } = readCombo(repoRoot)
  const dir = repoPath(combo, 'dsh')
  if (!existsSync(join(dir, '.git'))) {
    fail(`dsh checkout missing at ${dir}; set OURFAIRY_DSH_DIR or clone ${combo.repos.dsh.remoteUrl}`)
  }
  const bin = join(dir, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(bin)) {
    fail(`dsh CLI build missing at ${bin}; run '${PNPM[0]} ${PNPM[1].join(' ')} run build:lib:host' in ${dir}`)
  }
  const head = git(['rev-parse', 'HEAD'], dir)
  const locked = combo.repos.dsh.productCommit
  if (head !== locked && !options.allowDrift) {
    fail(`dsh checkout ${dir} is at ${head} but combo.json locks ${locked};`
      + ` run 'git -C ${dir} checkout ${locked}' or pass --allow-drift for a deliberate experiment`)
  }
  return { dir, bin, head, locked, drifted: head !== locked, combo }
}

/** Content hash of the product packages, so a stale linked profile is reinstalled. */
function productSourceHash() {
  const hash = createHash('sha256')
  for (const relativePath of PRODUCT_SOURCES) {
    const path = join(repoRoot, relativePath)
    hash.update(relativePath)
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from('<missing>'))
  }
  return hash.digest('hex')
}

const profileManifest = () => ({
  name: `dsh-profile-${PROFILE_NAME}`,
  private: true,
  dependencies: {
    [BUNDLE_PACKAGE]: `file:${BUNDLE_DIR}`,
    [PROBE_PACKAGE]: `file:${PROBE_DIR}`,
    // Product modules the bundle mounts by package name. A linked package only
    // resolves its dsh peers when it is a profile dependency too.
    [IDENTITY_PACKAGE]: `file:${join(repoRoot, 'backend', 'identity')}`,
  },
  dsh: { profile: { bundles: [BUNDLE_PACKAGE] } },
})

/** Write the isolated profile project (manifest, pnpm settings, empty user layer). */
function writeProfile(layout) {
  mkdirSync(layout.profileDir, { recursive: true })
  writeFileSync(join(layout.profileDir, 'package.json'), `${JSON.stringify(profileManifest(), undefined, 2)}\n`)
  writeFileSync(join(layout.profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  const userLayer = join(layout.profileDir, 'cordis.patch.yml')
  if (!existsSync(userLayer)) {
    writeFileSync(userLayer, '# OurFairy v1 profile user layer. The product composition comes from the bundle;\n# this file exists so a machine-local override has a supported place to live.\n[]\n')
  }
}

/** Link the product packages into the profile, reinstalling when their content moved. */
function installProfile(layout, options) {
  writeProfile(layout)
  const linked = join(layout.profileDir, 'node_modules', BUNDLE_PACKAGE.split('/').join(sep), 'package.json')
  const stampPath = join(layout.profileDir, '.ourfairy-source-hash')
  const hash = productSourceHash()
  const stamped = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : undefined
  if (!options.reinstall && existsSync(linked) && stamped === hash) return 'cached'
  const result = spawnSync(PNPM[0], [...PNPM[1], 'install', '--ignore-scripts', '--store-dir', layout.pnpmStore], {
    cwd: layout.profileDir,
    env: isolatedEnv(layout),
    encoding: 'utf8',
    timeout: 300_000,
  })
  if (result.status !== 0) {
    fail(`profile install failed in ${layout.profileDir} (exit ${result.status}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  if (!existsSync(linked)) {
    fail(`profile install reported success but ${linked} is missing;`
      + ` the product bundle would be silently skipped instead of failing the boot`)
  }
  writeFileSync(stampPath, `${hash}\n`)
  return 'installed'
}

/**
 * Child environment for every process the launcher spawns on the product's
 * behalf (the profile install and the real CLI boot).
 *
 * `HOME` and every tool cache are pinned inside the isolated home: the browser
 * session cookie, `~/.cache/pnpm`, the pnpm store and the durable dsh home must
 * all land under `OURFAIRY_HOME`, otherwise a boot quietly writes to the host's
 * real home and the isolation claim is false.
 */
function isolatedEnv(layout, extra = {}) {
  return {
    ...process.env,
    HOME: layout.userHome,
    DSH_HOME: layout.dshHome,
    OURFAIRY_HOME: layout.home,
    XDG_CACHE_HOME: join(layout.home, 'cache'),
    XDG_CONFIG_HOME: join(layout.home, 'config'),
    XDG_DATA_HOME: join(layout.home, 'data'),
    XDG_STATE_HOME: join(layout.home, 'state'),
    // pnpm's own cache and store ARE product-run state: they hold what this
    // checkout installed, so they stay inside the isolated home.
    npm_config_cache: join(layout.home, 'cache', 'npm'),
    npm_config_store_dir: layout.pnpmStore,
    PNPM_HOME: join(layout.home, 'pnpm-home'),
    // Corepack's cache is a TOOL cache, not product state: it holds downloaded
    // toolchain archives. It is SHARED across isolated homes on purpose —
    // rebuilding it per home re-extracts ~98MB (measured: 0.36s warm vs 2.74s
    // cold, and whole tests went from ~1s to 35-42s). It stays inside the
    // repository rather than the host home, so "never writes the host's real
    // home" still holds; the deliberate tradeoff is recorded in
    // work/implementation/evidence/01-baseline/README.md.
    COREPACK_HOME: join(repoRoot, '.corepack'),
    ...extra,
  }
}

/**
 * The model selection this combination runs, read from combo.json's backend
 * block. Missing or malformed values are a hard failure: the probe refuses to
 * fall back to an implicit default, because no entry layer would supply one.
 */
function agentModelOf() {
  const { combo, path } = readCombo(repoRoot)
  const selection = combo.backend?.agentModel
  if (selection === undefined || typeof selection.provider !== 'string' || typeof selection.model !== 'string'
    || selection.provider === '' || selection.model === '') {
    fail(`${path} backend.agentModel must declare non-empty provider and model strings;`
      + ' the probe refuses to run a turn without an explicit selection')
  }
  return selection
}

/** Whether the bundle declares the same model pair the launcher passes. */
function bundleDeclaresAgentModel(selection) {
  const patch = readFileSync(join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml'), 'utf8')
  return patch.includes(`provider: ${selection.provider}`) && patch.includes(`model: ${selection.model}`)
}

function childEnv(layout, { reportPath, mode, holdMs }) {
  const selection = agentModelOf()
  const env = isolatedEnv(layout, {
    OURFAIRY_PROBE_REPORT: reportPath,
    OURFAIRY_PROBE_MODE: mode,
    OURFAIRY_PROBE_PROVIDER: selection.provider,
    OURFAIRY_PROBE_MODEL: selection.model,
  })
  if (holdMs !== undefined) env.OURFAIRY_PROBE_HOLD_MS = String(holdMs)
  return env
}

function overlayPath() {
  const path = join(PROBE_DIR, 'overlay.patch.yml')
  if (!existsSync(path)) fail(`probe overlay missing at ${path}`)
  return path
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Attach launcher-side facts to the probe report so one file carries the evidence. */
function augmentReport(reportPath, facts) {
  const report = readJson(reportPath)
  if (report === undefined) return
  report.launcher = facts
  try {
    writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  } catch {
    // A read-only report path must not turn a successful probe into a failure.
  }
}

/** Boot the real CLI with the probe overlay and return its exit code. */
function commandProbe(layout, options) {
  assertIsolatedHome(layout)
  const dsh = resolveDsh(options)
  const installMode = installProfile(layout, options)
  const reportPath = options.report ?? join(layout.runDir, 'probe-report.json')
  rmSync(reportPath, { force: true })
  const mode = options.turn ? 'turn' : 'boot'
  const result = spawnSync(process.execPath, [dsh.bin, '--profile', PROFILE_NAME, '--patch', overlayPath()], {
    cwd: repoRoot,
    env: childEnv(layout, { reportPath, mode }),
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  augmentReport(reportPath, {
    command: mode === 'turn' ? 'probe --turn' : 'probe',
    dshBin: dsh.bin,
    dshHead: dsh.head,
    dshLocked: dsh.locked,
    dshDrifted: dsh.drifted,
    profileDir: layout.profileDir,
    installMode,
    isolatedHome: layout.home,
    reportPath,
  })
  if (result.error !== undefined) fail(`failed to launch ${dsh.bin}: ${result.error.message}`)
  return result.status ?? 1
}

/**
 * Boot the **product** profile with no test overlay at all and report the
 * outcome.
 *
 * Every other boot passes `--patch backend/probe/overlay.patch.yml`, so without
 * this path the product composition alone is never exercised: a broken product
 * profile could hide behind an overlay that happens to fix it up.
 *
 * Readiness is observed from the product itself, not from a clean exit. The
 * profile mounts its own web carrier, so it stays up and never exits; waiting
 * for one would report a healthy backend as a timeout, and a bare timeout would
 * report a hung boot as healthy. What is recorded instead is the observable
 * fact that the composition came up and is serving: the process is alive and
 * has a listening port. The boot is then stopped and the port's release is
 * checked, so the command leaves nothing running behind it.
 */
async function commandBootProduct(layout, options) {
  assertIsolatedHome(layout)
  const dsh = resolveDsh(options)
  const installMode = installProfile(layout, options)
  const reportPath = options.report ?? join(layout.runDir, 'product-boot-report.json')
  rmSync(reportPath, { force: true })
  mkdirSync(layout.logDir, { recursive: true })
  mkdirSync(layout.runDir, { recursive: true })
  const logFile = join(layout.logDir, `product-boot-${new Date().toISOString().replaceAll(':', '-')}.log`)
  const fd = openSync(logFile, 'a')
  // No --patch: this boot is the product composition exactly as it ships.
  const child = spawn(process.execPath, [dsh.bin, '--profile', PROFILE_NAME], {
    cwd: repoRoot,
    env: childEnv(layout, { reportPath, mode: 'product' }),
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  child.unref()

  const ready = await waitFor(() => listeningPorts(child.pid).length > 0, options.readyTimeoutMs)
  const listening = ready ? listeningPorts(child.pid) : []

  // Stop the boot we started, whether or not it came up, so a failure cannot
  // leave a half-started backend holding the port for the next test. The
  // predicate must stay synchronous: `waitFor` treats it as a boolean, so an
  // async one would hand it a Promise — always truthy — and it would report the
  // boot gone on the first tick instead of waiting for it.
  const gone = () => !isAlive(child.pid)
  try { process.kill(-child.pid, 'SIGTERM') } catch { try { process.kill(child.pid, 'SIGTERM') } catch { /* already gone */ } }
  if (!await waitFor(gone, 10_000)) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } }
    await waitFor(gone, 10_000)
  }
  const ended = gone()
  const portsAfter = ended ? [] : listeningPorts(child.pid)

  const exitCode = ready && ended ? 0 : 1
  const report = {
    ok: exitCode === 0,
    command: 'boot-product (no --patch overlay)',
    exitCode,
    profileDir: layout.profileDir,
    isolatedHome: layout.home,
    overlaysApplied: [],
    // The liveness fact this command records: the product composition came up
    // and served, and left nothing behind.
    listeningPorts: listening,
    portsAfter,
    processExited: ended,
    dshBin: dsh.bin,
    dshHead: dsh.head,
    dshLocked: dsh.locked,
    dshDrifted: dsh.drifted,
    installMode,
    logFile,
    stderr: tail(logFile),
  }
  writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  process.stdout.write(`${JSON.stringify({
    command: report.command,
    ok: report.ok,
    listeningPorts: listening,
    portsAfter,
    logFile,
  })}\n`)
  if (exitCode !== 0) {
    process.stderr.write(`ourfairy-backend: the product profile alone failed to come up serving`
      + ` (ready=${ready}, exited=${ended}); see ${reportPath}\nlog ${logFile}:\n${tail(logFile)}\n`)
  }
  return exitCode
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    return error.code === 'EPERM'
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    if (stat.split(' ')[2] === 'Z') return false
  } catch {
    // No /proc entry on this platform; the signal probe above stands.
  }
  return true
}

/** TCP ports the process currently listens on, via its socket inodes. */
function listeningPorts(pid) {
  const inodes = new Set()
  const fdDir = `/proc/${pid}/fd`
  if (!existsSync(fdDir)) return []
  for (const name of readdirSync(fdDir)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(join(fdDir, name)))
      if (match !== null) inodes.add(match[1])
    } catch {
      // A descriptor that vanished between readdir and readlink.
    }
  }
  if (inodes.size === 0) return []
  const ports = new Set()
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(table)) continue
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/)
      if (fields.length < 10 || fields[3] !== '0A') continue
      if (inodes.has(fields[9])) ports.add(Number.parseInt(fields[1].split(':')[1], 16))
    }
  }
  return [...ports].sort((left, right) => left - right)
}

/** Processes still running with this isolated home in their environment. */
function leakScan(layout) {
  const survivors = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === process.pid) continue
    let environ = ''
    try {
      environ = readFileSync(`/proc/${pid}/environ`, 'utf8')
    } catch {
      continue
    }
    if (!environ.split('\0').includes(`DSH_HOME=${layout.dshHome}`)) continue
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim()
    } catch {
      // Environment matched but the command line is gone; the pid is still a leak.
    }
    survivors.push({ pid, cmdline })
  }
  return survivors
}

function waitFor(predicate, timeoutMs, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolvePromise) => {
    const tick = () => {
      if (predicate()) resolvePromise(true)
      else if (Date.now() > deadline) resolvePromise(false)
      else setTimeout(tick, intervalMs)
    }
    tick()
  })
}

function readState(layout) {
  return readJson(layout.statePath)
}

function writeState(layout, state) {
  mkdirSync(layout.runDir, { recursive: true })
  writeFileSync(layout.statePath, `${JSON.stringify(state, undefined, 2)}\n`)
}

function tail(path, lines = 20) {
  if (!existsSync(path)) return '(no log)'
  return readFileSync(path, 'utf8').split('\n').slice(-lines).join('\n')
}

async function commandStart(layout, options) {
  assertIsolatedHome(layout)
  const dsh = resolveDsh(options)
  const installMode = installProfile(layout, options)
  const existing = readState(layout)
  if (existing !== undefined && isAlive(existing.pid)) {
    fail(`backend already running with pid ${existing.pid} (started ${existing.startedAt}); run 'stop' first`)
  }
  mkdirSync(layout.logDir, { recursive: true })
  mkdirSync(layout.runDir, { recursive: true })
  const reportPath = join(layout.runDir, 'start-report.json')
  rmSync(reportPath, { force: true })
  const logFile = join(layout.logDir, `backend-${new Date().toISOString().replaceAll(':', '-')}.log`)
  const fd = openSync(logFile, 'a')
  const child = spawn(process.execPath, [dsh.bin, '--profile', PROFILE_NAME, '--patch', overlayPath()], {
    cwd: repoRoot,
    env: childEnv(layout, { reportPath, mode: 'hold', holdMs: options.holdMs }),
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  child.unref()
  writeState(layout, {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    logFile,
    reportPath,
    isolatedHome: layout.home,
    dshHome: layout.dshHome,
    dshHead: dsh.head,
    dshLocked: dsh.locked,
    installMode,
    ports: [],
    ready: false,
  })

  const ready = await waitFor(() => readJson(reportPath)?.ok === true, options.readyTimeoutMs)
  if (!ready) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } }
    const report = readJson(reportPath)
    rmSync(layout.statePath, { force: true })
    fail(`backend (pid ${child.pid}) did not report ready within ${options.readyTimeoutMs}ms;`
      + ` probe report: ${report === undefined ? 'not written' : JSON.stringify(report.failures ?? report)}`
      + `\nlog ${logFile}:\n${tail(logFile)}`)
  }
  const ports = listeningPorts(child.pid)
  const state = { ...readState(layout), ready: true, readyAt: new Date().toISOString(), ports }
  writeState(layout, state)
  const summary = {
    pid: state.pid,
    ready: true,
    isolatedHome: layout.home,
    dshHome: layout.dshHome,
    dshHead: dsh.head,
    installMode,
    listeningPorts: ports,
    logFile,
  }
  process.stdout.write(options.json ? `${JSON.stringify(summary, undefined, 2)}\n` : `ourfairy-backend: started\n${JSON.stringify(summary, undefined, 2)}\n`)
  return 0
}

async function commandStop(layout, options) {
  const state = readState(layout)
  if (state === undefined) {
    process.stdout.write('ourfairy-backend: no recorded backend (nothing to stop)\n')
    return 0
  }
  if (!isAlive(state.pid)) {
    const survivors = leakScan(layout)
    rmSync(layout.statePath, { force: true })
    process.stdout.write(`ourfairy-backend: pid ${state.pid} already exited; leaked processes: ${survivors.length}\n`)
    return survivors.length === 0 ? 0 : 1
  }
  const portsBefore = listeningPorts(state.pid)
  let forced = false
  try {
    process.kill(-state.pid, 'SIGTERM')
  } catch {
    try { process.kill(state.pid, 'SIGTERM') } catch { /* exited between the checks */ }
  }
  if (!(await waitFor(() => !isAlive(state.pid), options.stopTimeoutMs))) {
    forced = true
    try { process.kill(-state.pid, 'SIGKILL') } catch { try { process.kill(state.pid, 'SIGKILL') } catch { /* already gone */ } }
    await waitFor(() => !isAlive(state.pid), 5000)
  }
  const survivors = leakScan(layout)
  const portsAfter = survivors.flatMap(survivor => listeningPorts(survivor.pid))
  rmSync(layout.statePath, { force: true })
  const summary = {
    pid: state.pid,
    exited: !isAlive(state.pid),
    forced,
    portsBefore,
    portsAfter,
    leakedProcesses: survivors,
    isolatedHome: layout.home,
  }
  process.stdout.write(options.json ? `${JSON.stringify(summary, undefined, 2)}\n` : `ourfairy-backend: stopped\n${JSON.stringify(summary, undefined, 2)}\n`)
  return summary.exited && survivors.length === 0 && portsAfter.length === 0 ? 0 : 1
}

function commandStatus(layout, options) {
  const state = readState(layout)
  if (state === undefined) {
    // Status is a machine-facing command: it reports the same shape whether or
    // not a backend was ever started, so a caller never has to parse prose to
    // learn that nothing is running.
    const idle = { running: false, ready: false, isolatedHome: layout.home }
    process.stdout.write(options.json
      ? `${JSON.stringify(idle, undefined, 2)}\n`
      : `ourfairy-backend: not running\n${JSON.stringify(idle, undefined, 2)}\n`)
    return 0
  }
  const alive = isAlive(state.pid)
  const report = readJson(state.reportPath)
  const summary = {
    running: alive,
    pid: state.pid,
    startedAt: state.startedAt,
    ready: state.ready === true,
    isolatedHome: state.isolatedHome,
    dshHome: state.dshHome,
    listeningPorts: alive ? listeningPorts(state.pid) : [],
    logFile: state.logFile,
    probe: report === undefined ? null : { ok: report.ok, failures: report.failures, mode: report.mode },
  }
  process.stdout.write(`${JSON.stringify(summary, undefined, 2)}\n`)
  return 0
}

/**
 * Whether a Node version satisfies the combination's declared range. Supports
 * the forms combo.json uses (`^N.M.P` and `>=N`); an unrecognized form throws
 * rather than passing silently, so a changed range cannot quietly disable the
 * check.
 */
function nodeSatisfies(range, version) {
  const [major, minor] = version.split('.').map(Number)
  for (const alternative of range.split('||').map(part => part.trim())) {
    const caret = /^\^(\d+)\.(\d+)\.\d+$/.exec(alternative)
    if (caret !== null) {
      if (major === Number(caret[1]) && minor >= Number(caret[2])) return true
      continue
    }
    const atLeast = /^>=(\d+)$/.exec(alternative)
    if (atLeast !== null) {
      if (major >= Number(atLeast[1])) return true
      continue
    }
    throw new Error(`unsupported alternative ${JSON.stringify(alternative)} in combo.json backend.nodeRange`)
  }
  return false
}

function commandDoctor(layout, options) {
  assertIsolatedHome(layout)
  const checks = []
  const check = (name, run) => {
    try {
      const detail = run()
      checks.push({ name, ok: true, detail: detail ?? 'ok' })
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }
  const must = (condition, message) => {
    if (!condition) throw new Error(message)
  }

  check('node version', () => {
    must(nodeSatisfies(COMBINATION.nodeRange, process.versions.node),
      `node ${process.versions.node} does not satisfy ${COMBINATION.nodeRange} (combo.json backend.nodeRange)`)
    return `${process.versions.node} satisfies ${COMBINATION.nodeRange}`
  })
  check('corepack pnpm pin available', () => {
    // Must run under the same environment the profile install uses: with the
    // ambient environment this check would read the host's corepack cache and
    // silently disagree with what `installProfile` actually does.
    const result = spawnSync(PNPM[0], [...PNPM[1], '--version'], { encoding: 'utf8', env: isolatedEnv(layout) })
    must(result.status === 0, `${PNPM[0]} ${PNPM[1].join(' ')} failed: ${result.stderr || result.error?.message}`)
    return `${result.stdout.trim()} (COREPACK_HOME=${join(repoRoot, '.corepack')})`
  })
  check('combo combination', () => {
    const result = verifyCombination({ allowDrift: options.allowDrift })
    must(result.failures.length === 0, result.failures.join('; '))
    return result.rows.map(row => `${row.key}@${String(row.actual).slice(0, 12)}`).join(', ')
  })
  check('dsh CLI build', () => {
    const dsh = resolveDsh(options)
    return `${dsh.bin} (${dsh.head.slice(0, 12)})`
  })
  check('product packages', () => {
    for (const relativePath of PRODUCT_SOURCES) {
      must(existsSync(join(repoRoot, relativePath)), `missing ${relativePath}`)
    }
    return PRODUCT_SOURCES.join(', ')
  })
  check('isolated home', () => {
    must(layout.home !== '/' && layout.home !== homedir(), 'OURFAIRY_HOME points at the host home')
    return layout.home
  })
  check('profile project linked', () => {
    const mode = installProfile(layout, options)
    return `${layout.profileDir} (${mode})`
  })
  check('model double', () => {
    const base = process.env.DEEPSEEK_BASE_URL
    if (base === undefined || base === '') return 'not configured (keyless startup only)'
    return `DEEPSEEK_BASE_URL=${base}`
  })

  const failed = checks.filter(entry => !entry.ok)
  const lines = checks.map(entry => `${entry.ok ? 'ok  ' : 'FAIL'}  ${entry.name}: ${entry.detail}`)
  process.stdout.write(options.json
    ? `${JSON.stringify({ ok: failed.length === 0, checks }, undefined, 2)}\n`
    : `ourfairy-backend doctor\n${lines.join('\n')}\n${failed.length === 0 ? 'doctor: all checks passed' : `doctor: ${failed.length} check(s) failed`}\n`)
  return failed.length === 0 ? 0 : 1
}

const options = parseArgv(process.argv)
const layout = layoutOf(options)
if (process.argv[2] === '--help' || options.command === 'help' || options.command === undefined) {
  process.stdout.write('usage: ourfairy-backend <probe|boot-product|start|stop|status|doctor> [--turn] [--report <path>] [--home <dir>] [--json] [--reinstall] [--allow-drift]\n')
  process.exit(options.command === undefined ? 2 : 0)
}

const exitCode = await (async () => {
  switch (options.command) {
    case 'probe': return commandProbe(layout, options)
    case 'boot-product': return commandBootProduct(layout, options)
    case 'start': return await commandStart(layout, options)
    case 'stop': return await commandStop(layout, options)
    case 'status': return commandStatus(layout, options)
    case 'doctor': return commandDoctor(layout, options)
    default: fail(`unknown command ${JSON.stringify(options.command)}; expected probe|boot-product|start|stop|status|doctor`)
  }
})()
process.exit(exitCode)
