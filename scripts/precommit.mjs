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
 * Delivery is unchanged: `CODING_STANDARDS.md` still requires `npm test` and
 * `npm run combo:verify` on the final integration state, and CI runs the same.
 *
 * Usage:
 *   node scripts/precommit.mjs           # classify the staged change and run the gate
 *   node scripts/precommit.mjs --print   # print the decision as JSON, run nothing
 *   node scripts/precommit.mjs --full    # run the full suite whatever changed
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** Checks a Markdown-only commit runs: the link check, then the combination. */
export const DOCS_COMMANDS = Object.freeze([
  Object.freeze({ command: 'node', args: Object.freeze(['--test', 'tests/docs.test.mjs']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

/** Checks a change with related tests runs: the build, those tests, the combination. */
export function relatedCommands(tests) {
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

/** Checks any other commit runs: the full product suite, then the combination. */
export const FULL_COMMANDS = Object.freeze([
  Object.freeze({ command: 'npm', args: Object.freeze(['test']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

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
  /^scripts\/(?:precommit|tsc|link-types|combo|ourfairy-composition|ourfairy-backend)\.(?:mjs|ts)$/u,
  /^tests\/helpers\//u,
  /^tests\/fixtures\//u,
  /^\.github\//u,
  /^\.githooks\//u,
  /^android\//u,
])

/**
 * The test files the repository runs, mirroring `npm test`'s glob.
 * @param {string} root
 * @returns {string[]} repo-relative paths.
 */
function testFiles(root) {
  const found = []
  const walk = (dir, prefix) => {
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
 * @param {string} root
 * @param {string} name - the directory name under `backend/`.
 * @returns {string}
 */
function productPackageName(root, name) {
  const manifest = join(root, 'backend', name, 'package.json')
  if (existsSync(manifest)) {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof parsed.name === 'string' && parsed.name !== '') return parsed.name
  }
  return `@ourfairy/dsh-${name}`
}

/**
 * The test files a staged change is related to.
 *
 * Staged test files are always selected. A changed product package selects the
 * tests whose body names that package, and a changed script selects the tests
 * whose body names that script. A Markdown change selects the link check.
 * @param {string[]} paths staged paths, repository-relative
 * @param {{root?: string}} [options]
 * @returns {string[]} repo-relative test paths.
 */
export function relatedTests(paths, { root = repoRoot } = {}) {
  const selected = new Set()
  const needles = []
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
      needles.push(`backend/${productPackage[1]}/`, productPackageName(root, productPackage[1]))
      continue
    }
    const script = /^scripts\/([^/]+)\.(?:mjs|ts)$/u.exec(path)
    if (script !== null) needles.push(`scripts/${script[1]}.`)
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
 * @param {string[]} paths staged paths, repository-relative
 * @param {{merge?: boolean, forceFull?: boolean, root?: string}} [options]
 * @returns {'docs'|'related'|'typecheck'|'full'}
 */
export function classify(paths, options = {}) {
  return decide(paths, options).mode
}

/**
 * The decision, with the tests it selected.
 * @param {string[]} paths
 * @param {{merge?: boolean, forceFull?: boolean, root?: string}} [options]
 * @returns {{mode: 'docs'|'related'|'typecheck'|'full', tests: string[]}}
 */
function decide(paths, options = {}) {
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
 * @param {string[]} paths
 * @param {{merge?: boolean, forceFull?: boolean, root?: string}} [options]
 * @returns {{mode: string, tests: string[], commands: {command: string, args: string[]}[]}}
 */
export function plan(paths, options = {}) {
  const { mode, tests } = decide(paths, options)
  if (mode === 'docs') return { mode, tests, commands: DOCS_COMMANDS }
  if (mode === 'full') return { mode, tests, commands: FULL_COMMANDS }
  if (mode === 'typecheck') return { mode, tests, commands: TYPECHECK_COMMANDS }
  return { mode, tests, commands: relatedCommands(tests) }
}

/**
 * The paths this commit changes against HEAD.
 *
 * During a merge or an amend this is the delta against the first parent / the
 * commit being replaced, which is exactly what the gate has to cover. A
 * repository without HEAD (the first commit) compares against the empty tree.
 * @param {string} root
 * @returns {string[]}
 */
export function stagedPaths(root) {
  const read = args => execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  let out
  try {
    out = read(['diff', '--cached', '--name-only', 'HEAD'])
  } catch {
    out = read(['diff', '--cached', '--name-only'])
  }
  return out.split('\n').filter(Boolean)
}

/**
 * Whether this checkout is in the middle of a merge.
 * @param {string} root
 * @returns {boolean}
 */
export function isMerging(root) {
  return spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root }).status === 0
}

function main(argv) {
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
    const result = spawnSync(step.command, step.args, { cwd: repoRoot, stdio: 'inherit' })
    if (result.status !== 0) {
      process.stderr.write(`pre-commit: ${step.command} ${step.args.join(' ')} failed\n`)
      process.exitCode = result.status ?? 1
      return
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
