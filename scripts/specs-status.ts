#!/usr/bin/env node
/**
 * The one view of where every spec and non-spec integration batch stands.
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
 *   node scripts/specs-status.ts [--json] [--offline] [--spec <n>...]
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
import { isCliEntry } from './cli-guard.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** The landing branch every spec is measured against. */
export const LANDING_BRANCH = 'main'

/** The state a spec can be in. */
export type SpecState = 'planned' | 'unpushed' | 'in-flight' | 'landed' | 'orphan' | 'stale-worktree'

/** The tracker half of the report: spec number to issue facts. */
export type TrackerFacts = Map<number, { state: string; title: string }>

type Worktree = { path: string; branch: string | null }

/** What one spec's facts are read from. */
export type SpecContext = {
  root: string
  tracker: TrackerFacts | undefined
  worktrees: Array<string | Worktree>
}

type BranchRow = {
  state: SpecState
  defect: boolean
  branch: string | null
  tip: string | null | undefined
  pushed: boolean
  merged: boolean
  contentLanded: boolean
  landed: boolean
  ahead: number
  worktrees: string[]
}

/** One spec's facts, as the report prints them. */
export type SpecRow = BranchRow & {
  spec: number
  title: string | undefined
  issue: string | undefined
  copies: boolean
}

/** A non-spec integration branch, identified by its real branch name. */
export type BatchRow = BranchRow & { name: string }

type ReportRow = SpecRow | BatchRow

/** How one branch stands against its origin counterpart. */
export type BranchDrift = { branch: string; ahead: number | null; behind: number | null }

/** The whole report. */
export type SpecReport = {
  tracker: 'skipped' | 'unavailable' | 'ok'
  landing: BranchDrift[]
  rows: SpecRow[]
  batchRows: BatchRow[]
  orphanWorktrees: string[]
  defects: ReportRow[]
}

/** The command's options, as argv carries them. */
export type SpecsStatusOptions = { offline: boolean; specs: number[]; json?: boolean }

/** States that need a human. Everything else is either in progress or finished. */
export const DEFECTS = Object.freeze(['unpushed', 'orphan', 'stale-worktree'])

/**
 * Run a command, returning trimmed stdout or undefined when it fails.
 *
 * Failures are data here: a missing remote branch and an unreachable tracker
 * are findings, not exceptions, so nothing below throws on them.
 * @param file
 * @param args
 * @param [options]
 * @returns
 */
