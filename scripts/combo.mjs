#!/usr/bin/env node
/**
 * The OurFairy v1 version combination.
 *
 * `verify` asserts that the combination this worktree builds against is the one
 * combo.json locks:
 *
 *   - `dsh` and `rikkahub` are external dependencies and are pinned to exact
 *     commits; a drifted checkout is a hard failure with the named remedy.
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
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
  return { ok: failures.length === 0 || allowDrift, failures, rows }
}

/**
 * The package a module specifier belongs to: `@scope/name` for both
 * `@scope/name` and `@scope/name/subpath`.
 * @param {string} specifier
 * @returns {string}
 */
export function packageOf(specifier) {
  return specifier.split('/').slice(0, 2).join('/')
}

/**
 * The npm scope a package name belongs to (`@scope/`), or undefined for an
 * unscoped name. Product rows are recognized by scope rather than by an
 * enumerated package list.
 * @param {string} name
 * @returns {string|undefined}
 */
function scopeOf(name) {
  return name.startsWith('@') ? `${name.split('/')[0]}/` : undefined
}

/**
 * Every entry of a composed tree, including the rows nested in a group's
 * `config` list. The loader mounts group children the same way it mounts
 * top-level rows, so a package set comparison that walked only the top level
 * would miss them.
 * @param {object[]} entries
 * @returns {object[]}
 */
export function flattenEntries(entries) {
  return entries.flatMap(entry => [
    entry,
    // The loader treats any truthy `group` with a list `config` as nesting.
    ...(entry.group && Array.isArray(entry.config) ? flattenEntries(entry.config) : []),
  ])
}

/**
 * The product packages actually installed in a profile, by the scope the bundle
 * name belongs to.
 *
 * The launcher configures a hoisted linker, so the installed copies sit directly
 * under `<profileDir>/node_modules/<scope>`. This is the installed set, not the
 * declared set: a directory that no manifest declares still counts as installed
 * and must be reported.
 * @param {string} profileDir
 * @param {string} bundlePackage
 * @returns {string[]} package names, sorted.
 */
function installedProductPackages(profileDir, bundlePackage) {
  const scope = scopeOf(bundlePackage)
  if (scope === undefined) return []
  const dir = join(profileDir, 'node_modules', scope)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(entry => `${scope}${entry.name}`)
    .sort()
}

/**
 * Load the installed bundle layer through dsh's own profile reader.
 *
 * Both checks read the installation the launcher generated: the bundle layer
 * dsh selected, its skip reason when it selected none, and the app-boot module
 * whose public exports read manifests and judge compatibility. Loading it in
 * one place keeps the package set and the compatibility judgement from reading
 * two different installations.
 * @param {{
 *   binName: string,
 *   bundlePackage: string,
 *   installAnchor: string,
 *   profileDir: string,
 * }} options
 * @returns {{boot: any, layer: object|undefined, skipped: object|undefined}}
 */
function installedBundle({ binName, bundlePackage, installAnchor, profileDir }) {
  const boot = createRequire(installAnchor)('@deepseek-ai/dsh-app-boot')
  const profile = boot.loadProfileDirectory(binName, profileDir, installAnchor)
  return {
    boot,
    layer: profile.layers.find(entry => entry.packageName === bundlePackage),
    skipped: profile.skippedBundles.find(entry => entry.packageName === bundlePackage),
  }
}

