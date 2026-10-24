/**
 * The OurFairy v1 composition layer.
 *
 * Everything that can be decided by reading the checkout lives here: the
 * recorded version combination, the isolated layout derived from a home, the
 * product package inventory derived from the bundle manifest, the content hash
 * that decides whether the installed profile is stale, the generated profile,
 * and the overlays one boot applies. The launcher next door keeps the process
 * layer: argv, git, pnpm, child processes, and command dispatch.
 *
 * The zero-spawn boundary is this module's import surface: it imports only
 * `node:fs`, `node:path`, `node:crypto`, and `node:os`, never
 * `node:child_process`, so the composition functions have no git or pnpm to
 * call. That is what makes these decisions directly assertable from a test
 * instead of through a subprocess. Nothing beyond review enforces the boundary;
 * no behavioural test asserts it.
 *
 * Every function that reads the repository takes a root directory and defaults
 * to the repository this module lives in, so a test can point it at a throwaway
 * copy while the launcher uses the worktree.
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** The repository this module lives in; the default root of every function. */
const repoRoot = resolve(import.meta.dirname, '..')

/** pnpm's import mode for profile installs: copies, never hardlinks into the worktree. */
export const PROFILE_IMPORT_METHOD = 'copy'

/**
 * One repository entry of the recorded combination.
 *
 * `lock` names what the entry is pinned to; `productCommit` is absent for the
 * repository that holds combo.json itself, whose lock is the integration
 * branch. The remaining fields are read where they are used, so an entry that
 * does not carry them is not refused here.
 */
export interface ComboRepo {
  readonly role: string
  readonly lock?: string
  readonly localPath: string
  readonly integrationBranch: string
  readonly productCommit?: string
  readonly remoteName?: string
  readonly remoteUrl?: string
}

/**
 * The `backend` section of the recorded combination.
 *
 * The seven pins `readCombination` validates are required; the launcher and the
 * doctor only print `launcher` and `pnpmInvocation`, so those two are optional.
 */
export interface ComboBackend {
  readonly profileName: string
  readonly bundlePackage: string
  readonly probePackage: string
  readonly bundlePathInRepo: string
  readonly probePathInRepo: string
  readonly nodeRange: string
  readonly pnpmPin: string
  readonly launcher?: string
  readonly pnpmInvocation?: string
  /** Any further pin the recorded file carries; read where it is used. */
  readonly [field: string]: unknown
}

/** The inlined Android client's provenance, as combo.json records it. */
export interface ComboAndroidSource {
  readonly role?: string
  readonly commit?: string
  readonly declaration?: string
}

/**
 * The recorded combination, as combo.json holds it.
 *
 * combo.json is the authority for this shape; the fields below are the ones the
 * scripts read. The recorded file carries more keys than these, and the ones no
 * script reads are simply not described.
 */
export interface Combo {
  readonly schemaVersion: number
  readonly product: string
  readonly repos: Record<string, ComboRepo>
  readonly backend?: ComboBackend
  readonly androidSource?: ComboAndroidSource
}

/** A product package: its published name and its repo-relative directory. */
export interface ProductPackage {
  readonly name: string
  readonly dir: string
}

/** A linked package's manifest, as the staleness hash reads it. */
export interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly files: string[]
  readonly dependencies?: Record<string, unknown>
}

/** The three admission rules a bundle manifest's dependencies must satisfy. */
export type AdmissionRule = 'file' | 'containment' | 'duplicate'

/** One dependency the bundle manifest may not carry, and the rule it broke. */
export interface AdmissionRefusal {
  readonly name: string
  readonly specifier: unknown
  readonly target?: string
  readonly rule: AdmissionRule
}

/** Resolved isolated layout; every durable path lives under `home`. */
export interface Layout {
  readonly home: string
  readonly dshHome: string
  readonly userHome: string
  readonly runDir: string
  readonly logDir: string
  readonly pnpmStore: string
  readonly profileDir: string
  readonly statePath: string
}

