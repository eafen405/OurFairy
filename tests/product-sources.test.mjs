/**
 * Product-source coverage for ticket #48, observed at the composition seam.
 *
 * The profile is a copy, not a link: pnpm installs each linked product package
 * into the isolated home, so the worktree's current sources only take effect
 * when the launcher decides the installed copy is stale. That decision is a
 * content hash over the product sources, so a source file the hash does not
 * cover leaves the tests booting the previous install while `npm test` stays
 * green.
 *
 * Ticket #156 moved that fact into `scripts/ourfairy-composition.mjs`, so the
 * assertions import it directly: the hashed set and the cached/install decision
 * are composition facts, not something a subprocess has to report back. The
 * decision's two written inputs — the profile and its source stamp — are
 * produced by the same composition functions the launcher calls.
 *
 * The composition runs against a throwaway copy of the product sources: this
 * file adds a source file to observe staleness, and doing that in the worktree
 * made every parallel `start` of another suite hash a product tree that was
 * changing under it (an install could fail when the file disappeared again). A
 * copy keeps the mutation local without changing the real worktree.
 *
 * One case still runs the real launcher: whether the install copied the file or
 * linked it is an inode fact, and no composition function can answer it. That
 * case asks the doctor to install into a home and compares the two files.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { after, test } from 'node:test'
import {
  copyProfileTemplate,
  installDecision,
  layoutOf,
  productSourceHash,
  productSources,
  profileLinkedManifestPath,
  profileTemplateDir,
  writeProfile,
  writeSourceStamp,
} from '../scripts/ourfairy-composition.mjs'
import { copyProductRepo, describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'

/** The throwaway repository the composition reads; the worktree itself stays untouched. */
const repoCopy = copyProductRepo('ourfairy-product-sources-repo-')
const homes = []
/** Repository copies a case needs to keep clear of the stand-in template above. */
const roots = []

/**
 * A product file that no hand-maintained list would know about yet.
 *
 * The identity package publishes its build output, so a file it publishes
 * lives in its `dist`: the probe writes there, where the package's own
 * `files` entry picks it up.
 */
const addedSource = join(repoCopy, 'backend', 'identity', 'dist', 'staleness-probe.js')

after(() => {
  rmSync(addedSource, { force: true })
  rmSync(repoCopy, { recursive: true, force: true })
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  for (const home of homes) removeHome(home)
})

/**
 * An isolated home holding the two inputs a successful install leaves behind:
 * the generated profile with its content stamp, and the linked bundle manifest
 * pnpm would have created. `installDecision` reads exactly those, so this is the
 * "unchanged since the last install" state.
 */
function installedProfile() {
  const home = makeHome('ourfairy-product-sources-')
  homes.push(home)
  const layout = layoutOf(home, repoCopy)
  writeProfile(layout, repoCopy)
  writeSourceStamp(layout, productSourceHash(repoCopy))
  const linked = profileLinkedManifestPath(layout, repoCopy)
  mkdirSync(dirname(linked), { recursive: true })
  writeFileSync(linked, '{}\n')
  return layout
}

/**
 * The files the product packages publish, read from the manifests and the disk
 * here.
 *
 * The expectation comes from each package's `files` declaration rather than from
 * a hardcoded `src/` list: a package that publishes its build output instead of
 * its sources is still fully covered by the staleness hash, and a source file
 * the manifest does not publish is not published at all. The glob semantics are
 * re-implemented here on purpose — the composition expands the entries with
 * Node's resolver, and a test that used the same resolver would only prove that
 * both sides made the same mistake.
 * @param {string} root - repository root to walk.
 * @returns {string[]} repo-relative paths.
 */