/**
 * Compare the bundle's patch rows with the product packages it declares and
 * with the packages the generated profile installs.
 *
 * The bundle's `dependencies` are the product package inventory: the profile
 * derives its product dependencies from them (plus the probe, which the bundle
 * never mounts). This reads the composed rows through dsh's own patch loader
 * (never a YAML parse of our own), the declared set from the installed bundle
 * manifest, and the installed set through dsh's own bundle resolution — so the
 * answer cannot disagree with what a boot reads. Which rows count as product
 * rows follows from the scopes of those same names, so adding a package to the
 * manifest cannot make a mounted row invisible to the comparison.
 *
 * A row mounts one module specifier. Subpath exports (`@ourfairy/x/y`) are
 * distinct modules of one declared package, so a package may contribute
 * several rows (the spaces package contributes six today), but the same
 * specifier twice is a duplicate mount. This is #96's "one row per package"
 * wording read after #101, which split one capability into several rows of the
 * same package. Every declared package must also resolve as installed in the
 * profile, which is what makes the bundle's declaration the set the launcher
 * installs.
 *
 * The installed set is enumerated from the profile itself (the launcher uses a
 * hoisted linker, so `<profileDir>/node_modules/<scope>/*`), not inferred from
 * the declaration: a package present there but absent from the expected set
 * (the bundle, the probe, or a declared dependency) is a package the profile
 * boots with that no manifest owns, and it fails here by name.
 * @param {{
 *   binName: string,
 *   bundlePackage: string,
 *   probePackage: string,
 *   installAnchor: string,
 *   profileDir: string,
 * }} options
 * @returns {{ok: boolean, declared: string[], mounted: {id: string, name: string, package: string}[], failures: string[]}}
 */
export function verifyBundlePackages({ binName, bundlePackage, probePackage, installAnchor, profileDir }) {
  // Loaded the same way the launcher boots: the profile's bundle layer, the
  // patches it declares, and the rows composed from them.
  const { boot, layer, skipped } = installedBundle({ binName, bundlePackage, installAnchor, profileDir })
  const failures = []
  if (skipped !== undefined) {
    failures.push(`${bundlePackage} was not loaded from ${profileDir}: ${skipped.reason}`)
  }
  if (layer === undefined) {
    if (skipped === undefined) failures.push(`${bundlePackage} is not a loaded bundle of ${profileDir}`)
    return { ok: false, declared: [], mounted: [], failures }
  }

  const manifest = boot.readProfileManifest(binName, layer.packageDir)
  const declared = Object.keys(manifest.dependencies ?? {}).sort()
  const rows = flattenEntries(boot.composeEntries([layer.patches]))
  // Product rows share a scope with the bundle's own package or with a declared
  // package. Taking that scope from the data, not from a package list, is what
  // lets a row mounting an undeclared product package be reported rather than
  // silently ignored.
  const productScopes = new Set([bundlePackage, ...declared].map(scopeOf).filter(scope => scope !== undefined))

  const mounted = rows
    .filter(row => typeof row.name === 'string' && [...productScopes].some(scope => row.name.startsWith(scope)))
    .map(row => ({ id: String(row.id), name: row.name, package: packageOf(row.name) }))

  const declaredSet = new Set(declared)
  const mountedPackages = new Set()
  const seen = new Map()
  for (const row of mounted) {
    if (!declaredSet.has(row.package)) {
      failures.push(`bundle row "${row.id}" mounts ${row.name}, but ${bundlePackage} does not declare ${row.package}`)
    }
    mountedPackages.add(row.package)
    const ids = seen.get(row.name) ?? []
    ids.push(row.id)
    seen.set(row.name, ids)
  }
  for (const [name, ids] of seen) {
    if (ids.length > 1) {
      failures.push(`bundle rows ${ids.map(id => `"${id}"`).join(' and ')} both mount ${name} (${packageOf(name)}); a module specifier may be mounted once`)
    }
  }
  for (const name of declared) {
    if (!mountedPackages.has(name)) {
      failures.push(`${bundlePackage} declares ${name}, but no bundle row mounts it`)
    }
    try {
      boot.resolveBundleDir(binName, name, installAnchor, profileDir)
    } catch (error) {
      failures.push(`${bundlePackage} declares ${name}, but it is not installed in ${profileDir};`
        + ` run 'ourfairy-backend start --reinstall': ${error.message}`)
    }
  }
  // The expected set is what the launcher installs: the bundle itself, the
  // test-only probe it never mounts, and the bundle manifest's dependencies.
  const expected = new Set([bundlePackage, probePackage, ...declared])
  for (const name of installedProductPackages(profileDir, bundlePackage)) {
    if (!expected.has(name)) {
      failures.push(`${name} is installed in ${profileDir}, but ${bundlePackage} does not declare it`)
    }
  }

  return { ok: failures.length === 0, declared, mounted, failures }
}

