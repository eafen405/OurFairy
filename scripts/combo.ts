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
 * The research upstream baselines are not part of the combination; they live in
 * docs/research/README.md.
 *
 * Usage:
 *   node scripts/combo.ts verify [--json] [--allow-drift]
 *   node scripts/combo.ts show [--json]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { PluginCompatibility, Profile, ProfileLayer, SkippedBundle } from '@deepseek-ai/dsh-app-boot'
import { admitBundleDependencies, readCombo } from './ourfairy-composition.ts'
import type { AdmissionRefusal, Combo, ComboAndroidSource, ComboRepo } from './ourfairy-composition.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..')

/**
 * Read combo.json. Owned by the composition module so the dependency direction
 * stays one-way (`combo.ts` -> composition); re-exported here because existing
 * callers import it from this module.
 */
export { readCombo }

/** Environment override per repository key; the default is combo.json's localPath. */
const PATH_OVERRIDES: Record<string, string> = {
  ourfairy: 'OURFAIRY_REPO_DIR',
  dsh: 'OURFAIRY_DSH_DIR',
}

/**
 * One row of the combination table.
 *
 * The rows are what the launcher and the doctor print, so the columns differ
 * per row: the android row has no branch, and the actual column carries
 * whatever the check compared against.
 */
export interface ComboRow {
  readonly key: string
  readonly role: string | null
  readonly path: string | null
  readonly lock: string
  readonly branch?: string | null
  readonly expected: string | null | undefined
  readonly actual: unknown
  readonly ok: boolean
  failure?: string
  readonly integrationTip?: string
  readonly headIsTip?: boolean
}

/**
 * The app-boot module's public surface, as the checks read it.
 *
 * The module is loaded through `createRequire` from the INSTALLED profile, not
 * from this repository's link farm, so the runtime copy is the one a boot
 * would read. The types are the pinned dsh checkout's, which is the package
 * the installed copy is.
 */
interface DshAppBoot {
  loadProfileDirectory(binName: string, dir: string, installAnchor: string): Profile
  readProfileManifest(binName: string, dir: string): { dependencies?: Record<string, unknown>; version?: string }
  composeEntries(layers: readonly PatchOptions[][]): EntryOptions[]
  resolveBundleDir(binName: string, packageName: string, installAnchor: string, profileDir: string): string
  getDshRuntimeVersion(): string
  evaluatePluginCompatibility(manifest: object, exemptions: object, runtimeVersion: string): PluginCompatibility | undefined
}

/** The installed profile's bundle layer, as the checks read it. */
interface InstalledBundle {
  readonly boot: DshAppBoot
  readonly profile: Profile
  readonly layer: ProfileLayer | undefined
  readonly skipped: SkippedBundle | undefined
}

/** The repo holding combo.json resolves to this checkout, not to combo.json's canonical path. */
function isSelfEntry(entry: ComboRepo): boolean {
  return entry.lock === 'integration-branch'
}