function copiedSources(root) {
  const published = new Set()
  for (const dir of readdirSync(join(root, 'backend'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const packageDir = `backend/${dir.name}`
    const manifestPath = join(root, packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // npm always ships package.json, whether `files` names it or not.
    published.add(`${packageDir}/package.json`)
    const entries = manifest.files ?? []
    for (const file of readdirSync(join(root, packageDir), { recursive: true })) {
      if (!statSync(join(root, packageDir, file)).isFile()) continue
      const relativePath = file.split(sep).join('/')
      if (entries.some(entry => publishes(entry, relativePath))) published.add(`${packageDir}/${relativePath}`)
    }
  }
  return [...published].sort()
}

/**
 * Whether one `files` entry publishes one package-relative path, with npm's
 * glob semantics: `*` stays inside a path segment, `**` spans segments, and a
 * plain path publishes the file itself or everything under the directory.
 * @param {string} entry - one `files` entry, package-relative.
 * @param {string} path - package-relative path.
 * @returns {boolean}
 */
function publishes(entry, path) {
  // A plain path names a file or a directory; a directory publishes everything
  // under it, which is what `files: ["src"]` means.
  if (!entry.includes('*')) return path === entry || path.startsWith(`${entry}/`)
  const segments = entry.split('/')
  const parts = path.split('/')
  const match = (pattern, rest) => {
    if (pattern.length === 0) return rest.length === 0
    if (pattern[0] === '**') return rest.some((_, index) => match(pattern.slice(1), rest.slice(index)))
    if (rest.length === 0) return false
    return segmentMatches(pattern[0], rest[0]) && match(pattern.slice(1), rest.slice(1))
  }
  return match(segments, parts)
}

/**
 * Whether one path segment matches one glob segment.
 * @param {string} pattern
 * @param {string} name
 * @returns {boolean}
 */
function segmentMatches(pattern, name) {
  const source = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('[^/]*')
  return new RegExp(`^${source}$`, 'u').test(name)
}

test('the hashed set follows what the packages publish, not their test fixtures', () => {
  const files = productSources(repoCopy)

  const testOnly = files.filter(file => file.includes('/test-support/'))
  assert.deepEqual(
    testOnly,
    [],
    'test-support fixtures are loaded from the worktree by tests and never installed into the profile,'
      + ' so they must not decide profile staleness',
  )

  // A published asset outside src/ must be covered too: deriving from src/ and
  // package.json alone would drop the wheel the PDF worker loads.
  assert.ok(
    files.includes('backend/attachments/pdf/pypdf-6.21.0-py3-none-any.whl'),
    `the PDF wheel ships in the installed package, so it must be hashed; the composition listed ${files.join(', ')}`,
  )

  const published = copiedSources(repoCopy)
  const missing = published.filter(file => !files.includes(file))
  assert.deepEqual(missing, [], `published product file(s) left out of the staleness hash: ${missing.join(', ')}`)

  // The other direction: every hashed entry is a file that actually publishes,
  // so the hash cannot be fed a path that no install copies.
  const absent = files.filter(file => !published.includes(file))
  assert.deepEqual(absent, [], `hashed product source(s) the manifests do not publish: ${absent.join(', ')}`)
})

test('a package that publishes its build output is hashed by that output', () => {
  const files = productSources(repoCopy)

  assert.ok(
    files.includes('backend/http/dist/http.js'),
    `the http package publishes its build output, so the hash must cover it; the composition listed ${files.join(', ')}`,
  )
  assert.ok(
    !files.some(file => file.startsWith('backend/http/src/')),
    `the http package publishes dist, not src, so its sources must not decide profile staleness; the composition listed ${files.join(', ')}`,
  )
})

test('a files entry that publishes no file is refused instead of silently skipped', () => {
  const root = copyProductRepo('ourfairy-product-sources-empty-')
  roots.push(root)
  const dist = join(root, 'backend', 'http', 'dist')
  for (const shape of ['missing', 'empty']) {
    rmSync(dist, { recursive: true, force: true })
    if (shape === 'empty') mkdirSync(dist, { recursive: true })
    assert.throws(
      () => productSources(root),
      (error) => {
        assert.match(error.message, /backend\/http/u, `the failure must name the package: ${error.message}`)
        assert.match(error.message, /dist\/\*\*\/\*\.js/u, `the failure must name the files entry: ${error.message}`)
        assert.match(error.message, /npm run build/u, `the failure must name the remedy: ${error.message}`)
        return true
      },
      `a ${shape} dist must be refused, not hashed as an empty set`,
    )
  }
})

test('unchanged product sources decide cached', () => {
  const layout = installedProfile()
  const decision = installDecision(layout, { root: repoCopy })
  assert.equal(
    decision.mode,
    'cached',
    'the profile and its stamp already describe the current product sources, so the launcher must reuse the install',
  )
  assert.equal(typeof decision.hash, 'string', 'the decision must carry the hash the install was judged against')
})

test('reinstall decides install even when the installed profile is current', () => {
  const layout = installedProfile()
  assert.equal(
    installDecision(layout, { root: repoCopy, reinstall: true }).mode,
    'install',
    'an explicit --reinstall must bypass the cached decision',
  )
})

test('a missing linked bundle manifest decides install', () => {
  const layout = installedProfile()
  rmSync(profileLinkedManifestPath(layout, repoCopy))
  assert.equal(
    installDecision(layout, { root: repoCopy }).mode,
    'install',
    'a profile whose linked bundle manifest is gone cannot be reused, even with a matching stamp',
  )
})

test('a new product source file changes the hash and decides install', () => {
  const layout = installedProfile()
  const before = productSourceHash(repoCopy)
  const added = relative(repoCopy, addedSource)
  mkdirSync(dirname(addedSource), { recursive: true })
  writeFileSync(addedSource, '// Ticket #48 staleness probe: a product source added after the last install.\n')
  try {
    const after = productSourceHash(repoCopy)
    assert.notEqual(after, before, `${added} is published by its package, so its content must reach the staleness hash`)
    assert.ok(
      productSources(repoCopy).includes(added),
      `the hashed source set must cover ${added}; it listed ${productSources(repoCopy).length} file(s)`,
    )
    assert.equal(
      installDecision(layout, { root: repoCopy }).mode,
      'install',
      `${added} changed the product sources, so the installed copy is stale and must be rebuilt`,
    )
  } finally {
    rmSync(addedSource, { force: true })
  }
})

/** A home holding a written profile and, optionally, a published template. */
function templateFixture() {
  const home = makeHome('ourfairy-template-')
  homes.push(home)
  const layout = layoutOf(home, repoCopy)
  writeProfile(layout, repoCopy)
  const hash = productSourceHash(repoCopy)
  const template = profileTemplateDir(repoCopy, hash)
  mkdirSync(join(template, 'node_modules', '@ourfairy', 'dsh-identity'), { recursive: true })
  writeFileSync(join(template, 'node_modules', '@ourfairy', 'dsh-identity', 'marker.txt'), 'template\n')
  writeFileSync(join(template, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  return { home, layout, hash, template }
}

test('a published template is copied instead of installed, and cached only with a stamp', () => {
  const { layout, hash, template } = templateFixture()

  assert.deepEqual(installDecision(layout, { root: repoCopy }), { mode: 'copy', hash, template },
    'no stamp plus a same-hash template must copy')
  copyProfileTemplate(layout, template)
  assert.equal(readFileSync(join(layout.profileDir, 'node_modules', '@ourfairy', 'dsh-identity', 'marker.txt'), 'utf8'), 'template\n')
  assert.equal(readFileSync(join(layout.profileDir, 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9\n')

  // The copy is independent of the template in both directions.
  writeFileSync(join(layout.profileDir, 'node_modules', '@ourfairy', 'dsh-identity', 'marker.txt'), 'edited\n')
  assert.equal(readFileSync(join(template, 'node_modules', '@ourfairy', 'dsh-identity', 'marker.txt'), 'utf8'), 'template\n')

  // With the linked bundle manifest and a matching stamp the home is cached.
  const linked = profileLinkedManifestPath(layout, repoCopy)
  mkdirSync(dirname(linked), { recursive: true })
  writeFileSync(linked, '{}\n')
  writeSourceStamp(layout, hash)
  assert.equal(installDecision(layout, { root: repoCopy }).mode, 'cached')
  assert.equal(installDecision(layout, { root: repoCopy, reinstall: true }).mode, 'install',
    '--reinstall must still perform a real install')
})

/**
 * The install is a copy, not a link, and only a real install can show it.
 *
 * The hash and template cases above observe the decision; none of them can see
 * whether pnpm linked the worktree file or copied it. A linked copy would pass
 * every hash assertion and then follow later source edits, so the difference is
 * only visible as an inode comparison between the worktree and the installed
 * profile — and only after a real install has run.
 *
 * This case gets its own repository copy: the template case above publishes a
 * stand-in template for the current source hash, and a doctor reading that
 * shared copy would copy the stand-in instead of installing, leaving no real
 * product files to compare.
 */
test('an installed product file is a copy of its source, not the same file', () => {
  const root = copyProductRepo('ourfairy-product-sources-install-')
  roots.push(root)
  const home = makeHome('ourfairy-product-sources-isolation-')
  homes.push(home)
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  }, { root })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)

  const source = join(root, 'backend', 'v1-bundle', 'cordis.patch.yml')
  const installed = join(
    home, 'dsh-home', 'profiles', 'ourfairy', 'node_modules', '@ourfairy', 'dsh-v1-bundle', 'cordis.patch.yml',
  )
  assert.ok(existsSync(installed), `the install must place the bundle's patch in the profile: ${installed}\n${describeRun('doctor', run)}`)
  assert.notEqual(
    statSync(installed).ino, statSync(source).ino,
    'the installed file must be a copy; a shared inode would follow every later source edit',
  )

  const original = readFileSync(source, 'utf8')
  writeFileSync(installed, `${original}# edited in the installed profile\n`)
  assert.equal(
    readFileSync(source, 'utf8'), original,
    'editing the installed copy must not reach the worktree source',
  )

  writeFileSync(source, `${original}# edited in the worktree\n`)
  try {
    assert.equal(
      readFileSync(installed, 'utf8'), `${original}# edited in the installed profile\n`,
      'the installed copy must not follow later source edits',
    )
  } finally {
    writeFileSync(source, original)
  }
})
