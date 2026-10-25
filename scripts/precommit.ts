#!/usr/bin/env node
/**
 * The commit gate, split by what the commit touches.
 *
 * The full suite takes ~100 s because every test boots the real backend. Run on
 * every commit — and again on every `--amend` — it dominated the 131–137 wave:
 * 272 commits cost 1.9 h, and the gate was skipped with `--no-verify` 27 times,
 * which is what a gate people cannot afford looks like.
 *
 * Four modes replace the old two. A Markdown-only change runs the link check
 * and the combination check. A change that names a related test runs the build
 * and that test. A source change no test names runs the type check — it makes
 * no behaviour claim. Only the authorities that decide what every package
 * installs, a merge, an explicit `--full`, or a selection wider than the limit
 * run the whole suite.
 *
 * The selection is a direct-surface choice, not a coverage claim: a package no
 * test imports on purpose falls to `typecheck`, and the closing ticket runs the
 * full suite.
 *
 * Final backend and changed-face Android checks remain mandatory;
 * `CODING_STANDARDS.md` names the delivery commands and CI runs both product faces.
 *
 * Usage:
 *   node scripts/precommit.ts           # classify the staged change and run the gate
 *   node scripts/precommit.ts --print   # print the decision as JSON, run nothing
 *   node scripts/precommit.ts --full    # run the full suite whatever changed
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCliEntry } from './cli-guard.ts'
import { packageNameOf } from './package-manifest.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** One command the gate runs, relative to the repository root unless cwd says otherwise. */
export type GateCommand = { command: string; args: readonly string[]; cwd?: string }

/** Which gate a staged change earns. */
export type GateMode = 'docs' | 'related' | 'typecheck' | 'full'

/** What the caller asks the gate to decide. */
export type GateOptions = { merge?: boolean; forceFull?: boolean; root?: string }

/** The decision, with the tests it selected. */
export type GateDecision = { mode: GateMode; tests: string[] }

/** The decision and the commands it runs. */
export type GatePlan = { mode: GateMode; tests: string[]; commands: readonly GateCommand[] }