/**
 * Judge every product package installed in the profile, dsh peers against the
 * runtime the pinned CLI provides.
 *
 * The judgement is dsh's own public `evaluatePluginCompatibility`, given the
 * runtime version `getDshRuntimeVersion` reads from the same app-boot module —
 * not a range comparison implemented here. The set judged is the installed one
 * (`<profileDir>/node_modules/<scope>/*`), not just the bundle's declaration: a
 * package the profile installed without a declaration is still judged, and the
 * declaration/installation comparison stays in the bundle-packages check. The
 * manifests are the installed copies the dsh loader reads, resolved through the
 * profile, so the answer is about what would boot.
 * `evaluatePluginCompatibility` judges only dsh peers (`@deepseek-ai/dsh` and
 * `@deepseek-ai/dsh-*`); a product package's other peers are declarations for
 * readers and pnpm, not inputs to this runtime decision. The bundle and the
 * probe are included: they declare no peers, so the judgement is a no-op for
 * them, but a reader sees every installed product package accounted for.
 * @param {{
 *   binName: string,
 *   bundlePackage: string,
 *   installAnchor: string,
 *   profileDir: string,
 * }} options
 * @returns {{ok: boolean, dshVersion: string, checked: string[], failures: string[]}}
 */
export function verifyPluginCompatibility({ binName, bundlePackage, installAnchor, profileDir }) {
  const { boot, layer, skipped } = installedBundle({ binName, bundlePackage, installAnchor, profileDir })
  const dshVersion = boot.getDshRuntimeVersion()
  const failures = []
  if (skipped !== undefined) {
    failures.push(`${bundlePackage} was not loaded from ${profileDir}: ${skipped.reason}`)
  }
  if (layer === undefined) {
    if (skipped === undefined) failures.push(`${bundlePackage} is not a loaded bundle of ${profileDir}`)
    return { ok: false, dshVersion, checked: [], failures }
  }

  const checked = []
  for (const name of installedProductPackages(profileDir, bundlePackage)) {
    let installed
    try {
      installed = boot.readProfileManifest(binName, boot.resolveBundleDir(binName, name, installAnchor, profileDir))
    } catch (error) {
      failures.push(`${name} is installed in ${profileDir} but its manifest is not readable: ${error.message}`)
      continue
    }
    const issue = boot.evaluatePluginCompatibility(installed, {}, dshVersion)
    if (issue !== undefined) {
      const peers = Object.entries(issue.peers).map(([peer, range]) => `${peer} ${range}`).join(', ')
      failures.push(`${name}@${issue.version} is incompatible with dsh ${dshVersion}: peerDependencies ${peers}`)
      continue
    }
    checked.push(`${name}@${installed.version}`)
  }
  return { ok: failures.length === 0, dshVersion, checked, failures }
}

function printTable(rows) {
  const header = ['repo', 'branch', 'expected', 'actual', 'result']
  const cells = rows.map((row) => [
    row.key,
    row.branch,
    row.expected === null || row.expected === undefined ? '-' : String(row.expected).slice(0, 16),
    row.actual === null || row.actual === undefined ? 'MISSING' : String(row.actual).slice(0, 16),
    row.ok
      ? (row.lock === 'integration-branch'
        ? `ok (worktree ${row.headIsTip ? 'is the integration tip' : 'is based on the integration tip'})`
        : `ok${row.researchUpstreamSha !== null && !row.productHasOwnCommits ? ' (research upstream only; no product commits yet)' : ''}`)
      : 'MISMATCH',
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
