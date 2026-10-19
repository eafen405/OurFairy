/**
 * The ecosystem-boundary doc must stay a pointer, not a second copy (ticket #97).
 *
 * The doc records which dsh seams the product deliberately does not use and why
 * the business store, identity and scoped file/sandbox providers stay product
 * implementations. Two failure modes make such a document worse than none:
 *
 * - it restates the row set or package set. Those have one authority each —
 *   `backend/v1-bundle/cordis.patch.yml` (the file the loader reads) and
 *   `backend/v1-bundle/package.json` — and #99–#101 are changing both right now.
 *   This test reads the authorities at run time and fails if the doc quotes any
 *   row id or mounted package as its own copy.
 * - it names a check that no longer exists. Every adopted limitation in the doc
 *   names a test that would fail if the limitation stopped being true; these
 *   assertions hold each citation to a real test title in the cited file.
 *
 * The prose itself is still a review question; this file pins the structural
 * facts the ticket asks for and, for the row/package authorities, derives what
 * a copy would look like from the authorities themselves.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

const docPath = join(repoRoot, 'docs', 'architecture', 'dsh-ecosystem-boundary.md')
const docRelative = 'docs/architecture/dsh-ecosystem-boundary.md'
const bundlePath = join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml')
const bundleManifestPath = join(repoRoot, 'backend', 'v1-bundle', 'package.json')
const readmePath = join(repoRoot, 'README.md')

/** The boundary doc as a reader sees it. */
function readDoc() {
  assert.ok(
    existsSync(docPath),
    'docs/architecture/dsh-ecosystem-boundary.md must exist; ticket #97 delivers it',
  )
  return readFileSync(docPath, 'utf8')
}

/**
 * The rows the bundle mounts, read from the file the loader reads.
 *
 * Bundle rows sit at four-space indentation; deeper `- id:` lines belong to row
 * config (the model catalog). Parsing those as rows would make this check
 * disagree with the runtime it claims to follow.
 * @returns {{ id: string, package: string }[]}
 */
function mountedRows() {
  const rows = []
  let current
  for (const line of readFileSync(bundlePath, 'utf8').split('\n')) {
    const id = /^ {4}- id: (\S+)\s*$/u.exec(line)
    if (id !== null) {
      current = id[1]
      continue
    }
    const name = /^ {6}name: '([^']+)'\s*$/u.exec(line)
    if (name !== null && current !== undefined) {
      rows.push({ id: current, package: name[1] })
      current = undefined
    }
  }
  assert.ok(
    rows.length > 5,
    `backend/v1-bundle/cordis.patch.yml must still be parsed as a row list; found ${rows.length} row(s)`,
  )
  return rows
}

/** Package names `backend/v1-bundle/package.json` declares as the product set. */
function declaredPackages() {
  const manifest = JSON.parse(readFileSync(bundleManifestPath, 'utf8'))
  return Object.keys(manifest.dependencies ?? {})
}

