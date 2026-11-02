/**
 * Disposable, confined verification for one skill candidate (#297).
 *
 * A candidate's representative scenarios run for real: each command is spawned
 * in a fresh bubblewrap namespace whose only writable root is one throwaway
 * directory under `verify/<uuid>/`, with a one-off `HOME`, `TMPDIR` and
 * package-manager caches inside it. The candidate package is copied to
 * `work/` first, so a scenario can never modify the candidate or an approved
 * version, and the shared environment root (`dsh-home/env`), the spaces roots
 * and every session root are not mounted at all.
 *
 * The runner records what happened — command, exit code, timeout/abort reason,
 * duration, environment and bounded output — because those facts must not be
 * authored by the model. The report names executed/failed/unexecuted items and
 * whether the run was complete; an approval consumes it later. `reused` stays
 * empty here: verification reuse is the evolution ticket's seam.
 *
 * @module @ourfairy/dsh-skill-creator/src/verify
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { buildBwrapArgv, probeBwrap } from '@ourfairy/dsh-spaces/bwrap'
import { copySkillPackage } from './package.js'

/** One representative command a candidate is verified with. */
export interface VerificationScenario {
  readonly name: string
  readonly command: string
  readonly description?: string
  /** Package-relative files the command depends on; reuse keys on them. */
  readonly uses?: readonly string[]
  /** A per-scenario bound, already checked against the configured ceiling. */
  readonly timeoutMs?: number
}

/** One optional with/without comparison; no approval depends on it in this ticket. */
export interface VerificationComparison {
  readonly name: string
  readonly withSkill: string
  readonly withoutSkill: string
}

/** One scenario's recorded outcome, written by the system only. */
export interface ScenarioRecord {
  readonly name: string
  readonly command: string
  /** `executed` (exit 0), `failed` (ran but did not pass, timed out or aborted) or `unexecuted`. */
  readonly status: 'executed' | 'failed' | 'unexecuted'
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly durationMs: number
  /** Epoch ms when the command was launched; `ranAt` for the whole run. */
  readonly executedAt: number
  /** Where the command actually ran; empty for an unexecuted scenario. */
  readonly environment: { readonly cwd: string; readonly home: string }
  readonly stdoutSummary: string
  readonly stderrSummary: string
  /** Why the scenario did not run or did not pass, in the system's words. */
  readonly reason?: string
}

/** Both sides of one optional comparison, each recorded like a scenario. */
export interface ComparisonRecord {
  readonly name: string
  readonly withSkill: ScenarioRecord
  readonly withoutSkill: ScenarioRecord
}

/** The durable report one version stores. */
export interface VerificationReport {
  /** Whether every scenario actually ran to an outcome (a failed command still ran). */
  readonly complete: boolean
  readonly executed: ScenarioRecord[]
  readonly reused: ScenarioRecord[]
  readonly unexecuted: ScenarioRecord[]
  readonly failed: ScenarioRecord[]
  readonly comparisons: ComparisonRecord[]
  /** The confinement and package-copy facts, for the review display. */
  readonly environment: string
  readonly ranAt: number
}

/** The output summary bound, per stream. */
const OUTPUT_SUMMARY_MAX = 4_000

/** How long a killed bwrap child may hold its output pipes before the runner gives up. */
const KILL_GRACE_MS = 2_000