/** Read combo.json. */
export function readCombo(root = repoRoot): { combo: Combo; path: string } {
  const path = join(root, 'combo.json')
  if (!existsSync(path)) throw new Error(`combo.json not found at ${path}`)
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || typeof (parsed as { repos?: unknown }).repos !== 'object') {
    throw new Error(`${path} must be an object with a repos map`)
  }
  // combo.json is the authority for the combination's shape: the check above
  // proves only that the file carries a `repos` map, and every other field is
  // read where it is used. The cast records that the file, not this module,
  // defines what the fields hold.
  return { combo: parsed as Combo, path }
}

/**
 * The pinned combination's `backend` section, validated field by field.
 *
 * Profile name, package names, repo-relative paths, and the pnpm pin all come
 * from the recorded combination: hardcoding them would make combo.json's pins
 * decorative, so a recorded version could drift from what actually runs without
 * anything failing.
 */
export function readCombination(root = repoRoot): ComboBackend {
  const { combo, path } = readCombo(root)
  const backend: Record<string, unknown> = combo.backend ?? {}
  for (const field of ['profileName', 'bundlePackage', 'probePackage', 'bundlePathInRepo', 'probePathInRepo', 'pnpmPin', 'nodeRange']) {
    if (typeof backend[field] !== 'string' || backend[field] === '') {
      throw new Error(`${path} backend.${field} must be a non-empty string; the launcher reads its pins from combo.json`)
    }
  }
  // The loop above proved the seven pins are non-empty strings; the two the
  // launcher only prints are carried through as the recorded file holds them.
  return backend as ComboBackend
}

/**
 * Resolved isolated layout; every durable path lives under `home`.
 *
 * The profile directory uses the combination's `profileName`; `profileManifest`
 * reads the same recorded field, so both derive the name from combo.json
 * instead of keeping a profile name of their own.
 */
export function layoutOf(home: string | undefined, root = repoRoot): Layout {
  const homeDir = resolve(home ?? join(root, '.ourfairy'))
  const { profileName } = readCombination(root)
  return {
    home: homeDir,
    dshHome: join(homeDir, 'dsh-home'),
    userHome: join(homeDir, 'user-home'),
    runDir: join(homeDir, 'run'),
    logDir: join(homeDir, 'logs'),
    pnpmStore: join(homeDir, 'pnpm-store'),
    profileDir: join(homeDir, 'dsh-home', 'profiles', profileName),
    statePath: join(homeDir, 'run', 'backend.json'),
  }
}

/** Refuse a home that would write into the host's real home tree. */
export function assertIsolatedHome(layout: Pick<Layout, 'home'>, root = repoRoot): void {
  const host = homedir()
  if (layout.home === '/' || layout.home === host || host.startsWith(layout.home + sep)) {
    throw new Error(`refusing OURFAIRY_HOME=${layout.home}: it is the host home (${host}) or an ancestor of it.`
      + ` Backend state must stay isolated; unset OURFAIRY_HOME to use ${join(root, '.ourfairy')}.`)
  }
}

/**
 * Child environment for every process the product spawns.
 *
 * `HOME` and every tool cache are pinned inside the isolated home: the browser
 * session cookie, `~/.cache/pnpm`, the pnpm store and the durable dsh home must
 * all land under `OURFAIRY_HOME`, otherwise a boot quietly writes to the host's
 * real home and the isolation claim is false.
 */
