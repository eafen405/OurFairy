#!/usr/bin/env node
/** Build product packages with the compiler from the pinned dsh checkout. */
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isCliEntry } from './cli-guard.ts'
import { readCombo, repoPath } from './combo.ts'
import { linkTypes } from './link-types.ts'

export const repoRoot = resolve(import.meta.dirname, '..')
export const BUILD_LOCK_TIMEOUT_MS = 600_000

/** Never unlink this file: every waiter must lock the same inode. */
export function buildLockPath(root = repoRoot): string {
  return join(root, '.ourfairy-build.lock')
}

const heldLocks = new Map<string, number>()

/**
 * Run a synchronous operation while holding the worktree's build lock.
 *
 * flock ties ownership to an open descriptor, so an empty file is harmless and
 * a killed process needs no stale-PID recovery. Reentry in this process lets the
 * test runner hold the lock across both buildProducts and the tests. Pass fd to
 * a child that uses the output so it keeps the lock if its parent is killed.
 */
export function withBuildLock<T>(root: string, run: (fd: number) => T): T {
  const key = realpathSync(root)
  const held = heldLocks.get(key)
  if (held !== undefined) return run(held)
  const fd = openSync(buildLockPath(key), 'a')
  try {
    const lock = spawnSync('flock', ['--exclusive', '--timeout', String(BUILD_LOCK_TIMEOUT_MS / 1000), '3'], {
      stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8',
    })
    if (lock.error !== undefined) throw new Error('build locking requires flock (util-linux)', { cause: lock.error })
    if (lock.status !== 0) throw new Error(`could not lock ${buildLockPath(key)}: ${lock.stderr || 'lock wait timed out'}`)
    heldLocks.set(key, fd)
    return run(fd)
  } finally {
    heldLocks.delete(key)
    closeSync(fd)
  }
}

/** The compiler supplied by the pinned dsh checkout. */
export function tscToolchain(root = repoRoot): { dsh: string; tsc: string } {
  const { combo } = readCombo(root)
  const dsh = repoPath(combo, 'dsh', root)
  return { dsh, tsc: join(dsh, 'node_modules', 'typescript', 'bin', 'tsc') }
}

/** Remove obsolete output as well as the incremental compiler state. */
export function cleanProducts(root = repoRoot): string[] {
  return withBuildLock(root, () => {
    const removed: string[] = []
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
  })
}

/** Link, optionally clear old output, and compile under the same lock. */
export function buildProducts(root = repoRoot, { fresh = false }: { fresh?: boolean } = {}): { status: number; output: string } {
  return withBuildLock(root, fd => {
    // Check the toolchain before deleting a usable build.
    const { tsc } = tscToolchain(root)
    if (!existsSync(tsc)) {
      return { status: 1, output: `tsc not found at ${tsc}; build the pinned dsh checkout first (see combo.json requiredBuild)` }
    }
    linkTypes(root)
    if (fresh) cleanProducts(root)
    const result = spawnSync(process.execPath, [tsc, '-b'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fd],
    })
    return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}` }
  })
}

if (isCliEntry(import.meta.main)) {
  if (process.argv.includes('--clean')) {
    const removed = cleanProducts(repoRoot)
    console.log(`removed ${removed.length} build output director${removed.length === 1 ? 'y' : 'ies'}`)
  } else {
    const result = buildProducts(repoRoot, { fresh: process.argv.includes('--fresh') })
    if (result.output !== '') process.stdout.write(result.output)
    process.exitCode = result.status
  }
}
