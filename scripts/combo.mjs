#!/usr/bin/env node
/**
 * The OurFairy v1 version combination.
 *
 * `verify` asserts that the combination this worktree builds against is the one
 * combo.json locks:
 *
 *   - `dsh` is an external dependency pinned to an exact commit; a drifted
 *     checkout is a hard failure with the named remedy.
 *   - the Android client is inlined under `android/` and is not a repository in
 *     the combination. Its provenance is the in-repo declaration named by
 *     combo.json `androidSource`, checked against the recorded source commit.
 *   - `ourfairy` is the repository holding this file. Locking it to a fixed
 *     commit would be self-referential and would fail after every merge, so the
 *     locked object is the INTEGRATION BRANCH: verify asserts this worktree's
 *     HEAD is the branch tip or an ancestor of it, i.e. that the worktree really
 *     is based on the combination.
 *
 * The research upstream SHA is reported separately and is never a product
 * deliverable.
 *
 * Usage:
 *   node scripts/combo.mjs verify [--json] [--allow-drift]
 *   node scripts/combo.mjs show [--json]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** Environment override per repository key; the default is combo.json's localPath. */
const PATH_OVERRIDES = {
  ourfairy: 'OURFAIRY_REPO_DIR',
  dsh: 'OURFAIRY_DSH_DIR',
}

/** Read combo.json. */
export function readCombo(root = repoRoot) {
  const path = join(root, 'combo.json')
  if (!existsSync(path)) throw new Error(`combo.json not found at ${path}`)
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.repos !== 'object') {
    throw new Error(`${path} must be an object with a repos map`)
  }
  return { combo: parsed, path }
}

/** The repo holding combo.json resolves to this checkout, not to combo.json's canonical path. */
function isSelfEntry(entry) {
  return entry.lock === 'integration-branch'
}