function run(file: string, args: string[], options: { cwd?: string; timeout?: number } = {}): string | undefined {
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

function git(root: string, args: string[]): string | undefined {
  return run('git', args, { cwd: root })
}

/**
 * Spec issue states from the tracker, in one query.
 *
 * One request per run rather than one per spec: the wave burned minutes on
 * `gh issue view` loops. Returns undefined when the tracker is unreachable so
 * the report degrades to git-only facts instead of failing.
 * @param root
 * @returns
 */
export function readTracker(root: string): TrackerFacts | undefined {
  const raw = run('gh', ['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,state'], {
    cwd: root,
    timeout: 60_000,
  })
  if (raw === undefined) return undefined
  try {
    // The tracker answers with the three fields the query asked for.
    return new Map(JSON.parse(raw).map((issue: { number: number; state: string; title: string }) => [issue.number, { state: issue.state, title: issue.title }]))
  } catch {
    return undefined
  }
}

/** All local and fetched integration branches, without duplicate remote names. */
function integrationBranches(root: string): string[] {
  const branches = git(root, ['for-each-ref', '--format=%(refname:short)',
    'refs/heads/integration/', 'refs/remotes/origin/integration/']) ?? ''
  return [...new Set(branches.split('\n').map(branch => branch.trim().replace(/^origin\//u, ''))
    .filter(branch => branch.startsWith('integration/')))]
}

/** The spec numbers the checkout knows: ticket-copy directories and spec branches. */
export function specsInCheckout(root: string): Set<number> {
  const specs = new Set<number>()
  const tickets = resolve(root, 'work', 'tickets')
  if (existsSync(tickets)) {
    for (const entry of readdirSync(tickets, { withFileTypes: true })) {
      if (entry.isDirectory() && /^\d+$/u.test(entry.name)) specs.add(Number(entry.name))
    }
  }
  for (const branch of integrationBranches(root)) {
    // A spec branch that exists only on origin is still a spec this checkout
    // knows about; without this, a completed-but-unfetched spec disappears from
    // the report and the command still prints "no spec needs attention".
    const match = /^integration\/spec-(\d+)$/u.exec(branch)
    if (match !== null) specs.add(Number(match[1]))
  }
  return specs
}

/** Read worktrees and their actual branches, excluding the main checkout. */
function readWorktrees(root: string): Worktree[] {
  const out = git(root, ['worktree', 'list', '--porcelain']) ?? ''
  // Git lists the main checkout first, regardless of the caller's worktree.
  return out.split('\n\n').slice(1).flatMap(block => {
    const lines = block.split('\n')
    const pathLine = lines.find(line => line.startsWith('worktree '))
    if (pathLine === undefined) return []
    const branchLine = lines.find(line => line.startsWith('branch refs/heads/'))
    return [{
      path: pathLine.slice('worktree '.length),
      branch: branchLine === undefined ? null : branchLine.slice('branch refs/heads/'.length),
    }]
  })
}

/** Worktree paths, excluding the main checkout itself. */
export function worktrees(root: string): string[] {
  return readWorktrees(root).map(entry => entry.path)
}

/** Whether a worktree path names this spec, directly or as one of its tickets. */
export function worktreeNamesSpec(path: string, spec: number): boolean {
  const name = path.split('/').pop() ?? ''
  return name === `spec-${spec}` || name.startsWith(`spec-${spec}-`) || name.startsWith(`${spec}-`)
}

/** Associate real worktrees by integration or ticket branch; retain names for detached or injected entries. */
function associatedWorktrees(branch: string, spec: number | undefined, entries: Array<string | Worktree>): string[] {
  return entries.filter(entry => {
    if (typeof entry === 'string') return spec !== undefined && worktreeNamesSpec(entry, spec)
    if (entry.branch !== null) {
      return entry.branch === branch
        || (spec !== undefined && entry.branch.startsWith(`ticket/${spec}-`))
    }
    return spec !== undefined && worktreeNamesSpec(entry.path, spec)
  }).map(entry => typeof entry === 'string' ? entry : entry.path)
}

/** Whether the branch tip carries the spec's ticket copies. */
function carriesCopies(root: string, ref: string, spec: number): boolean {
  return git(root, ['cat-file', '-e', `${ref}:work/tickets/${spec}`]) !== undefined
}

/** Whether merging the ref would leave the landing tree unchanged. */
function contentLanded(root: string, ref: string | undefined): boolean {
  if (ref === undefined) return false
  const mergedTree = git(root, ['merge-tree', '--write-tree', LANDING_BRANCH, ref])
  const landingTree = git(root, ['rev-parse', `${LANDING_BRANCH}^{tree}`])
  // merge-tree exits non-zero on conflicts; run() turns that into no result.
  return mergedTree !== undefined && landingTree !== undefined && mergedTree === landingTree
}

/** Read the branch facts shared by specs and non-spec integration batches. */
function branchStatus(branch: string, context: SpecContext, spec?: number): BranchRow {
  const { root } = context
  const local = git(root, ['rev-parse', '--verify', `refs/heads/${branch}`])
  const hasBranch = local !== undefined
  const remote = git(root, ['rev-parse', '--verify', `refs/remotes/origin/${branch}`])
  const orphan = !hasBranch && remote !== undefined
  const pushed = hasBranch && remote !== undefined && remote === local
  // The landing fact follows whichever ref exists: a remote-only branch can be
  // landed on origin even when this checkout never fetched the local branch.
  const landedRef = hasBranch ? branch : orphan ? `refs/remotes/origin/${branch}` : undefined
  const merged = landedRef !== undefined
    && git(root, ['merge-base', '--is-ancestor', landedRef, LANDING_BRANCH]) !== undefined
  const content = contentLanded(root, landedRef)
  // Keep the old overall field while exposing why the branch is landed.
  const landed = merged || content
  const leftover = associatedWorktrees(branch, spec, context.worktrees)

  let state: SpecState = 'planned'
  if (hasBranch) state = pushed ? (landed ? 'landed' : 'in-flight') : 'unpushed'
  else if (orphan) state = landed ? 'landed' : 'orphan'
  if (landed && leftover.length > 0) state = 'stale-worktree'

  return {
    state,
    defect: DEFECTS.includes(state),
    branch: hasBranch ? branch : null,
    tip: hasBranch ? git(root, ['rev-parse', '--short', branch]) : null,
    pushed,
    merged,
    contentLanded: content,
    landed,
    ahead: hasBranch ? Number(git(root, ['rev-list', '--count', `${LANDING_BRANCH}..${branch}`]) ?? 0) : 0,
    worktrees: leftover,
  }
}

/** One spec's branch facts plus its ticket copies and tracker facts. */
export function specStatus(spec: number, context: SpecContext): SpecRow {
  const branch = `integration/spec-${spec}`
  const tracked = context.tracker?.get(spec)
  const status = branchStatus(branch, context, spec)
  return {
    ...status,
    spec,
    title: tracked?.title,
    issue: tracked?.state,
    copies: carriesCopies(context.root, status.branch ?? LANDING_BRANCH, spec),
  }
}

function batchStatus(branch: string, context: SpecContext): BatchRow {
  return { name: branch.slice('integration/'.length), ...branchStatus(branch, context) }
}

/** Whether a branch carries commits origin does not have, or the reverse. */
export function branchDrift(root: string, branches: string[] = [LANDING_BRANCH]): BranchDrift[] {
  return [...new Set(branches)].map(branch => {
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
 * @param [options]
 */
export function collect({ root = repoRoot, offline = false, specs = [], tracker }: { root?: string; offline?: boolean; specs?: number[]; tracker?: TrackerFacts } = {}): SpecReport {
  const resolved = tracker ?? (offline ? undefined : readTracker(root))
  const known = specsInCheckout(root)
  const wanted = specs.length === 0 ? [...known] : specs
  const entries = readWorktrees(root)
  const paths = entries.map(entry => entry.path)
  const context = { root, tracker: resolved, worktrees: entries }
  const rows = wanted.sort((a, b) => a - b).map(number => specStatus(number, context))
  const batchRows = integrationBranches(root)
    .filter(branch => !/^integration\/spec-\d+$/u.test(branch))
    .sort()
    .map(branch => batchStatus(branch, context))
  const associated = new Set(batchRows.flatMap(row => row.worktrees))
  for (const spec of known) {
    for (const path of associatedWorktrees(`integration/spec-${spec}`, spec, entries)) associated.add(path)
  }
  const orphanWorktrees = paths.filter(path => !associated.has(path))
  return {
    tracker: offline ? 'skipped' : resolved === undefined ? 'unavailable' : 'ok',
    landing: branchDrift(root),
    rows,
    batchRows,
    orphanWorktrees,
    defects: [...rows, ...batchRows].filter(row => row.defect),
  }
}

/** Human-readable table; columns are the facts `state` is derived from. */
export function render(report: SpecReport): string {
  const head = ['spec/batch', 'state', 'branch', 'tip', 'push', 'merged', 'content', 'land', 'ahead', 'copies', 'worktree', 'issue']
  const tableRows: Array<{ label: string; row: ReportRow }> = [
    ...report.rows.map(row => ({ label: String(row.spec), row })),
    ...report.batchRows.map(row => ({ label: row.name, row })),
  ]
  const cells = tableRows.map(({ label, row }) => [
    label,
    row.state,
    row.branch ?? '-',
    row.tip ?? '-',
    row.branch === null ? '-' : row.pushed ? 'ok' : 'MISSING',
    row.branch === null ? '-' : row.merged ? 'ok' : '-',
    row.branch === null ? '-' : row.contentLanded ? 'ok' : '-',
    row.branch === null ? '-' : row.landed ? 'ok' : '-',
    String(row.ahead),
    'spec' in row ? row.copies ? 'ok' : 'MISSING' : '-',
    String(row.worktrees.length),
    'spec' in row ? row.issue ?? '?' : '-',
  ])
  // Every row has one cell per column, so the widths and the cells line up.
  const widths = head.map((title, index) => Math.max(title.length, ...cells.map(row => row[index]!.length)))
  const line = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd()
  const lines = [`tracker: ${report.tracker}`, '', line(head), ...cells.map(line)]

  for (const { branch, ahead, behind } of report.landing) {
    if (ahead === null || behind === null) lines.push('', `branch: ${branch} has no origin counterpart`)
    else if (ahead > 0 || behind > 0) lines.push('', `branch: ${branch} is ${ahead} ahead / ${behind} behind origin`)
  }

  if (report.orphanWorktrees.length > 0) {
    lines.push('', 'worktrees outside known integration branches:')
    for (const path of report.orphanWorktrees) lines.push(`  ${path}`)
  }

  lines.push('')
  const drifting = report.landing.filter(entry => entry.ahead !== null && entry.ahead > 0)
  const needsAttention = report.defects.length + drifting.length
  lines.push(needsAttention === 0
    ? 'specs-status: no spec needs attention'
    : `specs-status: ${needsAttention} need attention — `
      + [...report.defects.map(row => 'spec' in row ? `#${row.spec} ${row.state}` : `${row.name} ${row.state}`),
        ...drifting.map(entry => `${entry.branch} ahead of origin`)].join(', '))
  return lines.join('\n')
}

function parseArgs(argv: string[]): SpecsStatusOptions | undefined {
  const options: SpecsStatusOptions = { offline: false, specs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
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

function main(argv: string[]): void {
  let options: SpecsStatusOptions | undefined
  try {
    options = parseArgs(argv)
  } catch (error) {
    // The caught value is whatever the flag parser threw; the report only
    // reads its `message`, exactly as the pre-migration code did.
    process.stderr.write(`specs-status: ${(error as Error).message}\n`)
    process.exitCode = 2
    return
  }
  if (options === undefined) {
    process.stdout.write('usage: node scripts/specs-status.ts [--json] [--offline] [--spec <n>...]\n')
    return
  }
  const report = collect(options)
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : render(report)}\n`)
  const drift = report.landing.some(entry => entry.ahead !== null && entry.ahead > 0)
  if (report.defects.length > 0 || drift) process.exitCode = 1
}

if (isCliEntry(import.meta.main)) main(process.argv.slice(2))
