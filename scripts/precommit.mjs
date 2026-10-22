#!/usr/bin/env node
/**
 * The commit gate, split by what the commit touches.
 *
 * The full suite takes ~100 s because every test boots the real backend. Run on
 * every commit — and again on every `--amend` — it dominated the 131–137 wave:
 * 272 commits cost 1.9 h, and the gate was skipped with `--no-verify` 27 times,
 * which is what a gate people cannot afford looks like. A Markdown-only commit
 * (the evidence records the workflow produces after every ticket) can only
 * break the link check, so it runs that check and the combination check, not
 * the backend suite. Anything else still runs the full suite.
 *
 * Delivery is unchanged: `CODING_STANDARDS.md` still requires `npm test` and
 * `npm run combo:verify` on the final integration state, and CI runs the same.
 *
 * Usage:
 *   node scripts/precommit.mjs           # classify the staged change and run the gate
 *   node scripts/precommit.mjs --print   # print the decision as JSON, run nothing
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** Checks a Markdown-only commit runs: the link check, then the combination. */
export const DOCS_COMMANDS = Object.freeze([
  Object.freeze({ command: 'node', args: Object.freeze(['--test', 'tests/docs.test.mjs']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

/** Checks any other commit runs: the full product suite, then the combination. */
export const FULL_COMMANDS = Object.freeze([
  Object.freeze({ command: 'npm', args: Object.freeze(['test']) }),
  Object.freeze({ command: 'npm', args: Object.freeze(['run', 'combo:verify']) }),
])

/**
 * Which gate a staged change earns.
 *
 * A commit that changes no path at all is a message-only amend: its tree is the
 * one already committed, so only the docs check has anything to add. Every
 * other commit is `docs` only when every path is Markdown — one code or config
 * file pulls the whole suite back in.
 * @param {string[]} paths staged paths, repository-relative
 * @returns {'docs'|'full'}
 */
export function classify(paths) {
  if (paths.length === 0) return 'docs'
  return paths.every(path => /\.mdx?$/iu.test(path)) ? 'docs' : 'full'
}

/**
 * The commands a staged change must pass.
 * @param {string[]} paths
 * @returns {{mode: 'docs'|'full', commands: {command: string, args: string[]}[]}}
 */
export function plan(paths) {
  const mode = classify(paths)
  return { mode, commands: mode === 'docs' ? DOCS_COMMANDS : FULL_COMMANDS }
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

function main(argv) {
  const print = argv.includes('--print')
  const paths = stagedPaths(repoRoot)
  const decision = plan(paths)
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