export function isolatedEnv(layout: Layout, { root = repoRoot, extra = {} }: { root?: string; extra?: Record<string, string> } = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: layout.userHome,
    DSH_HOME: layout.dshHome,
    OURFAIRY_HOME: layout.home,
    XDG_CACHE_HOME: join(layout.home, 'cache'),
    XDG_CONFIG_HOME: join(layout.home, 'config'),
    XDG_DATA_HOME: join(layout.home, 'data'),
    XDG_STATE_HOME: join(layout.home, 'state'),
    // pnpm's own cache and store ARE product-run state: they hold what this
    // checkout installed, so they stay inside the isolated home.
    npm_config_cache: join(layout.home, 'cache', 'npm'),
    npm_config_store_dir: layout.pnpmStore,
    PNPM_HOME: join(layout.home, 'pnpm-home'),
    // Corepack's cache is a TOOL cache, not product state: it holds downloaded
    // toolchain archives. It is SHARED across isolated homes on purpose —
    // rebuilding it per home re-extracts ~98MB (measured: 0.36s warm vs 2.74s
    // cold, and whole tests went from ~1s to 35-42s). It stays inside the
    // repository rather than the host home, so "never writes the host's real
    // home" still holds; the deliberate tradeoff is recorded in
    // work/implementation/evidence/01-baseline/README.md.
    COREPACK_HOME: join(root, '.corepack'),
    ...extra,
  }
}

/**
 * The three admission rules for a bundle manifest's dependencies.
 *
 * A product package is linked from a checkout, never fetched from a registry:
 * every dependency must be a `file:` specifier, must resolve inside the root
 * that contains the bundle copy, and must not repeat the bundle or probe entry.
 * The rules are stated once here because two callers read two copies of the
 * same manifest — the launcher reads the worktree copy (containment root = the
 * repository) and combo.ts reads the installed copy (containment root = the
 * profile's `node_modules`). The roots differ; the verdicts must not.
 *
 * `admitted` keeps declaration order and carries each package directory
 * relative to `containmentRoot`, which is how the launcher turns the inventory
 * into repo-relative sources. `refused` names the violated rule instead of
 * throwing, so a caller that reports rather than fails (doctor's bundle
 * packages check) can turn it into a failure line.
 * @param options - `entries` are the bundle and probe package names, the entries a
 *   dependency may not duplicate.
 * @returns
 */
export function admitBundleDependencies({ dependencies, bundleDir, containmentRoot, entries }: {
  dependencies?: Record<string, unknown> | undefined
  bundleDir: string
  containmentRoot: string
  entries: string[]
}): { admitted: ProductPackage[]; refused: AdmissionRefusal[] } {
  const admitted: ProductPackage[] = []
  const refused: AdmissionRefusal[] = []
  const reserved = new Set(entries)
  for (const [name, specifier] of Object.entries(dependencies ?? {})) {
    if (typeof specifier !== 'string' || !specifier.startsWith('file:')) {
      refused.push({ name, specifier, rule: 'file' })
      continue
    }
    const target = resolve(bundleDir, specifier.slice('file:'.length))
    // The staleness hash lists the sources the install copies; a package
    // outside the containment root could change without the hash noticing,
    // which is the stale install the hash exists to prevent.
    const dir = relative(containmentRoot, target)
    if (dir === '' || dir.startsWith('..') || isAbsolute(dir)) {
      refused.push({ name, specifier, target, rule: 'containment' })
      continue
    }
    if (reserved.has(name)) {
      refused.push({ name, specifier, target, rule: 'duplicate' })
      continue
    }
    admitted.push({ name, dir })
  }
  return { admitted, refused }
}

/**
 * The product packages the profile installs, derived from the bundle manifest.
 *
 * The bundle's `dependencies` are the product package inventory: every entry is
 * a product package the bundle mounts, declared as `file:<path relative to the
 * bundle directory>`. The composition resolves each specifier from the bundle's
 * own directory — exactly how pnpm resolves it when the bundle is installed —
 * so adding a product package is one manifest edit and no launcher change. The
 * probe is the one package the bundle never mounts: combo.json names it
 * separately. Admission is the shared rule above, with this checkout as the
 * containment root; a violation is a hard failure because the launcher cannot
 * derive an installable inventory from it.
 * @param [root] - repository root.
 * @returns package name plus repo-relative directory.
 */
