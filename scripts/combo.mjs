#!/usr/bin/env node
/**
 * The OurFairy v1 version combination.
 *
 * `verify` asserts that every checkout the product consumes is at the exact
 * commit combo.json locks, and reports the research upstream SHAs separately
 * so an upstream commit can never be mistaken for a product deliverable.
 * A missing checkout or a drifted commit is a hard failure with a named
 * remedy, never a warning.
 *
 * Usage:
 *   node scripts/combo.mjs verify [--json] [--allow-drift]
 *   node scripts/combo.mjs show [--json]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/** Environment override per repository key; the default is combo.json's localPath. */
const PATH_OVERRIDES = {
  ourfairy: 'OURFAIRY_REPO_DIR',
  dsh: 'OURFAIRY_DSH_DIR',
  rikkahub: 'OURFAIRY_RIKKAHUB_DIR',
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

/** Resolve one repo's checkout path, honoring the environment override. */
export function repoPath(combo, key) {
  const override = PATH_OVERRIDES[key]
  const fromEnv = override === undefined ? undefined : process.env[override]
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  return resolve(combo.repos[key].localPath)
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

/**
 * Verify every locked checkout.
 * @returns {{ok: boolean, rows: object[], failures: string[]}}
 */
export function verifyCombination({ root = repoRoot, allowDrift = false } = {}) {
  const { combo } = readCombo(root)
  const rows = []
  const failures = []
  for (const [key, entry] of Object.entries(combo.repos)) {
    const path = repoPath(combo, key)
    const envName = PATH_OVERRIDES[key]
    const locked = entry.productCommit
    if (!existsSync(join(path, '.git'))) {
      const failure = `${key}: checkout missing at ${path}${envName === undefined ? '' : ` (override ${envName})`}`
      failures.push(failure)
      rows.push({ key, role: entry.role, path, branch: entry.integrationBranch, locked, actual: null, ok: false, failure })
      continue
    }
    const actual = revParse(path, entry.integrationBranch)
    if (actual === undefined) {
      const failure = `${key}: branch ${entry.integrationBranch} not found in ${path};`
        + ` run 'git -C ${path} fetch ${entry.remoteName ?? 'origin'} ${entry.integrationBranch}'`
      failures.push(failure)
      rows.push({ key, role: entry.role, path, branch: entry.integrationBranch, locked, actual: null, ok: false, failure })
      continue
    }
    const ok = actual === locked
    const row = {
      key,
      role: entry.role,
      path,
      branch: entry.integrationBranch,
      locked,
      actual,
      ok,
      researchUpstreamSha: entry.researchUpstreamSha ?? null,
      productHasOwnCommits: entry.researchUpstreamSha !== null && actual !== entry.researchUpstreamSha,
    }
    if (!ok) {
      const failure = `${key}: ${entry.integrationBranch} is ${actual} but combo.json locks ${locked};`
        + ` run 'git -C ${path} checkout ${locked}' (or update combo.json when the combination intentionally moves)`
      row.failure = failure
      failures.push(failure)
    }
    rows.push(row)
  }
  return { ok: failures.length === 0 || allowDrift, failures, rows }
}

function printTable(rows) {
  const header = ['repo', 'branch', 'locked', 'actual', 'result']
  const table = rows.map((row) => [
    row.key,
    row.branch,
    row.locked === null ? '-' : row.locked.slice(0, 12),
    row.actual === null ? 'MISSING' : row.actual.slice(0, 12),
    row.ok
      ? `ok${row.researchUpstreamSha !== null && !row.productHasOwnCommits ? ' (research upstream only; no product commits yet)' : ''}`
      : 'MISMATCH',
  ])
  const widths = header.map((cell, index) => Math.max(cell.length, ...table.map(row => row[index].length)))
  const line = cells => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ')
  return [line(header), line(widths.map(width => '-'.repeat(width))), ...table.map(line)].join('\n')
}

function printShow(combo) {
  const lines = [`combination: ${combo.product} (schemaVersion ${combo.schemaVersion})`]
  for (const [key, entry] of Object.entries(combo.repos)) {
    lines.push(`${key} (${entry.role})`)
    lines.push(`  path                  ${repoPath(combo, key)}`)
    lines.push(`  fork remote           ${entry.remoteName ?? 'origin'} ${entry.remoteUrl ?? ''}`.trimEnd())
    lines.push(`  integration branch    ${entry.integrationBranch}`)
    lines.push(`  productCommit         ${entry.productCommit}`)
    lines.push(`  researchUpstreamSha   ${entry.researchUpstreamSha ?? '(not applicable)'}`
      + `${entry.researchUpstreamRef === undefined ? '' : ` @ ${entry.researchUpstreamRef}`}`)
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
