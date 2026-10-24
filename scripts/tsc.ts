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
 * Usage:
 *   node scripts/tsc.ts           # link, then build the solution
 *   node scripts/tsc.ts --fresh   # clear the product output first, then build
 *   node scripts/tsc.ts --clean   # clear the product output and stop
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isCliEntry } from './cli-guard.ts'
import { readCombo, repoPath } from './combo.ts'
import { linkTypes } from './link-types.ts'

/** The repository this module lives in; the default root of every function. */
export const repoRoot = resolve(import.meta.dirname, '..')

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
 * @param [root] - repository root.
 * @param [options] - `fresh` clears the output first.
 * @returns the compiler's exit code and text.
 */
export function buildProducts(root = repoRoot, { fresh = false }: { fresh?: boolean } = {}): { status: number; output: string } {
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
}

if (isCliEntry(import.meta.main)) {
  const args = process.argv.slice(2)
  if (args.includes('--clean')) {
    const removed = cleanProducts(repoRoot)
    console.log(`removed ${removed.length} build output director${removed.length === 1 ? 'y' : 'ies'}`)
  } else {
    const result = buildProducts(repoRoot, { fresh: args.includes('--fresh') })
    if (result.output !== '') process.stdout.write(result.output)
    process.exit(result.status)
  }
}