/** Resolve one repo's checkout path, honoring the environment override. */
export function repoPath(combo: Combo, key: string, root = repoRoot): string {
  const override = PATH_OVERRIDES[key]
  const fromEnv = override === undefined ? undefined : process.env[override]
  if (fromEnv !== undefined && fromEnv !== '') return resolve(fromEnv)
  // A key the recorded file does not carry has no entry; the assertion records
  // that the caller asks for a repository the combination declares.
  const entry = combo.repos[key]!
  if (isSelfEntry(entry)) return root
  return resolve(entry.localPath)
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Resolve a local branch tip; undefined when the ref is absent. */
function revParse(path: string, ref: string): string | undefined {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`], path)
  } catch {
    return undefined
  }
}

function isAncestor(path: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: path, encoding: 'utf8' })
  return result.status === 0
}

/**
 * Whether a worktree counts as based on the integration tip.
 *
 * A merge commit does not exist while its own commit gate runs: HEAD is still
 * the branch tip, which may predate the integration tip. The merge result
 * descends from both parents, so an incoming `MERGE_HEAD` that is based on the
 * tip gives the same guarantee.
 * @param path - repository to read refs from.
 * @param tip - integration tip commit.
 * @returns
 */
export function basedOnIntegration(path: string, tip: string): boolean {
  const head = revParse(path, 'HEAD')
  if (head === undefined) return false
  if (head === tip || isAncestor(path, tip, head)) return true
  const incoming = revParse(path, 'MERGE_HEAD')
  return incoming !== undefined && (incoming === tip || isAncestor(path, tip, incoming))
}

/**
 * Verify the locked combination.
 */
export function verifyCombination({ root = repoRoot, allowDrift = false }: { root?: string; allowDrift?: boolean } = {}): { ok: boolean; rows: ComboRow[]; failures: string[] } {
  const { combo } = readCombo(root)
  const rows: ComboRow[] = []
  const failures: string[] = []
  for (const [key, entry] of Object.entries(combo.repos)) {
    const path = repoPath(combo, key, root)
    const envName = PATH_OVERRIDES[key]
    const base = {
      key,
      role: entry.role,
      path,
      branch: entry.integrationBranch,
      lock: entry.lock ?? 'commit',
    }
    if (!existsSync(join(path, '.git'))) {
      const failure = `${key}: checkout missing at ${path}${envName === undefined ? '' : ` (override ${envName})`}`
      failures.push(failure)
      rows.push({ ...base, expected: entry.productCommit ?? entry.integrationBranch, actual: null, ok: false, failure })
      continue
    }
    // A PR checkout is a detached merge commit with no local branch; the
    // remote-tracking ref carries the same tip and is what CI has.
    const tip = revParse(path, entry.integrationBranch)
      ?? revParse(path, `origin/${entry.integrationBranch}`)
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
      const ok = basedOnIntegration(path, tip)
      const row: ComboRow = {
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
    const row: ComboRow = {
      ...base,
      expected: locked,
      actual: tip,
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
function androidSourceRow(root: string, source: ComboAndroidSource | undefined): ComboRow {
  const path = typeof source?.declaration === 'string' && source.declaration !== ''
    ? resolve(root, source.declaration)
    : null
  const expected = typeof source?.commit === 'string' ? source.commit : null
  const base = {
    key: 'android source',
    role: source?.role ?? null,
    path,
    lock: 'declaration',
    expected,
  }
  const fail = (failure: string, actual: unknown = null): ComboRow => ({ ...base, actual, ok: false, failure })
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
    // The caught value is whatever the read or the parse threw; the report only
    // reads its `message`, exactly as the pre-migration code did.
    return fail(`android source: ${path} must be JSON with a "commit" field: ${(error as Error).message}`)
  }
  if (declared === expected) return { ...base, actual: declared, ok: true }
  const actual = typeof declared === 'string' ? declared : null
  return fail(`android source: ${path} declares ${actual ?? JSON.stringify(declared)}`
    + ` but combo.json androidSource.commit is ${expected}${remedy}`, actual)
}

/** What the table's result column says for one row. */
function resultLabel(row: ComboRow): string {
  if (!row.ok) return 'MISMATCH'
  if (row.lock === 'declaration') return 'ok (declaration matches)'
  if (row.lock === 'integration-branch') {
    return `ok (worktree ${row.headIsTip ? 'is the integration tip' : 'is based on the integration tip'})`
  }
  return 'ok'
}

/**
 * The package a module specifier belongs to: `@scope/name` for both
 * `@scope/name` and `@scope/name/subpath`.
 * @param specifier
 * @returns
 */
export function packageOf(specifier: string): string {
  return specifier.split('/').slice(0, 2).join('/')
}

/**
 * The npm scope a package name belongs to (`@scope/`), or undefined for an
 * unscoped name. Product rows are recognized by scope rather than by an
 * enumerated package list.
 * @param name
 * @returns
 */
function scopeOf(name: string): string | undefined {
  return name.startsWith('@') ? `${name.split('/')[0]}/` : undefined
}

/**
 * The leaf rows of a composed tree.
 *
 * Group rows are containers, not rows to check: they are dropped, and their
 * children are returned in their place. A child of a disabled group inherits
 * that state (`disabled: true`), because the loader's effective state walks
 * every ancestor group (`Entry.disabled`) while the composed rows keep only
 * their own flag. Materializing it here lets a row-level check see that a row
 * inside a disabled group is disabled at runtime.
 *
 * Idempotent: the result contains no group rows, so flattening it again returns
 * the same rows.
 * @param entries
 * @returns
 */
export function flattenEntries(entries: EntryOptions[]): EntryOptions[] {
  const leaves: EntryOptions[] = []
  const visit = (list: EntryOptions[], inheritedDisabled: boolean) => {
    for (const entry of list) {
      const disabled = inheritedDisabled || entry.disabled === true
      if (entry.group) {
        // The loader treats a truthy `group` as a container; its children are
        // mounted in the container's place.
        if (Array.isArray(entry.config)) visit(entry.config, disabled)
      } else if (disabled && entry.disabled !== true) {
        leaves.push({ ...entry, disabled: true })
      } else {
        leaves.push(entry)
      }
    }
  }
  visit(entries, false)
  return leaves
}

/**
 * The product packages actually installed in a profile, by the scope the bundle
 * name belongs to.
 *
 * The launcher configures a hoisted linker, so the installed copies sit directly
 * under `<profileDir>/node_modules/<scope>`. This is the installed set, not the
 * declared set: a directory that no manifest declares still counts as installed
 * and must be reported.
 * @param profileDir
 * @param bundlePackage
 * @returns package names, sorted.
 */
function installedProductPackages(profileDir: string, bundlePackage: string): string[] {
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
 * @param options
 * @returns
 */
function installedBundle({ binName, bundlePackage, installAnchor, profileDir }: {
  binName: string
  bundlePackage: string
  installAnchor: string
  profileDir: string
}): InstalledBundle {
  // The module is loaded from the INSTALLED profile, so the runtime copy is the
  // one a boot would read; the cast names the surface this script calls.
  const boot = createRequire(installAnchor)('@deepseek-ai/dsh-app-boot') as DshAppBoot
  const profile = boot.loadProfileDirectory(binName, profileDir, installAnchor)
  return {
    boot,
    profile,
    layer: profile.layers.find(entry => entry.packageName === bundlePackage),
    skipped: profile.skippedBundles.find(entry => entry.packageName === bundlePackage),
  }
}

/**
 * The failure line for one dependency the installed bundle may not declare.
 *
 * The worktree copy fails hard with the launcher's message; this copy is
 * reported instead, because doctor's job is to collect failures rather than
 * abort on the first one. The message names the installed manifest, the
 * package, and the rule it broke.
 * @param manifestPath - the installed bundle's manifest.
 * @param containmentRoot - the profile's node_modules.
 * @param refusal
 * @returns
 */
function installedAdmissionFailure(manifestPath: string, containmentRoot: string, { name, specifier, target, rule }: AdmissionRefusal): string {
  if (rule === 'file') {
    return `${manifestPath} declares ${name} as ${JSON.stringify(specifier)};`
      + ' an installed product package is linked, not fetched, so the bundle must declare each one as file:<path>'
  }
  if (rule === 'containment') {
    return `${manifestPath} declares ${name} at ${target}, which is outside ${containmentRoot};`
      + " an installed bundle may only link packages inside the profile's node_modules"
  }
  return `${manifestPath} declares ${name} twice: once as a bundle/probe entry and once in dependencies`
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
 * @param options
 * @returns
 */
export function verifyBundlePackages({ binName, bundlePackage, probePackage, installAnchor, profileDir }: {
  binName: string
  bundlePackage: string
  probePackage: string
  installAnchor: string
  profileDir: string
}): { ok: boolean; declared: string[]; mounted: { id: string; name: string; package: string }[]; failures: string[] } {
  // Loaded the same way the launcher boots: the profile's bundle layer, the
  // patches it declares, and the rows composed from them.
  const { boot, layer, skipped } = installedBundle({ binName, bundlePackage, installAnchor, profileDir })
  const failures: string[] = []
  if (skipped !== undefined) {
    failures.push(`${bundlePackage} was not loaded from ${profileDir}: ${skipped.reason}`)
  }
  if (layer === undefined) {
    if (skipped === undefined) failures.push(`${bundlePackage} is not a loaded bundle of ${profileDir}`)
    return { ok: false, declared: [], mounted: [], failures }
  }

  const manifest = boot.readProfileManifest(binName, layer.packageDir)
  const declared = Object.keys(manifest.dependencies ?? {}).sort()
  // The installed copy is the one a boot reads, so it gets the same three
  // admission rules the launcher applies to the worktree copy. The containment
  // root is the profile's node_modules: the installed bundle's `file:../x`
  // declarations resolve to the sibling installed packages there. `declared`
  // stays the manifest's dependency names, so a refused specifier is not also
  // reported here as an undeclared or ghost package; later independent checks
  // (a declared package no row mounts, an uninstalled package) may still report
  // related facts about the same name.
  const manifestPath = join(layer.packageDir, 'package.json')
  const containmentRoot = join(profileDir, 'node_modules')
  const { refused } = admitBundleDependencies({
    dependencies: manifest.dependencies,
    bundleDir: layer.packageDir,
    containmentRoot,
    entries: [bundlePackage, probePackage],
  })
  for (const refusal of refused) {
    failures.push(installedAdmissionFailure(manifestPath, containmentRoot, refusal))
  }
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
  const mountedPackages = new Set<string>()
  const seen = new Map<string, string[]>()
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
      // The caught value is whatever the loader threw; the report only reads
      // its `message`, exactly as the pre-migration code did.
      failures.push(`${bundlePackage} declares ${name}, but it is not installed in ${profileDir};`
        + ` run 'ourfairy-backend start --reinstall': ${(error as Error).message}`)
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
 * probe are included: the bundle declares no peers, and the probe declares one
 * `@ourfairy/*` peer, which this judgement ignores because it judges only dsh
 * peers; a reader still sees every installed product package accounted for.
 * @param options
 * @returns
 */
export function verifyPluginCompatibility({ binName, bundlePackage, installAnchor, profileDir }: {
  binName: string
  bundlePackage: string
  installAnchor: string
  profileDir: string
}): { ok: boolean; dshVersion: string; checked: string[]; failures: string[] } {
  const { boot, layer, skipped } = installedBundle({ binName, bundlePackage, installAnchor, profileDir })
  const dshVersion = boot.getDshRuntimeVersion()
  const failures: string[] = []
  if (skipped !== undefined) {
    failures.push(`${bundlePackage} was not loaded from ${profileDir}: ${skipped.reason}`)
  }
  if (layer === undefined) {
    if (skipped === undefined) failures.push(`${bundlePackage} is not a loaded bundle of ${profileDir}`)
    return { ok: false, dshVersion, checked: [], failures }
  }

  const checked: string[] = []
  for (const name of installedProductPackages(profileDir, bundlePackage)) {
    let installed
    try {
      installed = boot.readProfileManifest(binName, boot.resolveBundleDir(binName, name, installAnchor, profileDir))
    } catch (error) {
      // The caught value is whatever the loader threw; the report only reads
      // its `message`, exactly as the pre-migration code did.
      failures.push(`${name} is installed in ${profileDir} but its manifest is not readable: ${(error as Error).message}`)
      continue
    }
    const issue = boot.evaluatePluginCompatibility(installed, {}, dshVersion)
    if (issue !== undefined) {
      const peers = Object.entries(issue.requirements).map(([peer, range]) => `${peer} ${range}`).join(', ')
      failures.push(`${name}@${issue.version} is incompatible with dsh ${dshVersion}: peerDependencies ${peers}`)
      continue
    }
    checked.push(`${name}@${installed.version}`)
  }
  return { ok: failures.length === 0, dshVersion, checked, failures }
}

/**
 * The dsh rows and public export the product code depends on.
 *
 * This is a dependency list, not a row inventory: the mounted row set and its
 * config live only in `backend/v1-bundle/cordis.patch.yml`. Each entry names
 * the row the product reads and the package that must provide it.
 */
const REQUIRED_NATIVE_ROWS = [
  { row: 'llm-retry', name: '@deepseek-ai/dsh-llm-retry' },
  { row: 'spill-local', name: '@deepseek-ai/dsh-spill-local' },
  { row: 'spill-policy', name: '@deepseek-ai/dsh-spill-policy' },
  { row: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
]
const SESSION_HISTORY_EXPORT = '@deepseek-ai/dsh-agent/session-history'

/**
 * Every required native capability that is not mounted, plus the public
 * history export when it does not resolve.
 *
 * @param rows - the composed profile rows, as dsh's loader returns them;
 *   rows nested in a group's `config` are mounted too, so the lookup flattens,
 *   including the disabled state inherited from an ancestor group.
 * @param resolveExport - resolves from the dsh installation.
 * @returns one message per missing, disabled, or drifted capability.
 */
export function nativeCapabilityFailures(rows: EntryOptions[], resolveExport: (specifier: string) => string): string[] {
  const failures: string[] = []
  const mounted = new Map(flattenEntries(rows).map(row => [row.id, row]))
  for (const { row: id, name } of REQUIRED_NATIVE_ROWS) {
    const entry = mounted.get(id)
    if (entry === undefined) {
      failures.push(`required native capability missing: the ${id} row is not mounted;`
        + ` add ${name} to backend/v1-bundle/cordis.patch.yml and run 'npm run backend:start -- --reinstall'`)
      continue
    }
    if (entry.disabled === true) {
      failures.push(`required native capability missing: the ${id} row (${name}) is disabled in the installed profile;`
        + ` enable it in the profile's cordis.patch.yml or remove the override, then run 'npm run backend:start -- --reinstall'`)
      continue
    }
    if (entry.name !== name) {
      failures.push(`required native capability drifted: the ${id} row mounts ${entry.name ?? '<no package>'},`
        + ` but the product depends on ${name}; fix backend/v1-bundle/cordis.patch.yml and run`
        + ` 'npm run backend:start -- --reinstall'`)
    }
  }
  try {
    resolveExport(SESSION_HISTORY_EXPORT)
  } catch (error) {
    // The caught value is whatever the resolver threw; the report only reads
    // its `message`, exactly as the pre-migration code did.
    failures.push(`required native capability missing: ${SESSION_HISTORY_EXPORT} does not resolve from the dsh installation`
      + ` (${(error as Error).message}); check out the dsh commit combo.json locks and run 'build:lib:host' in that checkout`)
  }
  return failures
}

/**
 * Check the required native capabilities in the *installed* profile.
 *
 * The profile is read through dsh's own loader (`dsh-app-boot`), so the rows
 * checked are the rows a boot would mount, including the profile's user layer.
 * @param options
 * @returns
 */
export function verifyInstalledNativeCapabilities({ binName, bundlePackage, installAnchor, profileDir }: {
  binName: string
  bundlePackage: string
  installAnchor: string
  profileDir: string
}): { ok: boolean; failures: string[]; checked: string[] } {
  // The same loader read the bundle-package check performs: what a boot would
  // mount, including the profile's own layer.
  let installed: InstalledBundle
  try {
    installed = installedBundle({ binName, bundlePackage, installAnchor, profileDir })
  } catch (error) {
    // The caught value is whatever the loader threw; the report only reads
    // its `message`, exactly as the pre-migration code did.
    return { ok: false, checked: [], failures: [`the installed profile ${profileDir} could not be read through`
      + ` @deepseek-ai/dsh-app-boot (${(error as Error).message}); check out and build the dsh commit combo.json locks,`
      + ` then run 'npm run backend:start -- --reinstall'`] }
  }
  const { boot, profile, layer, skipped } = installed
  if (layer === undefined) {
    const reason = skipped === undefined ? 'it is not listed in the profile' : skipped.reason
    return { ok: false, checked: [], failures: [`${bundlePackage} was not loaded from ${profileDir}: ${reason};`
      + ` run 'npm run backend:start -- --reinstall'`] }
  }
  // Flattened rows are what the check consumes: the installed layer's rows can
  // be nested in a group, and a disabled group must reach its children.
  const rows = flattenEntries(boot.composeEntries([...profile.layers.map(entry => entry.patches), profile.patches]))
  const failures = nativeCapabilityFailures(rows, specifier => createRequire(installAnchor).resolve(specifier))
  return {
    ok: failures.length === 0,
    failures,
    checked: [...REQUIRED_NATIVE_ROWS.map(row => `${row.row}:${row.name}`), SESSION_HISTORY_EXPORT],
  }
}

function printTable(rows: ComboRow[]): string {
  const header = ['row', 'branch', 'expected', 'actual', 'result']
  const cells = rows.map((row) => [
    row.key,
    row.branch === null || row.branch === undefined ? '-' : String(row.branch),
    row.expected === null || row.expected === undefined ? '-' : String(row.expected).slice(0, 16),
    row.actual === null || row.actual === undefined ? 'MISSING' : String(row.actual).slice(0, 16),
    resultLabel(row),
  ])
  // Every row has one cell per column, so the widths and the cells line up.
  const widths = header.map((cell, index) => Math.max(cell.length, ...cells.map(row => row[index]!.length)))
  const line = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index]!)).join('  ')
  return [line(header), line(widths.map(width => '-'.repeat(width))), ...cells.map(line)].join('\n')
}

