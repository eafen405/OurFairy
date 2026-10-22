#!/usr/bin/env node
/**
 * The one view of where every spec stands.
 *
 * A spec finishes in three places that drift apart silently: the integration
 * branch (does it exist, did it leave the machine, did it land), the checkout
 * (worktrees left behind, ticket copies reachable), and the tracker (is the
 * spec issue still open). Nothing read those together, so the 131–137 wave
 * ended with three of six integration branches never pushed, six worktrees
 * still present, and a follow-up session spending ~30 git/gh calls to answer
 * "did spec 136 ever ship?".
 *
 * Every field is derived from git and the tracker at run time; the report is a
 * lookup, never a stored status table. It also replaces the polling loops
 * agents wrote (`sleep 240; git log ...`) with one call.
 *
 * Usage:
 *   node scripts/specs-status.mjs [--json] [--offline] [--spec <n>...]
 *
 * Exit code 1 when a spec has work that only exists locally (`unpushed`), a
 * landed spec still holds a worktree (`stale-worktree`), or the landing branch
 * itself has unpushed commits. `--offline` skips the tracker; git facts stay
 * complete.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** The landing branch every spec is measured against. */
export const LANDING_BRANCH = 'main'

/** States that need a human. Everything else is either in progress or finished. */
export const DEFECTS = Object.freeze(['unpushed', 'orphan', 'stale-worktree'])

/**
 * Run a command, returning trimmed stdout or undefined when it fails.
 *
 * Failures are data here: a missing remote branch and an unreachable tracker
 * are findings, not exceptions, so nothing below throws on them.
 * @param {string} file
 * @param {string[]} args
 * @param {{cwd?: string, timeout?: number}} [options]
 * @returns {string|undefined}
 */
function run(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: options.timeout ?? 20_000,
    }).trim()
  } catch {
    return undefined
  }
}

function git(root, args) {
  return run('git', args, { cwd: root })
}

/**
 * Spec issue states from the tracker, in one query.
 *
 * One request per run rather than one per spec: the wave burned minutes on
 * `gh issue view` loops. Returns undefined when the tracker is unreachable so
 * the report degrades to git-only facts instead of failing.
 * @param {string} root
 * @returns {Map<number, {state: string, title: string}>|undefined}
 */
export function readTracker(root) {
  const raw = run('gh', ['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,state'], {
    cwd: root,
    timeout: 60_000,
  })
  if (raw === undefined) return undefined
  try {
    return new Map(JSON.parse(raw).map(issue => [issue.number, { state: issue.state, title: issue.title }]))
  } catch {
    return undefined
  }
}

/** The spec numbers the checkout knows: ticket-copy directories and spec branches. */
export function specsInCheckout(root) {
  const specs = new Set()
  const tickets = resolve(root, 'work', 'tickets')
  if (existsSync(tickets)) {
    for (const entry of readdirSync(tickets, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/u.test(entry.name)) specs.add(Number(entry.name))
    }
  }
  const branches = git(root, ['for-each-ref', '--format=%(refname:short)',
    'refs/heads/integration/', 'refs/remotes/origin/integration/']) ?? ''
  for (const branch of branches.split('\n')) {
    // A spec branch that exists only on origin is still a spec this checkout
    // knows about; without this, a completed-but-unfetched spec disappears from
    // the report and the command still prints "no spec needs attention".
    const match = /^(?:origin\/)?integration\/spec-(\d+)$/u.exec(branch.trim())
    if (match !== null) specs.add(Number(match[1]))
  }
  return specs
}

/** Worktree paths, excluding the main checkout itself. */
export function worktrees(root) {
  const out = git(root, ['worktree', 'list', '--porcelain']) ?? ''
  const main = git(root, ['rev-parse', '--show-toplevel'])
  return out.split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length))
    .filter(path => path !== main)
}

/** Whether a worktree path names this spec, directly or as one of its tickets. */
export function worktreeNamesSpec(path, spec) {
  const name = path.split('/').pop() ?? ''
  return name === `spec-${spec}` || name.startsWith(`spec-${spec}-`) || name.startsWith(`${spec}-`)
}

/** Whether the branch tip carries the spec's ticket copies. */
function carriesCopies(root, ref, spec) {
  return git(root, ['cat-file', '-e', `${ref}:work/tickets/${spec}`]) !== undefined
}

/**
 * One spec's facts.
 *
 * `state` is the single answer a reader needs: `unpushed` (local-only work),
 * `stale-worktree` (landed but the worktree remains), `in-flight` (pushed, not
 * yet landed), `landed` (merged into the landing branch), or `planned` (no
 * branch yet — the spec has ticket copies only).
 * @param {number} spec
 * @param {{root: string, tracker?: Map<number, object>|undefined, worktrees: string[]}} context
 */