/** Everything the doc quotes as an identifier (`...`). */
function quotedSpans(text) {
  return new Set([...text.matchAll(/`([^`\n]+)`/gu)].map(match => match[1]))
}

/**
 * Every adopted limitation and the test that would fail if it stopped holding.
 *
 * The doc must name each pair; the cited file must still run each test. A
 * renamed or deleted test fails here, which is the point: the doc's claim "this
 * check covers it" is only worth the assertion behind it.
 */
const CITED_CHECKS = [
  ['tests/identity-http.test.mjs',
    'the provisioned Phaethon signs in as short number 1'],
  ['tests/identity-http.test.mjs',
    'a request for an untrusted Host is refused by the same fence the /api route uses'],
  ['tests/identity-http.test.mjs',
    'a session credential admits dsh /api while an anonymous request is refused at the door'],
  ['tests/owned-sessions.test.mjs',
    'cold ownerless and foreign sessions are refused without changing durable artifacts'],
  ['tests/remote-chat.test.mjs',
    'all remote paths reject anonymous and foreign owners, including administrator, before cold resume'],
  ['tests/remote-chat.test.mjs',
    'SSE preserves every text prefix and disconnecting observation leaves the backend reply running'],
  ['tests/identity-http.test.mjs',
    'concurrent registrations never share a short number and never half-succeed'],
  ['tests/identity-http.test.mjs',
    'the credential names its own holder with no user field in the request'],
  ['tests/spaces.test.mjs',
    'chat tools write own private files, share public files, and deny another user including administrator'],
  ['tests/spaces.test.mjs',
    'real child processes share public files, keep private boundaries after cd, and retain networking'],
  ['tests/spaces.test.mjs',
    'directory changes, edits, image reads and symlinks retain the same owner boundary'],
  ['tests/spaces.test.mjs',
    'agentless filesystem and script Interface calls refuse instead of inheriting a default user'],
  ['tests/attachments.test.mjs',
    'unfinished and foreign receipts never grant message or download access, including identical stored bytes'],
  ['tests/product-sources.test.mjs',
    'an unchanged worktree reuses the installed profile instead of reinstalling it'],
]

test('the boundary doc is reachable from the repository README', () => {
  const readme = readFileSync(readmePath, 'utf8')
  assert.ok(
    readme.includes(`](${docRelative})`),
    `README.md must link ${docRelative} as a Markdown link; an unreachable boundary doc is not a boundary`,
  )
})

test('the doc names the parallel-transport exception and the /api admission boundary', () => {
  const doc = readDoc()
  for (const seam of ['/api', 'Connection', 'Remote', 'Typert', 'SSE', 'webServer', 'connection.fence']) {
    assert.ok(
      doc.includes(seam),
      `the doc must name ${seam} when it records which native seams the product does not use`,
    )
  }
  for (const claim of ['已经完全原生', 'fully native']) {
    assert.ok(
      doc.includes(claim) === false,
      `the doc must not claim the product is ${claim}; the transport is a recorded exception`,
    )
  }
})

test('the doc points at the row and package authorities instead of copying them', () => {
  const doc = readDoc()
  for (const authority of [
    'backend/v1-bundle/cordis.patch.yml',
    'backend/v1-bundle/package.json',
    'tests/baseline-boot.test.mjs',
    'FORBIDDEN_ROW_IDS',
  ]) {
    assert.ok(
      doc.includes(authority),
      `the doc must point at ${authority} as the single authority instead of restating it`,
    )
  }

  const quoted = quotedSpans(doc)
  const restated = mountedRows()
    .filter(row => quoted.has(row.id) || quoted.has(row.package))
    .map(row => `${row.id} (${row.package})`)
  assert.deepEqual(
    restated,
    [],
    `the doc quotes bundle row(s)/package(s) it does not own: ${restated.join(', ')}`
    + ' — point at backend/v1-bundle/cordis.patch.yml instead',
  )

  const named = declaredPackages().filter(name => doc.includes(name))
  assert.deepEqual(
    named,
    [],
    `the doc names package(s) from backend/v1-bundle/package.json: ${named.join(', ')}`
    + ' — that list has one authority; do not keep a copy',
  )
})

test('the doc names the native capabilities each retained product implementation replaces', () => {
  const doc = readDoc()
  // The ticket asks for the reason each retained implementation is kept: what
  // the native capability lacks. Naming the native option is the structural
  // half of that; whether the reason is true stays a review question.
  for (const capability of ['ctx.storageDomain', 'authorization', 'fs-sandbox', 'sandbox-local']) {
    assert.ok(
      doc.includes(capability),
      `the doc must name ${capability} as the native capability it did not adopt, and say what it lacks`,
    )
  }
})

test('the bundle mounts no Gateway, Remote/Typert or plugin-manager package', () => {
  const absent = [/^@deepseek-ai\/dsh-api-gateway$/u, /^@deepseek-ai\/dsh-api-remotes$/u,
    /^@deepseek-ai\/dsh-typert-/u, /^@deepseek-ai\/dsh-plugin-manager/u]
  const mounted = mountedRows().filter(row => absent.some(pattern => pattern.test(row.package)))
  assert.deepEqual(
    mounted.map(row => `${row.id} (${row.package})`),
    [],
    'the boundary doc says these seams are not used; a bundle that mounts one makes the doc false',
  )
})

test('every product package stays unpublished', () => {
  // Derived from the packages that exist under backend/, not from a list: the
  // bundle manifest owns the install set, and this check has to hold before and
  // after that set moves.
  const manifests = readdirSync(join(repoRoot, 'backend'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join('backend', entry.name, 'package.json'))
    .filter(path => existsSync(join(repoRoot, path)))
  assert.ok(manifests.length > 0, 'backend/ must contain product package manifests')
  const published = manifests.filter(path => JSON.parse(readFileSync(join(repoRoot, path), 'utf8')).private !== true)
  assert.deepEqual(
    published,
    [],
    'the doc records npm publication as out of scope; a product package without "private": true contradicts it',
  )
})

test('the doc records the explicit non-goals', () => {
  const doc = readDoc()
  for (const nonGoal of ['plugin manager', 'npm', 'Android', '运行时']) {
    assert.ok(
      doc.includes(nonGoal),
      `the doc must record the out-of-scope item ${nonGoal}`,
    )
  }
})

test('every limitation names a check whose test title still exists', () => {
  const doc = readDoc()
  for (const [path, title] of CITED_CHECKS) {
    assert.ok(
      doc.includes(path),
      `the doc must cite ${path} as the check that fails when its limitation stops holding`,
    )
    assert.ok(
      doc.includes(title),
      `the doc must name the test "${title}" in ${path}, not just the file`,
    )
    const sourcePath = join(repoRoot, path)
    assert.ok(existsSync(sourcePath), `${path} must exist to be cited`)
    assert.ok(
      readFileSync(sourcePath, 'utf8').includes(title),
      `${path} no longer runs the test "${title}" the boundary doc cites; update the doc or restore the check`,
    )
  }
})
