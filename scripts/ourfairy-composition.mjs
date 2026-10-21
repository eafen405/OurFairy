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
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** The repository this module lives in; the default root of every function. */
const repoRoot = resolve(import.meta.dirname, '..')

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

/**
 * The pinned combination's `backend` section, validated field by field.
 *
 * Profile name, package names, repo-relative paths, and the pnpm pin all come
 * from the recorded combination: hardcoding them would make combo.json's pins
 * decorative, so a recorded version could drift from what actually runs without
 * anything failing.
 */
export function readCombination(root = repoRoot) {
  const { combo, path } = readCombo(root)
  const backend = combo.backend ?? {}
  for (const field of ['profileName', 'bundlePackage', 'probePackage', 'bundlePathInRepo', 'probePathInRepo', 'pnpmPin', 'nodeRange']) {
    if (typeof backend[field] !== 'string' || backend[field] === '') {
      throw new Error(`${path} backend.${field} must be a non-empty string; the launcher reads its pins from combo.json`)
    }
  }
  return backend
}

/**
 * Resolved isolated layout; every durable path lives under `home`.
 *
 * The profile directory uses the combination's `profileName`; `profileManifest`
 * reads the same recorded field, so both derive the name from combo.json
 * instead of keeping a profile name of their own.
 */
export function layoutOf(home, root = repoRoot) {
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
export function assertIsolatedHome(layout, root = repoRoot) {
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
export function isolatedEnv(layout, { root = repoRoot, extra = {} } = {}) {
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
 * repository) and combo.mjs reads the installed copy (containment root = the
 * profile's `node_modules`). The roots differ; the verdicts must not.
 *
 * `admitted` keeps declaration order and carries each package directory
 * relative to `containmentRoot`, which is how the launcher turns the inventory
 * into repo-relative sources. `refused` names the violated rule instead of
 * throwing, so a caller that reports rather than fails (doctor's bundle
 * packages check) can turn it into a failure line.
 * @param {{
 *   dependencies?: Record<string, unknown>,
 *   bundleDir: string,
 *   containmentRoot: string,
 *   entries: string[],
 * }} options - `entries` are the bundle and probe package names, the entries a
 *   dependency may not duplicate.
 * @returns {{
 *   admitted: {name: string, dir: string}[],
 *   refused: {name: string, specifier: unknown, target?: string, rule: 'file'|'containment'|'duplicate'}[],
 * }}
 */
export function admitBundleDependencies({ dependencies, bundleDir, containmentRoot, entries }) {
  const admitted = []
  const refused = []
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
 * @param {string} [root] - repository root.
 * @returns {{name: string, dir: string}[]} package name plus repo-relative directory.
 */
export function productPackages(root = repoRoot) {
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
 * @param {string} [root] - repository root.
 * @returns {string[]}
 */
export function productSources(root = repoRoot) {
  const sources = new Set()
  for (const { dir } of productPackages(root)) {
    // npm always ships package.json, whether `files` names it or not.
    sources.add(join(dir, 'package.json'))
    for (const entry of readPackageManifest(dir, root).files) {
      for (const published of publishedEntries(dir, entry, root)) sources.add(published)
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
 * publishes nothing, so it contributes nothing — npm silently skips it the
 * same way.
 * @param {string} dir - repo-relative package directory.
 * @param {string} entry - one `files` entry.
 * @param {string} [root] - repository root.
 * @returns {string[]}
 */
export function publishedEntries(dir, entry, root = repoRoot) {
  const base = join(root, dir)
  return globSync(entry, { cwd: base }).flatMap((match) => {
    const absolute = join(base, match)
    if (!statSync(absolute).isDirectory()) return [join(dir, match)]
    // Recursive listing yields directory names too; only files carry content.
    return readdirSync(absolute, { recursive: true })
      .map(file => join(dir, match, file))
      .filter(file => statSync(join(root, file)).isFile())
  })
}

/**
 * Read a linked package's manifest, refusing one that names no published files.
 * @param {string} dir - repo-relative package directory.
 * @param {string} [root] - repository root.
 * @returns {any}
 */
export function readPackageManifest(dir, root = repoRoot) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${dir}/package.json, which declares what the profile install copies: ${error.message}`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${dir}/package.json declares no "files" list; the staleness hash derives the installed product sources from it,`
      + ' and an unlisted package would hash nothing')
  }
  return manifest
}

/**
 * Content hash of the product sources, so a stale linked profile is reinstalled.
 * @param {string} [root] - repository root.
 * @returns {string}
 */
export function productSourceHash(root = repoRoot) {
  const hash = createHash('sha256')
  for (const relativePath of productSources(root)) {
    hash.update(relativePath)
    hash.update(readFileSync(join(root, relativePath)))
  }
  return hash.digest('hex')
}

/** The profile manifest the launcher writes for this combination. */
export function profileManifest(root = repoRoot) {
  const { profileName, bundlePackage } = readCombination(root)
  return {
    name: `dsh-profile-${profileName}`,
    private: true,
    dependencies: Object.fromEntries(productPackages(root).map(({ name, dir }) => [name, `file:${join(root, dir)}`])),
    dsh: { profile: { bundles: [bundlePackage] } },
  }
}

/** Write the isolated profile project (manifest, pnpm settings, empty user layer). */
export function writeProfile(layout, root = repoRoot) {
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
export function profileLinkedManifestPath(layout, root = repoRoot) {
  const { bundlePackage } = readCombination(root)
  return join(layout.profileDir, 'node_modules', ...bundlePackage.split('/'), 'package.json')
}

/**
 * Decide whether the installed profile can be reused: `{ mode, hash }`.
 *
 * The decision compares the current product-source content hash with the stamp
 * written after the last successful install and requires the linked bundle
 * manifest to still exist. The hash is returned with the decision so the
 * process layer can stamp the install it is about to perform without hashing
 * the sources a second time. Executing pnpm belongs to the process layer, which
 * owns subprocesses.
 * @param {{home: string, profileDir: string}} layout
 * @param {{root?: string, reinstall?: boolean}} [options]
 * @returns {{mode: 'cached'|'install', hash: string}}
 */
export function installDecision(layout, { root = repoRoot, reinstall = false } = {}) {
  const stampPath = join(layout.profileDir, '.ourfairy-source-hash')
  const hash = productSourceHash(root)
  const stamped = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : undefined
  const mode = !reinstall && existsSync(profileLinkedManifestPath(layout, root)) && stamped === hash ? 'cached' : 'install'
  return { mode, hash }
}

/** Record the product-source hash an install was built from. */
export function writeSourceStamp(layout, hash) {
  writeFileSync(join(layout.profileDir, '.ourfairy-source-hash'), `${hash}\n`)
}

/** The probe overlay path, refusing a probe package that does not ship one. */
export function probeOverlayPath(root = repoRoot) {
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
 * @param {{patches: string[]}} options
 * @param {string} [root] - repository root.
 * @returns {string[]}
 */
export function bootPatches(options, root = repoRoot) {
  return [probeOverlayPath(root), ...options.patches]
}