/** Checks a Markdown-only commit runs: the link check, then the combination. */
export const DOCS_COMMANDS = Object.freeze([
  Object.freeze({ command: 'node', args: Object.freeze(['--test', 'tests/docs.test.mjs']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

/** Checks a change with related tests runs: the build, those tests, the combination. */
export function relatedCommands(tests: string[]): GateCommand[] {
  return [
    { command: 'npm', args: ['run', 'build'] },
    { command: 'node', args: ['--test', ...tests] },
    { command: 'npm', args: ['run', 'combo:verify'] },
  ]
}

/** Checks a source change with no related test runs: the type check, the combination. */
export const TYPECHECK_COMMANDS = Object.freeze([
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'typecheck']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

/** Checks any other commit runs: the full backend suite, then the combination. */
export const FULL_COMMANDS = Object.freeze([
  Object.freeze({ command: 'npm', args: Object.freeze(['test']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

/** Android checks run in their own Gradle project, in addition to the root gate. */
const ANDROID_COMMAND = Object.freeze({
  command: './gradlew', args: Object.freeze(['test', 'lintDebug']), cwd: 'android',
})

/**
 * How many related tests may be selected before the gate runs everything.
 *
 * A selection wider than this is a near-full suite with a different command
 * shape, which is a third state nobody wants to reason about.
 */
export const FULL_TEST_LIMIT = 45

/**
 * Paths that decide what every package installs, or how the gate itself runs.
 *
 * A change to one of these cannot be judged by the tests it happens to touch,
 * so it earns the full suite.
 */
const FULL_AUTHORITY = Object.freeze([
  /^package\.json$/u,
  /^combo\.json$/u,
  /^(?:backend\/[^/]+\/)?tsconfig[^/]*\.json$/u,
  /^backend\/[^/]+\/package\.json$/u,
  /^scripts\/(?:precommit|tsc|link-types|combo|cli-guard|package-manifest|ourfairy-composition|ourfairy-backend)\.(?:mjs|ts)$/u,
  /^tests\/helpers\//u,
  /^tests\/fixtures\//u,
  /^\.github\//u,
  /^\.githooks\//u,
  /^android\//u,
])

/**
 * The test files the repository runs.
 *
 * `npm test`'s glob is the authority; `tests/precommit.test.mjs` pins this walk
 * against that glob, so a new test cannot silently drop out of the related gate.
 * @param root
 * @returns repo-relative paths.
 */
export function testFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      else if (entry.name.endsWith('.test.mjs')) found.push(`${prefix}${entry.name}`)
    }
  }
  walk(join(root, 'tests'), 'tests/')
  return found.sort()
}

/**
 * One product package's published name, read from its manifest.
 *
 * The manifest is the authority: the repository's package names do not follow a
 * derivable pattern — `backend/probe` publishes `@ourfairy/dsh-baseline-probe`
 * — so a name that is not read from the manifest would be an invention, and an
 * invented name names a package that does not exist. A package without a
 * manifest has no name; the caller then selects it by its directory alone.
 * @param root
 * @param name - the directory name under `backend/`.
 * @returns
 */
function productPackageName(root: string, name: string): string | undefined {
  return packageNameOf(join(root, 'backend', name))
}

/**
 * The test files a staged change is related to.
 *
 * Staged test files are always selected. A changed product package selects the
 * tests whose body names that package, and a changed script selects the tests
 * whose body names that script. A Markdown change selects the link check.
 * @param paths staged paths, repository-relative
 * @param [options]
 * @returns repo-relative test paths.
 */
export function relatedTests(paths: string[], { root = repoRoot }: { root?: string } = {}): string[] {
  const selected = new Set<string>()
  const needles: string[] = []
  for (const path of paths) {
    if (/^tests\/.+\.test\.mjs$/u.test(path)) {
      selected.add(path)
      continue
    }
    if (/\.mdx?$/u.test(path)) {
      selected.add('tests/docs.test.mjs')
      continue
    }
    const productPackage = /^backend\/([^/]+)\//u.exec(path)
    if (productPackage !== null) {
      needles.push(`backend/${productPackage[1]}/`)
      const published = productPackageName(root, productPackage[1]!)
      if (published !== undefined) needles.push(published)
      continue
    }
    const script = /^scripts\/([^/]+)\.(?:mjs|ts)$/u.exec(path)
    if (script !== null) needles.push(`scripts/${script[1]!}.`)
  }
  if (needles.length > 0) {
    for (const file of testFiles(root)) {
      const body = readFileSync(join(root, file), 'utf8')
      if (needles.some(needle => body.includes(needle))) selected.add(file)
    }
  }
  return [...selected].sort()
}

/**
 * Which gate a staged change earns.
 *
 * A commit that changes no path at all is a message-only amend: its tree is the
 * one already committed, so only the docs check has anything to add. A merge
 * and an explicit `--full` earn the whole suite whatever they carry.
 * @param paths staged paths, repository-relative
 * @param [options]
 * @returns
 */
export function classify(paths: string[], options: GateOptions = {}): GateMode {
  return decide(paths, options).mode
}

/**
 * The decision, with the tests it selected.
 * @param paths
 * @param [options]
 * @returns
 */
function decide(paths: string[], options: GateOptions = {}): GateDecision {
  if (options.merge === true || options.forceFull === true) return { mode: 'full', tests: [] }
  if (paths.length === 0) return { mode: 'docs', tests: [] }
  if (paths.every(path => /\.mdx?$/iu.test(path))) return { mode: 'docs', tests: [] }
  if (paths.some(path => FULL_AUTHORITY.some(pattern => pattern.test(path)))) return { mode: 'full', tests: [] }
  const tests = relatedTests(paths, options)
  if (tests.length > FULL_TEST_LIMIT) return { mode: 'full', tests }
  if (tests.length > 0) return { mode: 'related', tests }
  return { mode: 'typecheck', tests: [] }
}

/**
 * The commands a staged change must pass.
 * @param paths
 * @param [options]
 * @returns
 */
export function plan(paths: string[], options: GateOptions = {}): GatePlan {
  const { mode, tests } = decide(paths, options)
  const commands = mode === 'docs' ? DOCS_COMMANDS
    : mode === 'full' ? FULL_COMMANDS
      : mode === 'typecheck' ? TYPECHECK_COMMANDS
        : relatedCommands(tests)
  const withAndroid = paths.some(path => /^android\//u.test(path) && !/\.mdx?$/iu.test(path))
    ? [...commands, ANDROID_COMMAND]
    : commands
  return { mode, tests, commands: withAndroid }
}

/**
 * The paths this commit changes against HEAD.
 *
 * During a merge or an amend this is the delta against the first parent / the
 * commit being replaced, which is exactly what the gate has to cover. A
 * repository without HEAD (the first commit) compares against the empty tree.
 * @param root
 * @returns
 */
export function stagedPaths(root: string): string[] {
  const read = (args: string[]) => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  let out: string
  try {
    out = read(['diff', '--cached', '--name-only', 'HEAD'])
  } catch {
    out = read(['diff', '--cached', '--name-only'])
  }
  return out.split('\n').filter(Boolean)
}

/**
 * Whether this checkout is in the middle of a merge.
 * @param root
 * @returns
 */
export function isMerging(root: string): boolean {
  return spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).status === 0
}

function main(argv: string[]): void {
  const print = argv.includes('--print')
  const paths = stagedPaths(repoRoot)
  const decision = plan(paths, { merge: isMerging(repoRoot), forceFull: argv.includes('--full') })
  if (print) {
    process.stdout.write(`${JSON.stringify({ ...decision, paths }, null, 2)}\n`)
    return
  }
  const why = paths.length === 0 ? 'message-only amend' : decision.mode === 'docs' ? 'Markdown-only change' : `${paths.length} changed path(s)`
  process.stdout.write(`pre-commit: ${decision.mode} gate (${why})\n`)
  for (const step of decision.commands) {
    const result = spawnSync(step.command, step.args, { cwd: resolve(repoRoot, step.cwd ?? '.'), stdio: 'inherit' })
    if (result.status !== 0) {
      process.stderr.write(`pre-commit: ${step.command} ${step.args.join(' ')} failed\n`)
      process.exitCode = result.status ?? 1
      return
    }
  }
}

if (isCliEntry(import.meta.main)) main(process.argv.slice(2))
