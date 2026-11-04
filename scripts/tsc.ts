#!/usr/bin/env node
/**
 * Build this repository's product packages with the pinned dsh compiler.
 *
 * TypeScript is not a root devDependency: the combination already pins the dsh
 * checkout, and its build installs the compiler, so using that copy keeps the
 * compiler version in the same authority as `combo.json`. `-b` is both the build
 * and the type check; `--noEmit` is not a second mode (it injects noEmit into
 * referenced projects and fails with TS6310).
 *
 * The build is one command because it is one writer: the link farm, the output
 * directory, and the compiler all belong to the same root, and `tsc -b`'s
 * incremental state lives in that root too.
 *
 * `--fresh` makes the installed profile a function of the current sources, and
 * it is the only path that heals a partially deleted output: `tsc -b` reads
 * `dist/.tsbuildinfo`, so a `dist` missing one emitted file while its build info
 * survives is reported as up to date. The clear therefore stays — what it must
 * not do is clear the output while another build is writing it. Two builds then
 * delete each other's files, and every test that starts in that window fails as
 * if the product broke. The lock below serializes them instead.
 *
 * Usage:
 *   node scripts/tsc.ts           # link, then build the solution
 *   node scripts/tsc.ts --fresh   # clear the product output first, then build
 *   node scripts/tsc.ts --clean   # clear the product output and stop
 */
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isCliEntry } from './cli-guard.ts'
import { readCombo, repoPath } from './combo.ts'
import { linkTypes } from './link-types.ts'

/** The repository this module lives in; the default root of every function. */
export const repoRoot = resolve(import.meta.dirname, '..')

/**
 * How long a second build waits for the first one, in milliseconds.
 *
 * A full build of this solution takes well under two minutes on the machines it
 * runs on; ten minutes is long enough that the wait is never the failure, and
 * it doubles as the age bound that clears a lock a killed process left behind.
 */
export const BUILD_LOCK_TIMEOUT_MS = 600_000
/** How often the waiter re-checks the lock. */
const BUILD_LOCK_POLL_MS = 50

/**
 * The lock file's path, beside the build rather than inside it.
 *
 * `cleanProducts` removes every `backend/*\/dist`, so a lock stored in one of
 * them would be deleted by the very run that holds it.
 * @param root - repository root.
 * @returns the lock path.
 */
export function buildLockPath(root = repoRoot): string {
  return join(root, '.ourfairy-build.lock')
}

/**
 * Whether a pid names a live process.
 * @param pid - the pid to test.
 * @returns true when the process exists.
 */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // A process owned by another user still exists; only ESRCH means gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Wait until this process may write the product output.
 *
 * `wx` is the atomic step: exactly one creator wins, and the others see
 * `EEXIST` that way. A holder whose pid is gone, or a lock older than any build
 * takes, is stale and gets removed — that is what keeps a killed build from
 * wedging the next one.
 * @param root - repository root.
 * @returns the release this process must call when the build settles.
 */
export function acquireBuildLock(root = repoRoot): () => void {
  const path = buildLockPath(root)
  const deadline = Date.now() + BUILD_LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, `${String(process.pid)}\n`)
      closeSync(fd)
      return () => {
        try {
          // Only the holder removes it: another process may have taken the lock
          // after this one's file was ruled stale.
          if (readFileSync(path, 'utf8').trim() === String(process.pid)) rmSync(path, { force: true })
        } catch {
          // The file is already gone, so this hold needs no release.
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const holder = Number.parseInt((() => {
      try {
        return readFileSync(path, 'utf8').trim()
      } catch {
        return ''
      }
    })(), 10)
    const age = (() => {
      try {
        return Date.now() - statSync(path).mtimeMs
      } catch {
        return 0
      }
    })()
    if (!Number.isInteger(holder) || holder <= 0 || !processAlive(holder) || age > BUILD_LOCK_TIMEOUT_MS) {
      rmSync(path, { force: true })
      continue
    }
    if (Date.now() > deadline) {
      throw new Error(`another build holds ${path} (pid ${String(holder)}); waited ${String(BUILD_LOCK_TIMEOUT_MS)}ms`)
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BUILD_LOCK_POLL_MS)
  }
}

/**
 * The compiler the pinned dsh checkout publishes.
 * @param [root] - repository root.
 * @returns
 */
export function tscToolchain(root = repoRoot): { dsh: string; tsc: string } {
  const { combo } = readCombo(root)
  const dsh = repoPath(combo, 'dsh', root)
  return { dsh, tsc: join(dsh, 'node_modules', 'typescript', 'bin', 'tsc') }
}

/**
 * Remove every product package's build output.
 *
 * `tsc -b --clean` only removes the outputs it still knows about, so a file
 * whose source was deleted would survive and be installed. The whole output
 * directory goes instead, which is what makes the installed profile a function
 * of the current sources.
 * @param [root] - repository root.
 * @returns the directories removed.
 */
export function cleanProducts(root = repoRoot): string[] {
  const removed: string[] = []
  // The scripts' own build info is incremental state of the same build: a
  // stale one would let `tsc -b` report success without re-checking them.
  rmSync(join(root, 'scripts', 'tsconfig.tsbuildinfo'), { force: true })
  const backend = join(root, 'backend')
  if (!existsSync(backend)) return removed
  for (const entry of readdirSync(backend, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dist = join(backend, entry.name, 'dist')
    if (!existsSync(dist)) continue
    rmSync(dist, { recursive: true, force: true })
    removed.push(dist)
  }
  return removed
}

/**
 * Build the solution: link the farm, optionally clear the output, then compile.
 *
 * The whole run holds the build lock, so a second build waits instead of
 * clearing the output under the first one. Linking is inside the lock too: it
 * rewrites `node_modules`, which the compiler reads.
 * @param [root] - repository root.
 * @param [options] - `fresh` clears the output first.
 * @returns the compiler's exit code and text.
 */
export function buildProducts(root = repoRoot, { fresh = false }: { fresh?: boolean } = {}): { status: number; output: string } {
  const release = acquireBuildLock(root)
  try {
    linkTypes(root)
    if (fresh) cleanProducts(root)
    const { tsc } = tscToolchain(root)
    if (!existsSync(tsc)) {
      return {
        status: 1,
        output: `tsc not found at ${tsc}; build the pinned dsh checkout first (see combo.json requiredBuild)`,
      }
    }
    const result = spawnSync(process.execPath, [tsc, '-b'], { cwd: root, encoding: 'utf8' })
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
  } finally {
    release()
  }
}

if (isCliEntry(import.meta.main)) {
  const args = process.argv.slice(2)
  if (args.includes('--clean')) {
    const release = acquireBuildLock(repoRoot)
    try {
      const removed = cleanProducts(repoRoot)
      console.log(`removed ${removed.length} build output director${removed.length === 1 ? 'y' : 'ies'}`)
    } finally {
      release()
    }
  } else {
    const result = buildProducts(repoRoot, { fresh: args.includes('--fresh') })
    if (result.output !== '') process.stdout.write(result.output)
    process.exit(result.status)
  }
}
