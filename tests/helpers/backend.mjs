/**
 * Shared helpers for the OurFairy baseline tests.
 *
 * Every test drives the real product entry (`scripts/ourfairy-backend.mjs`),
 * which in turn boots the shipped dsh CLI profile machinery — no plugin is
 * assembled by hand here.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of this ticket worktree (the repository under test). */
export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Path of the product launcher every test drives. */
export const backendScript = join(repoRoot, 'scripts', 'ourfairy-backend.mjs')

/** Create a unique isolated OURFAIRY_HOME under the OS temp directory. */
export function makeHome(prefix = 'ourfairy-home-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Remove an isolated home created by {@link makeHome}. */
export function removeHome(path) {
  rmSync(path, { recursive: true, force: true })
}

/**
 * Run one launcher command.
 * @param {string[]} args - launcher arguments (`probe`, `start`, `stop`, ...).
 * @param {Record<string, string|undefined>} env - environment entries layered
 *   over the test process environment; an explicit `undefined` removes a name
 *   (used to prove keyless startup).
 * @param {{timeoutMs?: number, cwd?: string}} [options]
 * @returns {{code: number, stdout: string, stderr: string, error?: Error}}
 */
export function runBackend(args, env = {}, options = {}) {
  const merged = { ...process.env }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete merged[name]
    else merged[name] = value
  }
  const result = spawnSync(process.execPath, [backendScript, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: merged,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    code: result.status === null ? -1 : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

/** Read the probe report written by `probe --report <path>`. */
export function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Format a failed command for an assertion message without hiding raw output. */
export function describeRun(label, run) {
  return `${label} exited ${run.code}${run.error === undefined ? '' : ` (${run.error.message})`}\n`
    + `--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`
}