export function productPackages(root = repoRoot): ProductPackage[] {
  const { bundlePackage, probePackage, bundlePathInRepo, probePathInRepo } = readCombination(root)
  const manifest = readPackageManifest(bundlePathInRepo, root)
  const { admitted, refused } = admitBundleDependencies({
    dependencies: manifest.dependencies,
    bundleDir: join(root, bundlePathInRepo),
    containmentRoot: root,
    entries: [bundlePackage, probePackage],
  })
  const [refusal] = refused
  if (refusal?.rule === 'file') {
    throw new Error(`${bundlePathInRepo}/package.json declares ${refusal.name} as ${JSON.stringify(refusal.specifier)};`
      + ' the launcher links product packages from this checkout, so the bundle must declare each one as file:<path>')
  }
  if (refusal?.rule === 'containment') {
    throw new Error(`${bundlePathInRepo}/package.json declares ${refusal.name} at ${refusal.target},`
      + ' which is outside this repository; product packages live under backend/')
  }
  if (refusal?.rule === 'duplicate') {
    throw new Error(`${bundlePathInRepo}/package.json declares ${refusal.name} twice: once as a bundle/probe entry and once in dependencies`)
  }
  return [{ name: bundlePackage, dir: bundlePathInRepo }, { name: probePackage, dir: probePathInRepo }, ...admitted]
}

/**
 * Every file the profile install copies out of the worktree, repo-relative.
 *
 * pnpm copies a `file:` package into the profile by its `files` declaration,
 * so that declaration — not a list kept here — is what decides the install's
 * contents. Deriving the set from it is what makes adding a source file safe:
 * a new file under `src/` is published, so it reaches the hash by itself. The
 * packages walked are the ones the profile installs, themselves read from the
 * bundle manifest.
 *
 * A `files` entry that publishes no file is refused here rather than skipped.
 * npm skips it silently, so a package whose build output is missing installs
 * without that output, the hash of the "sources" stays the same, and the boot
 * dies with `ERR_MODULE_NOT_FOUND` long after the install reported success.
 * @param [root] - repository root.
 * @returns
 */
export function productSources(root = repoRoot): string[] {
  const sources = new Set<string>()
  for (const { dir } of productPackages(root)) {
    // npm always ships package.json, whether `files` names it or not.
    sources.add(join(dir, 'package.json'))
    const manifest = readPackageManifest(dir, root)
    for (const entry of manifest.files) {
      const published = publishedEntries(dir, entry, root)
      if (published.length === 0) {
        throw new Error(`${dir} (${manifest.name ?? 'unnamed package'}) declares the files entry ${JSON.stringify(entry)},`
          + ' which publishes no file; the profile install would copy a package without its build output.'
          + " Run 'npm run build' to produce it.")
      }
      for (const file of published) sources.add(file)
    }
  }
  return [...sources].sort()
}

/**
 * Expand one `files` entry to the repo-relative files it publishes.
 *
 * The entry is a path or an npm-style glob (`locale/*.json`); a directory
 * publishes every file beneath it. Node's own resolver reads the glob, so this
 * module carries no wildcard logic of its own. An entry matching nothing
 * publishes nothing here — npm silently skips it the same way, which is why
 * `productSources` refuses such an entry instead of hashing an empty set.
 * @param dir - repo-relative package directory.
 * @param entry - one `files` entry.
 * @param [root] - repository root.
 * @returns
 */
export function publishedEntries(dir: string, entry: string, root = repoRoot): string[] {
  const base = join(root, dir)
  return globSync(entry, { cwd: base }).flatMap((match) => {
    const absolute = join(base, match)
    if (!statSync(absolute).isDirectory()) return [join(dir, match)]
    // Recursive listing yields directory names too; only files carry content.
    // Node's types widen the recursive listing to `string[] | Buffer[]`; the
    // default encoding is utf8, so the names it yields are strings.
    return (readdirSync(absolute, { recursive: true }) as string[])
      .map(file => join(dir, match, file))
      .filter(file => statSync(join(root, file)).isFile())
  })
}

