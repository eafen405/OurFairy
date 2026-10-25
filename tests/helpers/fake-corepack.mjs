/**
 * A fake `corepack` for the install-lifecycle tests (ticket #230).
 *
 * The launcher runs pnpm as a subprocess (`corepack pnpm@<pin> …`), so the way
 * to control an install without touching production is to put a different
 * executable named `corepack` first on PATH. This helper creates that
 * executable and reads back what it was asked to do.
 *
 * The fake proves only the *process* seam: which invocations happened, in what
 * order, in which directory, and whether the profile lockfile existed when each
 * one started. Everything after pnpm — the launcher's linked-manifest
 * validation, template publication and stamp write — still runs for real and is
 * asserted by the test from the filesystem and `doctor` output.
 *
 * Install outcomes are scripted per call, in order:
 *
 * - `succeed`: write a lockfile and the minimal linked bundle manifest the
 *   launcher validates, then exit 0;
 * - `fail`: record the attempt, print a distinguishable failure and exit 1;
 * - `succeed-without-linked`: write only a lockfile and exit 0, which is the
 *   "install claimed success but the bundle is missing" state.
 *
 * A template-reuse case scripts `fail` for the installs it must not run: the
 * call log records the attempt before the fake exits non-zero, so a wrong copy
 * decision is visible in the log and loud in the launcher's error.
 *
 * The fake's state lives in a temporary directory: `config.json` (the script)
 * and `calls.jsonl` (one JSON object per invocation). POSIX only, like the
 * launcher's own `corepack` invocation on the platforms these tests run on.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Install outcomes the fake can script. */
export const INSTALL_SUCCEEDED = 'succeed'
export const INSTALL_FAILED = 'fail'
export const INSTALL_SUCCEEDED_WITHOUT_LINKED = 'succeed-without-linked'

const OUTCOMES = [INSTALL_SUCCEEDED, INSTALL_FAILED, INSTALL_SUCCEEDED_WITHOUT_LINKED]

/** This module, imported by the generated executable. */
const helperUrl = pathToFileURL(fileURLToPath(import.meta.url)).href

/**
 * Create the fake and its empty state directory.
 * @param {{installs: string[]}} options - one outcome per install call, in
 *   order; later calls repeat the last outcome. Required: a fake with no
 *   scripted outcome could only succeed by accident.
 * @returns {{dir: string, binDir: string, stateDir: string}} paths to clean up
 *   with {@link removeFakeCorepack}.
 */
export function installFakeCorepack({ installs } = {}) {
  if (!Array.isArray(installs)) {
    throw new Error('fake corepack needs an "installs" list; pass one outcome per install call')
  }
  if (installs.length === 0) throw new Error('fake corepack needs at least one scripted install outcome')
  for (const outcome of installs) {
    if (!OUTCOMES.includes(outcome)) {
      throw new Error(`unknown fake corepack install outcome ${JSON.stringify(outcome)}; expected one of ${OUTCOMES.join(', ')}`)
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'ourfairy-fake-corepack-'))
  const binDir = join(dir, 'bin')
  const stateDir = join(dir, 'state')
  mkdirSync(binDir)
  mkdirSync(stateDir)
  writeFileSync(join(stateDir, 'config.json'), `${JSON.stringify({ installs }, undefined, 2)}\n`)
  const executable = join(binDir, 'corepack')
  writeFileSync(executable, `#!/usr/bin/env node\nimport { runFakeCorepack } from ${JSON.stringify(helperUrl)}\nrunFakeCorepack()\n`)
  chmodSync(executable, 0o755)
  return { dir, binDir, stateDir }
}

/**
 * The environment entries that put the fake first on PATH and point it at its
 * state. Layer these over the process environment when running the launcher.
 * @param {{binDir: string, stateDir: string}} fake
 * @returns {{PATH: string, FAKE_COREPACK_STATE: string}}
 */
export function fakeCorepackEnv({ binDir, stateDir }) {
  return {
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_COREPACK_STATE: stateDir,
  }
}

/**
 * Every invocation the fake served, in order.
 * @param {{stateDir: string}} fake
 * @returns {Array<{kind: 'version'|'install'|'other', argv: string[], cwd: string,
 *   lockfile: boolean, attempt?: number, outcome?: string}>}
 */
export function corepackCalls({ stateDir }) {
  const path = join(stateDir, 'calls.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line))
}

/** Remove the fake's directory. */
export function removeFakeCorepack({ dir }) {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * The executable's entry point: classify one invocation, record it, then either
 * fail or leave the artifacts a successful install produces.
 */
export function runFakeCorepack() {
  const stateDir = process.env.FAKE_COREPACK_STATE
  if (stateDir === undefined || stateDir === '') {
    process.stderr.write('fake corepack: FAKE_COREPACK_STATE is not set; refusing to guess where to record the call\n')
    process.exitCode = 2
    return
  }
  const argv = process.argv.slice(2)
  const cwd = process.cwd()
  const lockfile = existsSync(join(cwd, 'pnpm-lock.yaml'))
  const rest = argv.slice(1)
  if (rest[0] === '--version') {
    recordCall(stateDir, { kind: 'version', argv, cwd, lockfile })
    process.stdout.write(`${argv[0]?.replace(/^pnpm@/u, '') ?? ''}\n`)
    return
  }
  if (rest[0] !== 'install') {
    recordCall(stateDir, { kind: 'other', argv, cwd, lockfile })
    process.stderr.write(`fake corepack: unsupported invocation ${JSON.stringify(argv)}\n`)
    process.exitCode = 2
    return
  }
  const config = JSON.parse(readFileSync(join(stateDir, 'config.json'), 'utf8'))
  const attempt = corepackCalls({ stateDir }).filter(call => call.kind === 'install').length + 1
  const outcome = config.installs[Math.min(attempt - 1, config.installs.length - 1)]
  recordCall(stateDir, { kind: 'install', argv, cwd, lockfile, attempt, outcome })
  if (outcome === INSTALL_FAILED) {
    process.stdout.write(`fake corepack: install attempt ${attempt} failed\n`)
    process.stderr.write(`fake corepack stderr: simulated pnpm failure on attempt ${attempt}\n`)
    process.exitCode = 1
    return
  }
  writeFileSync(join(cwd, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  if (outcome === INSTALL_SUCCEEDED) writeLinkedBundle(join(cwd, 'package.json'), cwd)
  process.stdout.write(`fake corepack: install attempt ${attempt} succeeded\n`)
}

/**
 * Leave the minimal installed tree the launcher validates after an install: the
 * linked bundle manifest, under the bundle package the profile manifest names.
 * @param {string} manifestPath - the generated profile's `package.json`.
 * @param {string} profileDir - the install's cwd.
 */
function writeLinkedBundle(manifestPath, profileDir) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bundle = manifest?.dsh?.profile?.bundles?.[0]
  if (typeof bundle !== 'string' || bundle === '') {
    throw new Error(`fake corepack: ${manifestPath} names no dsh.profile.bundles entry to install`)
  }
  const dir = join(profileDir, 'node_modules', ...bundle.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: bundle, version: '0.0.0', private: true }, undefined, 2)}\n`)
}

/**
 * Append one invocation to the call log. The log is the authority for call
 * order and for each install's starting lockfile state.
 * @param {string} stateDir
 * @param {object} call
 */
function recordCall(stateDir, call) {
  appendFileSync(join(stateDir, 'calls.jsonl'), `${JSON.stringify(call)}\n`)
}
