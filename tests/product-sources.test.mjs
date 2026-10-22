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
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
import { copyProductRepo, makeHome, removeHome } from './helpers/backend.mjs'

/** The throwaway repository the composition reads; the worktree itself stays untouched. */
const repoCopy = copyProductRepo('ourfairy-product-sources-repo-')
const homes = []

/** A product source file that no hand-maintained list would know about yet. */
const addedSource = join(repoCopy, 'backend', 'identity', 'src', 'staleness-probe.mjs')

after(() => {
  rmSync(addedSource, { force: true })
  rmSync(repoCopy, { recursive: true, force: true })
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
 * Product sources walked from the copy: every packaged file under a `src/`
 * directory plus each package's manifest. Expected coverage is built from the
 * disk here, never from whatever the composition chose to report.
 */
function copiedSources(root) {
  const found = []
  for (const file of readdirSync(join(root, 'backend'), { recursive: true })) {
    const parts = file.split(sep)
    if (parts.length < 2 || !statSync(join(root, 'backend', file)).isFile()) continue
    const rest = parts.slice(1).join('/')
    if (rest === 'package.json' || rest.startsWith('src/')) found.push(`backend/${parts[0]}/${rest}`)
  }
  return found
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

  const missing = copiedSources(repoCopy).filter(file => !files.includes(file))
  assert.deepEqual(missing, [], `product source(s) left out of the staleness hash: ${missing.join(', ')}`)

  // The other direction: every hashed entry is a file that actually publishes,
  // so the hash cannot be fed a path that no install copies.
  const absent = files.filter(file => !statSync(join(repoCopy, file)).isFile())
  assert.deepEqual(absent, [], `hashed product source(s) missing from the copy: ${absent.join(', ')}`)
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
