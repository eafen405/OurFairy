#!/usr/bin/env node
/**
 * OurFairy v1 backend launcher.
 *
 * This is the process layer: argv parsing, the dsh checkout, subprocesses,
 * command implementations, and dispatch. Everything that can be decided by
 * reading the checkout — the recorded combination, the isolated layout, the
 * product package inventory, the profile and its staleness decision, the boot
 * overlays — lives in the sibling `ourfairy-composition.mjs`.
 *
 * Every command drives the real dsh CLI entry (`apps/cli/lib/bin.js`) with the
 * pinned `ourfairy` profile — no plugin is assembled by hand. The profile and
 * all data live under an isolated OURFAIRY_HOME (default `<worktree>/.ourfairy`);
 * the child runs with DSH_HOME and HOME pinned inside it, so nothing reaches the
 * host's real home.
 *
 * Commands:
 *   probe [--turn] [--report <path>] [--patch <path>]   boot, run the test-only liveness probe, exit with its result
 *   boot-product [--report <path>]     boot the product profile with NO overlay and report the outcome
 *   start [--hold-ms <n>] [--patch <path>]   boot detached, wait until the probe reports ready
 *   stop                               signal the whole process group and verify nothing leaked
 *   status                             pid/readiness/port facts of the last start
 *   doctor                             dependency, pin, build, and isolation diagnostics
 *
 * `--patch <path>` (repeatable) mounts one extra overlay above the profile, in
 * argv order — the supported way for a test to add a row without writing the
 * profile's own `cordis.patch.yml`, which is the launcher's private layout. It
 * is accepted by `probe` and `start`; `boot-product` exists to boot the product
 * with no overlay at all, so it refuses one.
 *
 * `--allow-drift` (also on `combo.mjs verify`) is an explicit, opt-in escape
 * hatch for investigating a checkout that has moved past its pinned commit. It
 * is never used by `probe`, `boot-product`, `start`, or `doctor`; those fail on
 * drift and say which commit is expected.
 *
 * Missing required configuration is a hard failure naming the variable or path
 * and the command that fixes it.
 *
 * Importing this module runs nothing: `main(argv)` returns the exit code and the
 * `import.meta.main` guard at the bottom is the only place it is called, so a
 * test can import the launcher without parsing argv, reading combo.json,
 * printing, or exiting.
 */
import { openSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { repoPath, verifyBundlePackages, verifyCombination, verifyInstalledNativeCapabilities, verifyPluginCompatibility } from './combo.mjs'
import {
  assertIsolatedHome,
  bootPatches,
  installDecision,
  isolatedEnv,
  layoutOf as compositionLayoutOf,
  PROFILE_IMPORT_METHOD,
  productSources,
  profileLinkedManifestPath,
  readCombination,
  readCombo,
  writeProfile,
  writeSourceStamp,
} from './ourfairy-composition.mjs'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The pinned pnpm invocation the combination records. */
function pnpmInvocation(combination) {
  return ['corepack', [`pnpm@${combination.pnpmPin}`]]
}

/**
 * Raise one launcher failure.
 *
 * Internal failures throw instead of exiting: `doctor` wraps each check in
 * `try/catch` and records what it caught, so a check that exits the process
 * could never appear in its report. The CLI boundary in `main` turns a throw
 * into the launcher's stderr prefix and non-zero exit.
 */
function fail(message) {
  throw new Error(message)
}

/** The CLI boundary: one failure message with the launcher prefix, then the exit code. */
function cliFailure(error) {
  process.stderr.write(`ourfairy-backend: ${error instanceof Error ? error.message : String(error)}\n`)
  return 1
}

function parseArgv(argv) {
  const options = { command: undefined, report: undefined, json: false, turn: false, reinstall: false, allowDrift: false, holdMs: 0, home: undefined, stopTimeoutMs: 15000, readyTimeoutMs: 120000, patches: [] }
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
      case '--patch': options.patches.push(resolve(value())); break
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

/** The isolated layout for one invocation: the composition's shape, this run's home. */
function layoutOf(options) {
  return compositionLayoutOf(options.home ?? process.env.OURFAIRY_HOME, repoRoot)
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout?.trim()
}

/** Locate the pinned dsh installation, refusing a drifted commit unless allowed. */
function resolveDsh(options, combination) {
  const { combo } = readCombo(repoRoot)
  const dir = repoPath(combo, 'dsh')
  if (!existsSync(join(dir, '.git'))) {
    fail(`dsh checkout missing at ${dir}; set OURFAIRY_DSH_DIR or clone ${combo.repos.dsh.remoteUrl}`)
  }
  const bin = join(dir, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(bin)) {
    const [command, args] = pnpmInvocation(combination)
    fail(`dsh CLI build missing at ${bin}; run '${command} ${args.join(' ')} run build:lib:host' in ${dir}`)
  }
  const head = git(['rev-parse', 'HEAD'], dir)
  const locked = combo.repos.dsh.productCommit
  if (head !== locked && !options.allowDrift) {
    fail(`dsh checkout ${dir} is at ${head} but combo.json locks ${locked};`
      + ` run 'git -C ${dir} checkout ${locked}' or pass --allow-drift for a deliberate experiment`)
  }
  return { dir, bin, head, locked, drifted: head !== locked, combo }
}

/**
 * Link the product packages into the profile, reinstalling when their content
 * moved.
 *
 * The composition decides (`cached` / `install`); executing pnpm and recording
 * the hash the install was built from are the process layer's half.
 */
function installProfile(layout, options, combination) {
  writeProfile(layout, repoRoot)
  const decision = installDecision(layout, { root: repoRoot, reinstall: options.reinstall })
  if (decision.mode === 'cached') return 'cached'
  const linked = profileLinkedManifestPath(layout, repoRoot)
  const [command, args] = pnpmInvocation(combination)
  // pnpm's hoisted linker can keep old file: contents on install, even with --force.
  // Rebuild invalidated snapshots while retaining the lockfile and download store.
  rmSync(join(layout.profileDir, 'node_modules'), { recursive: true, force: true })
  const result = spawnSync(command, [...args, 'install', '--ignore-scripts',
    '--package-import-method', PROFILE_IMPORT_METHOD, '--store-dir', layout.pnpmStore], {
    cwd: layout.profileDir,
    env: isolatedEnv(layout, { root: repoRoot }),
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
  writeSourceStamp(layout, decision.hash)
  return 'installed'
}

function childEnv(layout, { reportPath, mode, holdMs }) {
  const env = isolatedEnv(layout, {
    root: repoRoot,
    extra: {
      OURFAIRY_PROBE_REPORT: reportPath,
      OURFAIRY_PROBE_MODE: mode,
    },
  })
  if (holdMs !== undefined) env.OURFAIRY_PROBE_HOLD_MS = String(holdMs)
  return env
}

/** {@link bootPatches} in the dsh CLI's repeatable `--patch <path>` form. */
function patchArgs(options) {
  return bootPatches(options, repoRoot).flatMap(path => ['--patch', path])
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
function commandProbe(layout, options, combination) {
  assertIsolatedHome(layout, repoRoot)
  const dsh = resolveDsh(options, combination)
  const installMode = installProfile(layout, options, combination)
  const reportPath = options.report ?? join(layout.runDir, 'probe-report.json')
  rmSync(reportPath, { force: true })
  const mode = options.turn ? 'turn' : 'boot'
  const result = spawnSync(process.execPath, [dsh.bin, '--profile', combination.profileName, ...patchArgs(options)], {
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
    overlaysApplied: bootPatches(options, repoRoot),
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
async function commandBootProduct(layout, options, combination) {
  assertIsolatedHome(layout, repoRoot)
  const dsh = resolveDsh(options, combination)
  const installMode = installProfile(layout, options, combination)
  const reportPath = options.report ?? join(layout.runDir, 'product-boot-report.json')
  rmSync(reportPath, { force: true })
  mkdirSync(layout.logDir, { recursive: true })
  mkdirSync(layout.runDir, { recursive: true })
  const logFile = join(layout.logDir, `product-boot-${new Date().toISOString().replaceAll(':', '-')}.log`)
  const fd = openSync(logFile, 'a')
  // No --patch: this boot is the product composition exactly as it ships.
  const child = spawn(process.execPath, [dsh.bin, '--profile', combination.profileName], {
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

async function commandStart(layout, options, combination) {
  assertIsolatedHome(layout, repoRoot)
  const dsh = resolveDsh(options, combination)
  const installMode = installProfile(layout, options, combination)
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
  const child = spawn(process.execPath, [dsh.bin, '--profile', combination.profileName, ...patchArgs(options)], {
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
    overlaysApplied: bootPatches(options, repoRoot),
    ports: [],
    ready: false,
  })

  await waitFor(() => readJson(reportPath)?.ok !== undefined || !isAlive(child.pid), options.readyTimeoutMs)
  const report = readJson(reportPath)
  const ready = report?.ok === true && isAlive(child.pid)
  if (!ready) {
    const reason = report?.ok === false
      ? 'reported a failed readiness check'
      : !isAlive(child.pid)
        ? 'exited before reporting ready'
        : `did not report ready within ${options.readyTimeoutMs}ms`
    try { process.kill(-child.pid, 'SIGKILL') } catch { try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ } }
    rmSync(layout.statePath, { force: true })
    fail(`backend (pid ${child.pid}) ${reason};`
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
    overlaysApplied: bootPatches(options, repoRoot),
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

function commandDoctor(layout, options, combination) {
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
  const report = () => {
    const failed = checks.filter(entry => !entry.ok)
    const lines = checks.map(entry => `${entry.ok ? 'ok  ' : 'FAIL'}  ${entry.name}: ${entry.detail}`)
    process.stdout.write(options.json
      ? `${JSON.stringify({ ok: failed.length === 0, checks }, undefined, 2)}\n`
      : `ourfairy-backend doctor\n${lines.join('\n')}\n${failed.length === 0 ? 'doctor: all checks passed' : `doctor: ${failed.length} check(s) failed`}\n`)
    return failed.length === 0 ? 0 : 1
  }

  // Isolation is the first recorded check, and a failure stops the report
  // there: every later check may write (corepack's cache, the profile install),
  // so recording it and returning is what keeps an unsafe home from being
  // touched while still producing a normal report.
  check('isolated home', () => {
    assertIsolatedHome(layout, repoRoot)
    return layout.home
  })
  if (!checks[0].ok) return report()

  check('node version', () => {
    const { nodeRange } = readCombination(repoRoot)
    must(nodeSatisfies(nodeRange, process.versions.node),
      `node ${process.versions.node} does not satisfy ${nodeRange} (combo.json backend.nodeRange)`)
    return `${process.versions.node} satisfies ${nodeRange}`
  })
  check('corepack pnpm pin available', () => {
    // Must run under the same environment the profile install uses: with the
    // ambient environment this check would read the host's corepack cache and
    // silently disagree with what `installProfile` actually does.
    const [command, args] = pnpmInvocation(combination)
    const result = spawnSync(command, [...args, '--version'], { encoding: 'utf8', env: isolatedEnv(layout, { root: repoRoot }) })
    must(result.status === 0, `${command} ${args.join(' ')} failed: ${result.stderr || result.error?.message}`)
    return `${result.stdout.trim()} (COREPACK_HOME=${join(repoRoot, '.corepack')})`
  })
  check('combo combination', () => {
    const result = verifyCombination({ allowDrift: options.allowDrift })
    must(result.failures.length === 0, result.failures.join('; '))
    return result.rows.map(row => `${row.key}@${String(row.actual).slice(0, 12)}`).join(', ')
  })
  check('dsh CLI build', () => {
    const dsh = resolveDsh(options, combination)
    return `${dsh.bin} (${dsh.head.slice(0, 12)})`
  })
  check('product packages', () => {
    // Nothing is verified by hand here: the set comes from the same `files`
    // declarations the profile install copies, read from the packages the
    // bundle declares, so a package added to the install without a
    // published-file list fails while deriving it.
    return productSources(repoRoot).join(', ')
  })
  check('profile project linked', () => {
    const mode = installProfile(layout, options, combination)
    return `${layout.profileDir} (${mode})`
  })
  check('bundle packages', () => {
    // The bundle manifest is the product package inventory. This compares it
    // with the rows the bundle's patch mounts and the packages the generated
    // profile installed, reading the rows through dsh's own patch loader.
    const result = verifyBundlePackages({
      binName: 'dsh',
      bundlePackage: combination.bundlePackage,
      // The probe is the one installed product package the bundle never
      // mounts; naming it keeps the installed-set comparison from reporting it.
      probePackage: combination.probePackage,
      // dsh resolves a bundle against its own installation first, then the
      // profile; the app's package.json is the installation anchor both sides
      // name.
      installAnchor: join(resolveDsh(options, combination).dir, 'apps', 'cli', 'package.json'),
      profileDir: layout.profileDir,
    })
    must(result.failures.length === 0, result.failures.join('; '))
    return `${result.declared.length} declared package(s) mounted by ${result.mounted.length} row(s): `
      + result.mounted.map(row => `${row.id}:${row.name}`).join(', ')
  })
  check('plugin compatibility', () => {
    // The same installed copies the boot loads, judged by dsh's own public
    // compatibility function against the version this pinned CLI publishes —
    // no range comparison lives here. The detail names the version judged
    // against, so a green result says what it was green against.
    const result = verifyPluginCompatibility({
      binName: 'dsh',
      bundlePackage: combination.bundlePackage,
      installAnchor: join(resolveDsh(options, combination).dir, 'apps', 'cli', 'package.json'),
      profileDir: layout.profileDir,
    })
    must(result.failures.length === 0, result.failures.join('; '))
    return `${result.checked.length} installed product package(s) compatible with dsh ${result.dshVersion}: `
      + result.checked.join(', ')
  })
  check('native capabilities', () => {
    // The installed profile, read through dsh's own loader: what a boot would
    // mount, not a second parse of the bundle this launcher also reads.
    const dsh = resolveDsh(options, combination)
    const result = verifyInstalledNativeCapabilities({
      binName: 'dsh',
      bundlePackage: combination.bundlePackage,
      installAnchor: join(dsh.dir, 'apps', 'cli', 'package.json'),
      profileDir: layout.profileDir,
    })
    must(result.failures.length === 0, result.failures.join('; '))
    return result.checked.join(', ')
  })
  check('model double', () => {
    const base = process.env.OURFAIRY_MINIMAX_BASE_URL ?? process.env.DEEPSEEK_BASE_URL
    if (base === undefined || base === '') return 'not configured (keyless startup only)'
    return process.env.OURFAIRY_MINIMAX_BASE_URL === undefined
      ? `DEEPSEEK_BASE_URL=${base}` : `OURFAIRY_MINIMAX_BASE_URL=${base}`
  })

  return report()
}

/**
 * Run one launcher invocation and return its exit code.
 *
 * This is the only entry point; it owns argv, the CLI boundary, and dispatch.
 * It never calls `process.exit`, so an importing test process keeps its exit
 * code to itself.
 * @param {string[]} argv - the full process argv (`[node, script, ...args]`).
 * @returns {Promise<number>}
 */
export async function main(argv) {
  try {
    // The pins are read before argv, as the launcher always did: a broken
    // combination is a configuration failure, not a usage error.
    const combination = readCombination(repoRoot)
    const options = parseArgv(argv)
    const layout = layoutOf(options)
    if (argv[2] === '--help' || options.command === 'help' || options.command === undefined) {
      process.stdout.write('usage: ourfairy-backend <probe|boot-product|start|stop|status|doctor> [--turn] [--report <path>] [--home <dir>] [--json] [--reinstall] [--allow-drift] [--patch <path>]...\n')
      return options.command === undefined ? 2 : 0
    }
    // Only the overlay boots apply `--patch`. Accepting it silently elsewhere would
    // report a fixture that never mounted, which is the failure this flag exists to
    // make impossible: boot-product's contract is the product profile with no overlay.
    if (options.patches.length > 0 && options.command !== 'start' && options.command !== 'probe') {
      fail(`--patch applies to probe and start only; '${options.command}' does not mount profile overlays`)
    }

    switch (options.command) {
      case 'probe': return commandProbe(layout, options, combination)
      case 'boot-product': return await commandBootProduct(layout, options, combination)
      case 'start': return await commandStart(layout, options, combination)
      case 'stop': return await commandStop(layout, options)
      case 'status': return commandStatus(layout, options)
      case 'doctor': return commandDoctor(layout, options, combination)
      default: fail(`unknown command ${JSON.stringify(options.command)}; expected probe|boot-product|start|stop|status|doctor`)
    }
  } catch (error) {
    return cliFailure(error)
  }
}

if (import.meta.main) process.exit(await main(process.argv))