function printShow(combo: Combo): string {
  const lines = [`combination: ${combo.product} (schemaVersion ${combo.schemaVersion})`]
  for (const [key, entry] of Object.entries(combo.repos)) {
    lines.push(`${key} (${entry.role}, lock: ${entry.lock ?? 'commit'})`)
    lines.push(`  path                  ${repoPath(combo, key)}`)
    if (entry.remoteUrl !== undefined) {
      lines.push(`  fork remote           ${entry.remoteName ?? 'origin'} ${entry.remoteUrl}`)
    }
    lines.push(`  integration branch    ${entry.integrationBranch}`)
    lines.push(entry.productCommit === undefined || entry.productCommit === null
      ? '  productCommit         (self repository: the integration branch tip is the lock)'
      : `  productCommit         ${entry.productCommit}`)
  }
  if (combo.androidSource !== undefined) {
    const source = combo.androidSource
    lines.push(`android source (${source.role}, lock: declaration)`)
    lines.push(`  commit                ${source.commit}`)
    lines.push(`  declaration           ${resolve(repoRoot, source.declaration!)}`)
  }
  // The recorded file is the authority for the backend pins; `readCombination`
  // is what validates them, and `show` prints what the file holds.
  lines.push(`backend                 profile ${combo.backend!.profileName}; bundle ${combo.backend!.bundlePackage} (${combo.backend!.bundlePathInRepo})`)
  lines.push(`launcher                ${combo.backend!.launcher}; ${combo.backend!.pnpmInvocation}`)
  lines.push('research baseline       docs/research/README.md (upstream SHAs, not product commits)')
  return lines.join('\n')
}

function main(argv: string[]): number {
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