/** Whether the caller's signal has aborted; a call keeps TypeScript from narrowing it once. */
function abortedSignal(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

/** Bound one output stream to a readable summary. */
function summary(text: string): string {
  return text.length <= OUTPUT_SUMMARY_MAX ? text : `${text.slice(0, OUTPUT_SUMMARY_MAX - 1)}…`
}

/** The one-line environment note the review display prints. */
const ENVIRONMENT_NOTE = 'bwrap namespace (network shared; disposable HOME/TMPDIR/caches; package copy in work/)'

/** One scenario that never ran, with the system's reason. */
function unexecutedRecord(scenario: VerificationScenario, reason: string): ScenarioRecord {
  return {
    name: scenario.name,
    command: scenario.command,
    status: 'unexecuted',
    exitCode: null,
    timedOut: false,
    durationMs: 0,
    executedAt: Date.now(),
    environment: { cwd: '', home: '' },
    stdoutSummary: '',
    stderrSummary: '',
    reason,
  }
}

/** One completed run's raw facts, before they are classified. */
interface CommandOutcome {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly spawnError?: string
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly executedAt: number
}

/** The environment overrides inserted after the carrier defaults, before `--chdir`. */
function environmentArgs(verifyRoot: string): string[] {
  const home = join(verifyRoot, 'home')
  const tmp = join(verifyRoot, 'tmp')
  return [
    '--setenv', 'HOME', home,
    '--setenv', 'TMPDIR', tmp,
    '--setenv', 'XDG_CACHE_HOME', join(home, '.cache'),
    '--setenv', 'XDG_CONFIG_HOME', join(home, '.config'),
    '--setenv', 'XDG_DATA_HOME', join(home, '.local', 'share'),
    '--setenv', 'NPM_CONFIG_CACHE', join(home, '.npm'),
    '--setenv', 'PIP_CACHE_DIR', join(home, '.cache', 'pip'),
    '--setenv', 'CARGO_HOME', join(home, '.cargo'),
  ]
}

/** Run one command under bwrap and collect its bounded facts. */
function runCommand({ bwrapPath, verifyRoot, command, timeoutMs, signal }: {
  readonly bwrapPath: string
  readonly verifyRoot: string
  readonly command: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}): Promise<CommandOutcome> {
  const work = join(verifyRoot, 'work')
  const argv = buildBwrapArgv(bwrapPath, {
    workspaceRoot: verifyRoot,
    writable: true,
    writableRoots: [verifyRoot],
    readRoots: [],
    network: true,
    cwd: work,
  }, ['/bin/bash', '-lc', command])
  const changeDirectory = argv.lastIndexOf('--chdir')
  argv.splice(changeDirectory, 0, ...environmentArgs(verifyRoot))
  return new Promise(resolve => {
    const executedAt = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted: boolean = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const child = spawn(argv[0] as string, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const onAbort = () => {
      aborted = true
      kill()
    }
    const clearTimers = () => {
      clearTimeout(timeoutTimer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
    }
    const finish = (outcome: Omit<CommandOutcome, 'stdout' | 'stderr' | 'durationMs' | 'executedAt'>) => {
      if (settled) return
      settled = true
      clearTimers()
      signal?.removeEventListener('abort', onAbort)
      child.stdout.destroy()
      child.stderr.destroy()
      resolve({
        ...outcome,
        stdout: summary(stdout),
        stderr: summary(stderr),
        durationMs: Date.now() - executedAt,
        executedAt,
      })
    }
    const kill = () => {
      if (settled) return
      // The bwrap child leads its own process group; kill the group so the
      // confined command cannot outlive the timeout or the aborted turn.
      try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
      graceTimer = setTimeout(() => finish({ exitCode: null, timedOut, aborted }), KILL_GRACE_MS)
    }
    const timeoutTimer = setTimeout(() => { timedOut = true; kill() }, Math.max(1, timeoutMs))
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => finish({ exitCode: null, timedOut, aborted, spawnError: error.message }))
    child.on('close', (code, closeSignal) => finish({
      exitCode: typeof code === 'number' ? code : null,
      timedOut,
      aborted,
      ...(closeSignal !== null && code === null ? { spawnError: `killed by ${closeSignal}` } : {}),
    }))
  })
}

/** Classify one raw outcome into a durable scenario record. */
function recordOf(scenario: VerificationScenario, outcome: CommandOutcome, verifyRoot: string, timeoutMs: number): ScenarioRecord {
  const passed = outcome.exitCode === 0 && !outcome.timedOut && !outcome.aborted && outcome.spawnError === undefined
  const reason = outcome.aborted
    ? 'verification aborted by the calling turn'
    : outcome.timedOut
      ? `timed out after ${timeoutMs}ms`
      : outcome.spawnError
        ?? (outcome.exitCode === 0 ? undefined : `exit code ${String(outcome.exitCode)}`)
  return {
    name: scenario.name,
    command: scenario.command,
    status: passed ? 'executed' : 'failed',
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    durationMs: outcome.durationMs,
    executedAt: outcome.executedAt,
    environment: { cwd: join(verifyRoot, 'work'), home: join(verifyRoot, 'home') },
    stdoutSummary: outcome.stdout,
    stderrSummary: outcome.stderr,
    ...(reason === undefined ? {} : { reason }),
  }
}

/**
 * Run one candidate's scenarios in one disposable environment.
 *
 * @param options - the data root, the candidate package to copy, the scenarios,
 *   the per-scenario ceiling, an optional abort signal and an optional bwrap path.
 * @returns the system-recorded report; the disposable directory is gone.
 */
export async function runVerification(options: {
  readonly root: string
  readonly packageDir: string
  readonly scenarios: readonly VerificationScenario[]
  readonly comparisons?: readonly VerificationComparison[]
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly bwrapPath?: string
}): Promise<VerificationReport> {
  const ranAt = Date.now()
  const verifyRoot = join(options.root, 'verify', randomUUID())
  const bwrapPath = options.bwrapPath ?? 'bwrap'
  const empty = (reason: string, complete = false): VerificationReport => ({
    complete,
    executed: [],
    reused: [],
    unexecuted: options.scenarios.map(scenario => unexecutedRecord(scenario, reason)),
    failed: [],
    comparisons: [],
    environment: ENVIRONMENT_NOTE,
    ranAt,
  })
  try {
    mkdirSync(join(verifyRoot, 'work'), { recursive: true })
    mkdirSync(join(verifyRoot, 'home'), { recursive: true })
    mkdirSync(join(verifyRoot, 'tmp'), { recursive: true })
    try {
      copySkillPackage(options.packageDir, join(verifyRoot, 'work'))
    } catch (error) {
      return empty(`the candidate package could not be copied for verification: ${error instanceof Error ? error.message : String(error)}`)
    }
    const probe = probeBwrap(bwrapPath)
    if (!probe.ok) return empty(`bwrap is unavailable: ${probe.detail}`)
    if (abortedSignal(options.signal)) {
      return {
        ...empty('verification aborted by the calling turn'),
        unexecuted: options.scenarios.map(scenario => unexecutedRecord(scenario, 'verification aborted by the calling turn')),
      }
    }

    const executed: ScenarioRecord[] = []
    const failed: ScenarioRecord[] = []
    const unexecuted: ScenarioRecord[] = []
    let aborted: boolean = false
    for (const scenario of options.scenarios) {
      if (aborted || abortedSignal(options.signal)) {
        aborted = true
        unexecuted.push(unexecutedRecord(scenario, 'verification aborted by the calling turn'))
        continue
      }
      const outcome = await runCommand({
        bwrapPath,
        verifyRoot,
        command: scenario.command,
        timeoutMs: scenario.timeoutMs ?? options.timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (outcome.aborted) aborted = true
      const record = recordOf(scenario, outcome, verifyRoot, scenario.timeoutMs ?? options.timeoutMs)
      if (record.status === 'executed') executed.push(record)
      else failed.push(record)
    }

    const comparisons: ComparisonRecord[] = []
    for (const comparison of options.comparisons ?? []) {
      if (aborted) break
      const withSkill = await runCommand({ bwrapPath, verifyRoot, command: comparison.withSkill,
        timeoutMs: options.timeoutMs, ...(options.signal === undefined ? {} : { signal: options.signal }) })
      const withoutSkill = await runCommand({ bwrapPath, verifyRoot, command: comparison.withoutSkill,
        timeoutMs: options.timeoutMs, ...(options.signal === undefined ? {} : { signal: options.signal }) })
      comparisons.push({
        name: comparison.name,
        withSkill: recordOf({ name: `${comparison.name} (with skill)`, command: comparison.withSkill }, withSkill, verifyRoot, options.timeoutMs),
        withoutSkill: recordOf({ name: `${comparison.name} (without skill)`, command: comparison.withoutSkill }, withoutSkill, verifyRoot, options.timeoutMs),
      })
    }

    const complete = !aborted && unexecuted.length === 0
    return {
      complete,
      executed,
      reused: [],
      unexecuted,
      failed,
      comparisons,
      environment: ENVIRONMENT_NOTE,
      ranAt,
    }
  } finally {
    rmSync(verifyRoot, { recursive: true, force: true })
  }
}