/**
 * Read a linked package's manifest, refusing one that names no published files.
 * @param dir - repo-relative package directory.
 * @param [root] - repository root.
 * @returns
 */
export function readPackageManifest(dir: string, root = repoRoot): PackageManifest {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  } catch (error) {
    // The caught value is whatever the read or the parse threw; the report only
    // reads its `message`, exactly as the pre-migration code did.
    throw new Error(`cannot read ${dir}/package.json, which declares what the profile install copies: ${(error as Error).message}`)
  }
  if (!Array.isArray((manifest as PackageManifest).files) || (manifest as PackageManifest).files.length === 0) {
    throw new Error(`${dir}/package.json declares no "files" list; the staleness hash derives the installed product sources from it,`
      + ' and an unlisted package would hash nothing')
  }
  // The manifest is the package's own file: npm declares `files` as a list of
  // strings, and the check above proved the list is there and not empty.
  return manifest as PackageManifest
}

/**
 * Content hash of the product sources, so a stale linked profile is reinstalled.
 * @param [root] - repository root.
 * @returns
 */
export function productSourceHash(root = repoRoot): string {
  const hash = createHash('sha256')
  // Profiles are mutable snapshots; file: hardlinks would also change the worktree.
  hash.update(PROFILE_IMPORT_METHOD)
  for (const relativePath of productSources(root)) {
    hash.update(relativePath)
    hash.update(readFileSync(join(root, relativePath)))
  }
  return hash.digest('hex')
}

/** The profile manifest the launcher writes for this combination. */
export function profileManifest(root = repoRoot): {
  name: string
  private: boolean
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[] } }
} {
  const { profileName, bundlePackage } = readCombination(root)
  return {
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: Object.fromEntries(productPackages(root).map(({ name, dir }) => [name, `file:${join(root, dir)}`])),
    dsh: { profile: { bundles: [bundlePackage] } },
  }
}

