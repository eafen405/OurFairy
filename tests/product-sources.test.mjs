/**
 * Product-source coverage for ticket #48.
 *
 * The profile is a copy, not a link: pnpm installs each linked product package
 * into the isolated home, so the worktree's current sources only take effect
 * when the launcher decides the installed copy is stale. That decision is a
 * content hash over the product sources, so a source file the hash does not
 * cover leaves the tests booting the previous install while `npm test` stays
 * green.
 *
 * The assertions below drive `doctor --json`, whose "product packages" check
 * names the files the hash covers and whose "profile project linked" check
 * names the install mode the launcher chose. Both are facts the launcher
 * reports; no test reaches into the launcher's internals.
 *
 * The launcher runs against a throwaway copy of the product sources: this file
 * adds a source file to observe staleness, and doing that in the worktree made
 * every parallel `start` of another suite hash a product tree that was changing
 * under it (an install could fail when the file disappeared again). A copy keeps
 * the mutation local without replacing the real launcher.
 */
import assert from 'node:assert/strict'
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { after, test } from 'node:test'
import { copyProductRepo, describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'

/** One isolated home for the file: every assertion here is about staleness across runs. */
const home = makeHome('ourfairy-product-sources-')

/** The throwaway repository the launcher reads; the worktree itself stays untouched. */
const repoCopy = copyProductRepo('ourfairy-product-sources-repo-')

/** A product source file that no hand-maintained list would know about yet. */
const addedSource = join(repoCopy, 'backend', 'identity', 'src', 'staleness-probe.mjs')

after(() => {
  rmSync(addedSource, { force: true })
  rmSync(repoCopy, { recursive: true, force: true })
  removeHome(home)
})

/**
 * Run `doctor --json` in the shared home and report what it observed.
 *
 * Only the two checks about the installed source corpus are asserted here; the
 * command's exit code deliberately is not, because an unrelated check (another
 * checkout in the version combination drifting) must not decide what the
 * profile-install tests observe.
 */
function doctor() {
  const run = runBackend(['doctor', '--json'], {
    OURFAIRY_HOME: home,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  }, { root: repoCopy })
  const start = run.stdout.indexOf('{')
  assert.ok(start >= 0, `doctor printed no JSON report:\n${describeRun('doctor', run)}`)
  const report = JSON.parse(run.stdout.slice(start))
  const checks = new Map(report.checks.map(check => [check.name, check]))

  const linked = checks.get('profile project linked')
  assert.equal(linked?.ok, true, `doctor did not link the profile: ${JSON.stringify(linked)}`)
  const mode = /\(([a-z]+)\)$/.exec(linked.detail ?? '')?.[1]
  assert.ok(
    mode === 'installed' || mode === 'cached',
    `the "profile project linked" check must report the install mode it chose; detail was ${JSON.stringify(linked.detail)}`,
  )

  const packages = checks.get('product packages')
  assert.equal(packages?.ok, true, `doctor did not pass "product packages": ${JSON.stringify(packages)}`)
  return { mode, files: packages.detail.split(', ') }
}

/**
 * Product sources walked from the launcher's copy: every packaged file under a
 * `src/` directory plus each package's manifest. Expected coverage is built
 * from the disk here, never from whatever the launcher chose to report.
 */
function copiedSources() {
  const found = []
  for (const file of readdirSync(join(repoCopy, 'backend'), { recursive: true })) {
    const parts = file.split(sep)
    if (parts.length < 2 || !statSync(join(repoCopy, 'backend', file)).isFile()) continue
    const rest = parts.slice(1).join('/')
    if (rest === 'package.json' || rest.startsWith('src/')) found.push(`backend/${parts[0]}/${rest}`)
  }
  return found
}

test('an unchanged worktree reuses the installed profile instead of reinstalling it', () => {
  assert.equal(doctor().mode, 'installed', 'the first doctor run into an empty home must install the profile')
  assert.equal(doctor().mode, 'cached', 'a second run over unchanged product sources must reuse the install')
})

test('the hashed set follows what the packages publish, not their test fixtures', () => {
  const { files } = doctor()

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
    `the PDF wheel ships in the installed package, so it must be hashed; doctor listed ${files.join(', ')}`,
  )

  const missing = copiedSources().filter(file => !files.includes(file))
  assert.deepEqual(missing, [], `product source(s) left out of the staleness hash: ${missing.join(', ')}`)
})

test('a new product source file invalidates the installed profile', () => {
  const added = relative(repoCopy, addedSource)
  writeFileSync(addedSource, '// Ticket #48 staleness probe: a product source added after the last install.\n')
  try {
    const afterAdd = doctor()
    assert.equal(
      afterAdd.mode,
      'installed',
      `${added} changed the product sources, so its content must reach the staleness hash and rebuild the install;`
        + ` doctor reported '${afterAdd.mode}' and would have kept booting the previous copy`,
    )
    assert.ok(
      afterAdd.files.includes(added),
      `the "product packages" check must cover ${added}; it listed ${afterAdd.files.length} file(s): ${afterAdd.files.join(', ')}`,
    )
    assert.equal(doctor().mode, 'cached', 'the rebuilt profile must be reused until a product source changes again')
  } finally {
    rmSync(addedSource, { force: true })
  }
})