export function specStatus(spec, context) {
  const { root, tracker } = context
  const branch = `integration/spec-${spec}`
  const local = git(root, ['rev-parse', '--verify', `refs/heads/${branch}`])
  const hasBranch = local !== undefined
  const remote = git(root, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])
  const orphan = !hasBranch && remote !== undefined
  const pushed = hasBranch && remote !== undefined && remote === local
  // The landing fact follows whichever ref exists: a remote-only branch can be
  // landed on origin even when this checkout never fetched the local branch.
  const landedRef = hasBranch ? branch : orphan ? `refs/remotes/origin/${branch}` : undefined
  const landed = landedRef !== undefined
    && git(root, ['merge-base', '--is-ancestor', landedRef, LANDING_BRANCH]) !== undefined
  const leftover = context.worktrees.filter(path => worktreeNamesSpec(path, spec))
  const tracked = tracker?.get(spec)

  let state = 'planned'
  if (hasBranch) state = pushed ? (landed ? 'landed' : 'in-flight') : 'unpushed'
  else if (orphan) state = landed ? 'landed' : 'orphan'
  if (landed && leftover.length > 0) state = 'stale-worktree'

  return {
    spec,
    state,
    defect: DEFECTS.includes(state),
    title: tracked?.title,
    issue: tracked?.state,
    branch: hasBranch ? branch : null,
    tip: hasBranch ? git(root, ['rev-parse', '--short', branch]) : null,
    pushed,
    landed,
    ahead: hasBranch ? Number(git(root, ['rev-list', '--count', `${LANDING_BRANCH}..${branch}`]) ?? 0) : 0,
    copies: carriesCopies(root, hasBranch ? branch : LANDING_BRANCH, spec),
    worktrees: leftover,
  }
}

/** Whether a branch carries commits origin does not have, or the reverse. */
export function branchDrift(root, branches = ['main', LANDING_BRANCH]) {
  return branches.map(branch => {
    const ahead = git(root, ['rev-list', '--count', `origin/${branch}..${branch}`])
    const behind = git(root, ['rev-list', '--count', `${branch}..origin/${branch}`])
    return {
      branch,
      ahead: ahead === undefined ? null : Number(ahead),
      behind: behind === undefined ? null : Number(behind),
    }
  })
}

/**
 * Build the report.
 *
 * `tracker` is injectable so tests can pin the tracker half without network;
 * when omitted the real tracker is queried unless `offline` is set.
 * @param {{root?: string, offline?: boolean, specs?: number[], tracker?: Map<number, object>}} [options]
 */
export function collect({ root = repoRoot, offline = false, specs = [], tracker } = {}) {
  const resolved = tracker ?? (offline ? undefined : readTracker(root))
  const known = specsInCheckout(root)
  const wanted = specs.length === 0 ? [...known] : specs
  const paths = worktrees(root)
  const context = { root, tracker: resolved, worktrees: paths }
  const rows = wanted.sort((a, b) => a - b).map(number => specStatus(number, context))
  const orphanWorktrees = paths.filter(path => ![...known].some(spec => worktreeNamesSpec(path, spec)))
  return {
    tracker: offline ? 'skipped' : resolved === undefined ? 'unavailable' : 'ok',
    landing: branchDrift(root),
    rows,
    orphanWorktrees,
    defects: rows.filter(row => row.defect),
  }
}

/** Human-readable table; columns are the facts `state` is derived from. */
export function render(report) {
  const head = ['spec', 'state', 'branch', 'tip', 'push', 'land', 'ahead', 'copies', 'worktree', 'issue']
  const cells = report.rows.map(row => [
    String(row.spec),
    row.state,
    row.branch ?? '-',
    row.tip ?? '-',
    row.branch === null ? '-' : row.pushed ? 'ok' : 'MISSING',
    row.branch === null ? '-' : row.landed ? 'ok' : '-',
    String(row.ahead),
    row.copies ? 'ok' : 'MISSING',
    String(row.worktrees.length),
    row.issue ?? '?',
  ])
  const widths = head.map((title, index) => Math.max(title.length, ...cells.map(row => row[index].length)))
  const line = row => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()
  const lines = [`tracker: ${report.tracker}`, '', line(head), ...cells.map(line)]

  for (const { branch, ahead, behind } of report.landing) {
    if (ahead === null || behind === null) lines.push('', `branch: ${branch} has no origin counterpart`)
    else if (ahead > 0 || behind > 0) lines.push('', `branch: ${branch} is ${ahead} ahead / ${behind} behind origin`)
  }

  if (report.orphanWorktrees.length > 0) {
    lines.push('', 'worktrees naming no known spec:')
    for (const path of report.orphanWorktrees) lines.push(`  ${path}`)
  }

  lines.push('')
  const drifting = report.landing.filter(entry => entry.ahead !== null && entry.ahead > 0)
  const needsAttention = report.defects.length + drifting.length
  lines.push(needsAttention === 0
    ? 'specs-status: no spec needs attention'
    : `specs-status: ${needsAttention} need attention — `
      + [...report.defects.map(row => `#${row.spec} ${row.state}`), ...drifting.map(entry => `${entry.branch} ahead of origin`)].join(', '))
  return lines.join('\n')
}

function parseArgs(argv) {
  const options = { offline: false, specs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--offline') options.offline = true
    else if (arg === '--spec') {
      const value = Number(argv[index + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--spec takes a ticket number')
      options.specs.push(value)
      index += 1
    } else if (arg === '--help') return undefined
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`specs-status: ${error.message}\n`)
    process.exitCode = 2
    return
  }
  if (options === undefined) {
    process.stdout.write('usage: node scripts/specs-status.mjs [--json] [--offline] [--spec <n>...]\n')
    return
  }
  const report = collect(options)
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : render(report)}\n`)
  const drift = report.landing.some(entry => entry.ahead !== null && entry.ahead > 0)
  if (report.defects.length > 0 || drift) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