/** Resolve one repo's checkout path, honoring the environment override. */
export function repoPath(combo, key, root = repoRoot) {
  const override = PATH_OVERRIDES[key]
  const fromEnv = override === undefined ? undefined : process.env[override]
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  const entry = combo.repos[key]
  if (isSelfEntry(entry)) return root
  return resolve(entry.localPath)
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Resolve a local branch tip; undefined when the ref is absent. */
function revParse(path, ref) {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`], path)
  } catch {
    return undefined
  }
}

function isAncestor(path, ancestor, descendant) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: path, encoding: 'utf8' })
  return result.status === 0
}

/**
 * Verify the locked combination.
 * @returns {{ok: boolean, rows: object[], failures: string[]}}
 */
export function verifyCombination({ root = repoRoot, allowDrift = false } = {}) {
  const { combo } = readCombo(root)
  const rows = []
  const failures = []
  for (const [key, entry] of Object.entries(combo.repos)) {
    const path = repoPath(combo, key, root)
    const envName = PATH_OVERRIDES[key]
    const base = {
      key,
      role: entry.role,
      path,
      branch: entry.integrationBranch,
      lock: entry.lock ?? 'commit',
      researchUpstreamSha: entry.researchUpstreamSha ?? null,
    }
    if (!existsSync(join(path, '.git'))) {
      const failure = `${key}: checkout missing at ${path}${envName === undefined ? '' : ` (override ${envName})`}`
      failures.push(failure)
      rows.push({ ...base, expected: entry.productCommit ?? entry.integrationBranch, actual: null, ok: false, failure })
      continue
    }
    const tip = revParse(path, entry.integrationBranch)
    if (tip === undefined) {
      const failure = `${key}: branch ${entry.integrationBranch} not found in ${path};`
        + ` run 'git -C ${path} fetch ${entry.remoteName ?? 'origin'} ${entry.integrationBranch}'`
      failures.push(failure)
      rows.push({ ...base, expected: entry.productCommit ?? entry.integrationBranch, actual: null, ok: false, failure })
      continue
    }

    if (isSelfEntry(entry)) {
      // The current worktree must be the integration tip or based on it: the tip
      // is an ancestor of HEAD (HEAD may be ahead of the tip with ticket commits,
      // which is the normal state of a ticket branch before it is merged back).
      const head = revParse(path, 'HEAD')
      const ok = head !== undefined && (head === tip || isAncestor(path, tip, head))
      const row = {
        ...base,
        expected: `based on ${entry.integrationBranch}`,
        actual: head,
        integrationTip: tip,
        headIsTip: head === tip,
        ok,
      }
      if (!ok) {
        const failure = `${key}: worktree HEAD ${head} is not based on ${entry.integrationBranch} (${tip});`
          + ` run 'git -C ${path} merge ${entry.integrationBranch}' before finishing this ticket`
        row.failure = failure
        failures.push(failure)
      }
      rows.push(row)
      continue
    }

    const locked = entry.productCommit
    const ok = tip === locked
    const row = {
      ...base,
      expected: locked,
      actual: tip,
      productHasOwnCommits: entry.researchUpstreamSha !== null && tip !== entry.researchUpstreamSha,
      ok,
    }
    if (!ok) {
      const failure = `${key}: ${entry.integrationBranch} is ${tip} but combo.json locks ${locked};`
        + ` run 'git -C ${path} checkout ${locked}' (or update combo.json when the combination intentionally moves)`
      row.failure = failure
      failures.push(failure)
    }
    rows.push(row)
  }
  const android = androidSourceRow(root, combo.androidSource)
  rows.push(android)
  if (android.failure !== undefined) failures.push(android.failure)
  return { ok: failures.length === 0 || allowDrift, failures, rows }
}

/**
 * The android source row. The inlined client is not a repository in the cycle,
 * so its lock is the source commit combo.json records; the declaration under
 * `android/` restates it, and this check is what keeps the two equal.
 *
 * The copy case is why a missing declaration is a row rather than a throw:
 * doctor runs against copies that carry combo.json but not android/.
 */
function androidSourceRow(root, source) {
  const path = typeof source?.declaration === 'string' && source.declaration !== ''
    ? resolve(root, source.declaration)
    : null
  const expected = typeof source?.commit === 'string' ? source.commit : null
  const base = {
    key: 'android source',
    role: source?.role ?? null,
    path,
    branch: source?.branch ?? null,
    lock: 'declaration',
    expected,
  }
  const fail = (failure, actual = null) => ({ ...base, actual, ok: false, failure })
  const remedy = expected === null ? '' : `; set "commit" in ${path ?? 'the declaration'} to ${expected},`
    + ' or update combo.json androidSource.commit when the snapshot intentionally moves'

  if (path === null || expected === null) {
    return fail('android source: combo.json must declare androidSource.declaration and androidSource.commit')
  }
  if (!existsSync(path)) {
    return fail(`android source: declaration missing at ${path}; add it with "commit": "${expected}"`)
  }
  let declared
  try {
    declared = JSON.parse(readFileSync(path, 'utf8')).commit
  } catch (error) {
    return fail(`android source: ${path} must be JSON with a "commit" field: ${error.message}`)
  }
  if (declared === expected) return { ...base, actual: declared, ok: true }
  const actual = typeof declared === 'string' ? declared : null
  return fail(`android source: ${path} declares ${actual ?? JSON.stringify(declared)}`
    + ` but combo.json androidSource.commit is ${expected}${remedy}`, actual)
}

/** What the table's result column says for one row. */
function resultLabel(row) {
  if (!row.ok) return 'MISMATCH'
  if (row.lock === 'declaration') return 'ok (declaration matches)'
  if (row.lock === 'integration-branch') {
    return `ok (worktree ${row.headIsTip ? 'is the integration tip' : 'is based on the integration tip'})`
  }
  return `ok${row.researchUpstreamSha !== null && !row.productHasOwnCommits
    ? ' (research upstream only; no product commits yet)' : ''}`
}

function printTable(rows) {
  const header = ['row', 'branch', 'expected', 'actual', 'result']
  const cells = rows.map((row) => [
    row.key,
    row.branch,
    row.expected === null || row.expected === undefined ? '-' : String(row.expected).slice(0, 16),
    row.actual === null || row.actual === undefined ? 'MISSING' : String(row.actual).slice(0, 16),
    resultLabel(row),
  ])
  const widths = header.map((cell, index) => Math.max(cell.length, ...cells.map(row => row[index].length)))
  const line = row => row.map((cell, index) => cell.padEnd(widths[index])).join('  ')
  return [line(header), line(widths.map(width => '-'.repeat(width))), ...cells.map(line)].join('\n')
}

function printShow(combo) {
  const lines = [`combination: ${combo.product} (schemaVersion ${combo.schemaVersion})`]
  for (const [key, entry] of Object.entries(combo.repos)) {
    lines.push(`${key} (${entry.role}, lock: ${entry.lock ?? 'commit'})`)
    lines.push(`  path                  ${repoPath(combo, key)}`)
    lines.push(`  fork remote           ${entry.remoteName ?? 'origin'} ${entry.remoteUrl ?? ''}`.trimEnd())
    lines.push(`  integration branch    ${entry.integrationBranch}`)
    lines.push(entry.productCommit === undefined || entry.productCommit === null
      ? '  productCommit         (self repository: the integration branch tip is the lock)'
      : `  productCommit         ${entry.productCommit}`)
    lines.push(`  researchUpstreamSha   ${entry.researchUpstreamSha ?? '(not applicable)'}`
      + `${entry.researchUpstreamRef === undefined ? '' : ` @ ${entry.researchUpstreamRef}`}`)
  }
  if (combo.androidSource !== undefined) {
    const source = combo.androidSource
    lines.push(`android source (${source.role}, lock: declaration)`)
    lines.push(`  repository            ${source.repository}`)
    lines.push(`  remote                ${source.remoteUrl}`)
    lines.push(`  branch                ${source.branch}`)
    lines.push(`  commit                ${source.commit}`)
    lines.push(`  declaration           ${resolve(repoRoot, source.declaration)}`)
    lines.push(`  note                  ${source.note}`)
  }
  lines.push(`backend                 profile ${combo.backend.profileName}; bundle ${combo.backend.bundlePackage} (${combo.backend.bundlePathInRepo})`)
  lines.push(`launcher                ${combo.backend.launcher}; ${combo.backend.pnpmInvocation}`)
  return lines.join('\n')
}

function main(argv) {
  const args = argv.slice(2)
  const command = args.find(arg => !arg.startsWith('-')) ?? 'verify'
  const json = args.includes('--json')
  const allowDrift = args.includes('--allow-drift')
  const { combo } = readCombo()

  if (command === 'show') {
    process.stdout.write(`${json ? JSON.stringify(combo, undefined, 2) : printShow(combo)}\n`)
    return 0
  }
  if (command !== 'verify') {
    process.stderr.write(`combo: unknown command ${JSON.stringify(command)}; expected 'verify' or 'show'\n`)
    return 2
  }
  const result = verifyCombination({ allowDrift })
  if (json) {
    process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
  } else {
    process.stdout.write(`${printTable(result.rows)}\n`)
    for (const failure of result.failures) process.stderr.write(`combo: ${failure}\n`)
    process.stdout.write(result.failures.length === 0
      ? 'combo: combination verified\n'
      : `combo: ${result.failures.length} drift/missing entr${result.failures.length === 1 ? 'y' : 'ies'}${allowDrift ? ' (tolerated by --allow-drift)' : ''}\n`)
  }
  return result.failures.length === 0 || allowDrift ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv))