/** Write the isolated profile project (manifest, pnpm settings, empty user layer). */
export function writeProfile(layout: Pick<Layout, 'profileDir'>, root = repoRoot): void {
  mkdirSync(layout.profileDir, { recursive: true })
  writeFileSync(join(layout.profileDir, 'package.json'), `${JSON.stringify(profileManifest(root), undefined, 2)}\n`)
  writeFileSync(join(layout.profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  const userLayer = join(layout.profileDir, 'cordis.patch.yml')
  if (!existsSync(userLayer)) {
    writeFileSync(userLayer, '# OurFairy v1 profile user layer. The product composition comes from the bundle;\n# this file exists so a machine-local override has a supported place to live.\n[]\n')
  }
}

/**
 * The installed bundle's manifest path, one input of the staleness decision.
 *
 * pnpm installs with a hoisted linker, so the linked bundle sits directly under
 * the profile's `node_modules`.
 */
export function profileLinkedManifestPath(layout: Pick<Layout, 'profileDir'>, root = repoRoot): string {
  const { bundlePackage } = readCombination(root)
  return join(layout.profileDir, 'node_modules', ...bundlePackage.split('/'), 'package.json')
}

/**
 * Where the shared, read-only template of one installed profile lives.
 *
 * The name carries both the product-source hash and the pinned pnpm version:
 * a template built by another pnpm layout must never be copied into a profile
 * this launcher will later install into.
 * @param [root] - repository root.
 * @param hash - product-source hash the template was built from.
 * @returns
 */
export function profileTemplateDir(root = repoRoot, hash: string): string {
  return join(root, '.ourfairy-template', `${hash}-${readCombination(root).pnpmPin}`)
}

/**
 * Decide whether the installed profile can be reused: `{ mode, hash, template? }`.
 *
 * The decision compares the current product-source content hash with the stamp
 * written after the last successful install and requires the linked bundle
 * manifest to still exist. When this home has no stamp but a template for the
 * same hash exists, the template is copied instead of rereading pnpm: the
 * installed tree is a pure function of the hash, and copying it costs far less
 * than a second install. The hash is returned so the process layer can stamp
 * what it performed without hashing twice. Executing pnpm, and copying, belong
 * to the process layer, which owns subprocesses and file mutation.
 * @param layout
 * @param [options]
 * @returns
 */
export function installDecision(layout: Pick<Layout, 'home' | 'profileDir'>, { root = repoRoot, reinstall = false, template = true }: { root?: string; reinstall?: boolean; template?: boolean } = {}): { mode: 'cached' | 'copy' | 'install'; hash: string; template?: string } {
  const stampPath = join(layout.profileDir, '.ourfairy-source-hash')
  const hash = productSourceHash(root)
  const stamped = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : undefined
  if (!reinstall && existsSync(profileLinkedManifestPath(layout, root)) && stamped === hash) {
    return { mode: 'cached', hash }
  }
  const templateDir = profileTemplateDir(root, hash)
  if (!reinstall && template && existsSync(join(templateDir, 'node_modules'))) {
    return { mode: 'copy', hash, template: templateDir }
  }
  return { mode: 'install', hash }
}

/**
 * Replace this profile's installed tree with a copy of a template.
 *
 * Only the installed artifacts move: the manifest is written from the current
 * root by {@link writeProfile}, so copying the template's own manifest would
 * reintroduce the builder's absolute `file:` paths.
 * @param layout
 * @param template - directory holding `node_modules` and `pnpm-lock.yaml`.
 */
export function copyProfileTemplate(layout: Pick<Layout, 'profileDir'>, template: string): void {
  rmSync(join(layout.profileDir, 'node_modules'), { recursive: true, force: true })
  cpSync(join(template, 'node_modules'), join(layout.profileDir, 'node_modules'), { recursive: true })
  const lock = join(template, 'pnpm-lock.yaml')
  if (existsSync(lock)) cpSync(lock, join(layout.profileDir, 'pnpm-lock.yaml'))
}

/**
 * Publish a successful install as the shared template for its hash.
 *
 * A concurrent publisher may win the rename; that is success, not a failure.
 * The staging directory keeps a half-copied tree from ever being published.
 * @param layout
 * @param hash - product-source hash the install was built from.
 * @param [root] - repository root.
 * @returns the template directory.
 */
export function publishProfileTemplate(layout: Pick<Layout, 'profileDir'>, hash: string, root = repoRoot): string {
  const target = profileTemplateDir(root, hash)
  if (existsSync(target)) return target
  mkdirSync(dirname(target), { recursive: true })
  const staging = `${target}.tmp-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  cpSync(join(layout.profileDir, 'node_modules'), join(staging, 'node_modules'), { recursive: true })
  const lock = join(layout.profileDir, 'pnpm-lock.yaml')
  if (existsSync(lock)) cpSync(lock, join(staging, 'pnpm-lock.yaml'))
  try { renameSync(staging, target) } catch { rmSync(staging, { recursive: true, force: true }) }
  return target
}

/** Record the product-source hash an install was built from. */
export function writeSourceStamp(layout: Pick<Layout, 'profileDir'>, hash: string): void {
  writeFileSync(join(layout.profileDir, '.ourfairy-source-hash'), `${hash}\n`)
}

/** The probe overlay path, refusing a probe package that does not ship one. */
export function probeOverlayPath(root = repoRoot): string {
  const { probePathInRepo } = readCombination(root)
  const path = join(root, probePathInRepo, 'overlay.patch.yml')
  if (!existsSync(path)) throw new Error(`probe overlay missing at ${path}`)
  return path
}

/**
 * The overlays one boot applies: the probe overlay under test, then every
 * caller-supplied `--patch` file in argv order. dsh applies later overlays
 * last, so a test row sits above the product profile it extends without the
 * test having to know where that profile lives.
 * @param options
 * @param [root] - repository root.
 * @returns
 */
export function bootPatches(options: { patches: string[] }, root = repoRoot): string[] {
  return [probeOverlayPath(root), ...options.patches]
}
