/**
 * Ticket #298: address install, extraction safety and fixed-source recording.
 *
 * The first half drives the install module directly (address parsing, the tar
 * reader's refusals, the GitHub/direct fetch against a loopback stub); the
 * second half boots the real product in `tests/skill-install-product.test.mjs`.
 * The stub speaks the two endpoints the GitHub path uses, so no test reaches
 * the network.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { tarGz, skillPackageEntries } from './helpers/tar-archive.mjs'

const root = mkdtempSync(join(tmpdir(), 'ourfairy-skill-install-unit-'))
const installModule = await import('../backend/skill-creator/dist/install.js')
const { SkillInstall, extractSkillArchive, installBasesFromEnv, parseInstallAddress } = installModule

const SHA_ONE = 'a'.repeat(40)
const SHA_TWO = 'b'.repeat(40)

let server
let apiBase
let directUrl
let archiveOne
let archiveTwo
const requests = []
let refSha = SHA_ONE
let servedArchive = null

/** The SHA-256 of one byte buffer, lower-case hex. */
function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** One fetch of the whole request body. */
async function bodyOf(incoming) {
  const chunks = []
  for await (const chunk of incoming) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Answer one JSON document. */
function json(response, status, value, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.byteLength, ...headers })
  response.end(bytes)
}

before(async () => {
  archiveOne = tarGz([
    ...skillPackageEntries(`skills-${SHA_ONE}/skills/demo`, {
      name: 'installed-demo',
      description: 'Use when running the installed demo.',
      extra: { 'references/guide.md': 'INSTALLED GUIDE ONE' },
    }),
    { path: `skills-${SHA_ONE}/README.md`, content: 'repository readme' },
  ])
  archiveTwo = tarGz(skillPackageEntries(`skills-${SHA_TWO}/skills/demo`, {
    name: 'installed-demo',
    description: 'Use when running the installed demo.',
    extra: { 'references/guide.md': 'INSTALLED GUIDE TWO' },
  }))

  server = http.createServer(async (incoming, response) => {
    const body = await bodyOf(incoming)
    const url = new URL(incoming.url, 'http://stub.invalid')
    requests.push({ method: incoming.method, path: url.pathname, headers: incoming.headers, body })
    if (url.pathname === '/repos/acme/skills/commits/main') {
      json(response, 200, { sha: refSha })
      return
    }
    if (url.pathname === `/acme/skills/tar.gz/${SHA_ONE}`) {
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archiveOne.byteLength })
      response.end(archiveOne)
      return
    }
    if (url.pathname === `/acme/skills/tar.gz/${SHA_TWO}`) {
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archiveTwo.byteLength })
      response.end(archiveTwo)
      return
    }
    if (url.pathname === '/direct/skill.tar.gz') {
      servedArchive ??= tarGz([
        ...skillPackageEntries('demo', {
          name: 'direct-demo',
          description: 'Use when installing a direct archive.',
          extra: { 'LICENSE': 'MIT License\n\nPermission is hereby granted.' },
        }),
      ])
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': servedArchive.byteLength,
        etag: '"archive-v1"',
        'last-modified': 'Tue, 01 Jan 2030 00:00:00 GMT',
      })
      response.end(servedArchive)
      return
    }
    json(response, 404, { message: `unexpected stub path ${url.pathname}` })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  apiBase = `http://127.0.0.1:${server.address().port}`
  directUrl = `${apiBase}/direct/skill.tar.gz`
})

after(async () => {
  if (server !== undefined) await new Promise(resolve => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
})

describe('install address parsing', () => {
  test('recognises a GitHub tree, a GitHub blob with a SKILL.md tail and the shorthand', () => {
    assert.deepEqual(parseInstallAddress('https://github.com/acme/skills/tree/main/skills/demo'), {
      kind: 'github', address: 'https://github.com/acme/skills/tree/main/skills/demo',
      owner: 'acme', repo: 'skills', ref: 'main', path: ['skills', 'demo'],
    })
    assert.deepEqual(parseInstallAddress('https://github.com/acme/skills/blob/v1.2.0/skills/demo/SKILL.md'), {
      kind: 'github', address: 'https://github.com/acme/skills/blob/v1.2.0/skills/demo/SKILL.md',
      owner: 'acme', repo: 'skills', ref: 'v1.2.0', path: ['skills', 'demo'],
    })
    assert.deepEqual(parseInstallAddress('github:acme/skills/skills/demo@main'), {
      kind: 'github', address: 'github:acme/skills/skills/demo@main',
      owner: 'acme', repo: 'skills', ref: 'main', path: ['skills', 'demo'],
    })
  })

  test('recognises direct tar.gz and tgz URLs and refuses zip with a clear code', () => {
    assert.deepEqual(parseInstallAddress('https://example.invalid/packages/demo.tar.gz'), {
      kind: 'archive', address: 'https://example.invalid/packages/demo.tar.gz',
    })
    assert.deepEqual(parseInstallAddress('http://example.invalid/demo.tgz?download=1'), {
      kind: 'archive', address: 'http://example.invalid/demo.tgz?download=1',
    })
    assert.throws(() => parseInstallAddress('https://example.invalid/demo.zip'), error =>
      error.code === 'skills/unsupported-archive' && /zip/u.test(error.message))
    assert.throws(() => parseInstallAddress('https://example.invalid/demo.tar'), error =>
      error.code === 'skills/unsupported-archive')
  })

  test('refuses non-http schemes, traversal and a blob that does not end in SKILL.md', () => {
    for (const address of [
      'ftp://example.invalid/demo.tar.gz',
      'file:///tmp/demo.tar.gz',
      'github:acme/skills/../secret@main',
      'github:acme/skills/skills/demo',
      'https://github.com/acme/skills/blob/main/skills/demo/references/guide.md',
    ]) {
      assert.throws(() => parseInstallAddress(address), error => /skills\/(invalid-address|invalid-archive)/u.test(error.code),
        `address must be refused: ${address}`)
    }
  })
})

describe('archive extraction', () => {
  /** Extract one archive into a fresh directory and answer its package root. */
  function extract(entries, options = {}) {
    const target = join(root, `extract-${Math.random().toString(16).slice(2)}`)
    mkdirSync(target, { recursive: true })
    try {
      return extractSkillArchive(tarGz(entries), { targetDir: target, ...options })
    } finally {
      // The caller reads what it needs before this helper returns; the package
      // directory is under target and is removed with it by each test's cleanup.
    }
  }

  test('accepts a single top-level package directory and a SKILL.md at the archive root', () => {
    const nested = extract(skillPackageEntries('demo'))
    assert.equal(readFileSync(join(nested, 'SKILL.md'), 'utf8').includes('name: installed-skill'), true)

    const flat = extract([{ path: 'SKILL.md', content: '---\nname: flat\ndescription: Flat.\n---\n\n# Flat\n' }])
    assert.equal(existsSync(join(flat, 'SKILL.md')), true)
  })

  test('refuses traversal, absolute paths, backslashes, NUL and symlinks or hardlinks', () => {
    const cases = [
      [{ path: 'demo/../evil.txt', content: 'evil' }, /\.\.|invalid/u],
      [{ path: '/etc/passwd', content: 'evil' }, /absolute|invalid/u],
      [{ path: 'demo\\evil.txt', content: 'evil' }, /backslash|separator|invalid/u],
      [{ path: 'demo/evil\0.txt', content: 'evil' }, /NUL|invalid/u],
      [{ path: 'demo/link', type: 'symlink', linkname: '/etc/passwd' }, /symlink|link/u],
      [{ path: 'demo/hard', type: 'hardlink', linkname: 'demo/SKILL.md' }, /hardlink|link/u],
    ]
    for (const [entry, pattern] of cases) {
      const target = join(root, `hostile-${Math.random().toString(16).slice(2)}`)
      mkdirSync(target, { recursive: true })
      const parent = join(target, '..')
      assert.throws(
        () => extractSkillArchive(tarGz([{ path: 'demo/SKILL.md', content: '---\nname: demo\ndescription: Demo.\n---\n\n# Demo\n' }, entry]), { targetDir: target }),
        error => error.code === 'skills/invalid-archive' && pattern.test(error.message),
        `entry must be refused: ${JSON.stringify(entry)}`,
      )
      assert.equal(existsSync(join(parent, 'evil.txt')), false, 'a refused archive writes nothing outside its target')
    }
  })

  test('refuses an oversized package, too many entries and two package roots', () => {
    const target = join(root, 'bounds')
    mkdirSync(target, { recursive: true })
    assert.throws(
      () => extractSkillArchive(tarGz(skillPackageEntries('demo', { extra: { 'big.bin': 'x'.repeat(2048) } })),
        { targetDir: target, maxBytes: 1024 }),
      error => error.code === 'skills/install-too-large',
    )
    assert.throws(
      () => extractSkillArchive(tarGz(skillPackageEntries('demo', { extra: { 'a.md': 'a', 'b.md': 'b' } })),
        { targetDir: target, maxFiles: 2 }),
      error => error.code === 'skills/install-too-large',
    )
    assert.throws(
      () => extractSkillArchive(tarGz([
        ...skillPackageEntries('one', { name: 'one' }),
        ...skillPackageEntries('two', { name: 'two' }),
      ]), { targetDir: target }),
      error => error.code === 'skills/invalid-archive' && /one skill package/u.test(error.message),
    )
  })
})

describe('fetching a fixed package', () => {
  test('resolves a GitHub ref to a commit, downloads the commit tarball and records the source', async () => {
    refSha = SHA_ONE
    const install = new SkillInstall({ root, maxBytes: 1024 * 1024, apiBase, codeloadBase: apiBase })
    const fetched = await install.fetch('https://github.com/acme/skills/tree/main/skills/demo')
    try {
      assert.equal(fetched.source.address, 'https://github.com/acme/skills/tree/main/skills/demo')
      assert.equal(fetched.source.resolvedVersion, SHA_ONE)
      assert.equal(fetched.source.digest, digestOf(archiveOne))
      assert.ok(fetched.source.fetchedAt > 0)
      assert.equal(readFileSync(join(fetched.packageDir, 'references', 'guide.md'), 'utf8'), 'INSTALLED GUIDE ONE')
      assert.equal(existsSync(join(fetched.packageDir, 'README.md')), false, 'only the skill subtree is extracted')
      assert.equal(fetched.license, undefined)
      assert.ok(requests.some(request => request.path === `/repos/acme/skills/commits/main`))
      assert.ok(requests.some(request => request.path === `/acme/skills/tar.gz/${SHA_ONE}`))
    } finally {
      fetched.cleanup()
    }
    assert.equal(existsSync(fetched.packageDir), false, 'cleanup removes the staging directory')
  })

  test('a ref change after the fetch cannot rewrite the fetched package', async () => {
    refSha = SHA_ONE
    const install = new SkillInstall({ root, maxBytes: 1024 * 1024, apiBase, codeloadBase: apiBase })
    const first = await install.fetch('github:acme/skills/skills/demo@main')
    try {
      const before = readFileSync(join(first.packageDir, 'references', 'guide.md'), 'utf8')
      refSha = SHA_TWO
      const second = await install.fetch('github:acme/skills/skills/demo@main')
      try {
        assert.equal(second.source.resolvedVersion, SHA_TWO)
        assert.equal(readFileSync(join(second.packageDir, 'references', 'guide.md'), 'utf8'), 'INSTALLED GUIDE TWO')
        assert.equal(readFileSync(join(first.packageDir, 'references', 'guide.md'), 'utf8'), before,
          'the earlier candidate keeps the bytes it fetched')
        assert.equal(first.source.resolvedVersion, SHA_ONE)
      } finally {
        second.cleanup()
      }
    } finally {
      first.cleanup()
    }
  })

  test('records the digest, ETag, Last-Modified and LICENSE of a direct archive', async () => {
    const install = new SkillInstall({ root, maxBytes: 1024 * 1024, apiBase, codeloadBase: apiBase })
    const fetched = await install.fetch(directUrl)
    try {
      assert.equal(fetched.source.resolvedVersion, digestOf(servedArchive))
      assert.equal(fetched.source.digest, digestOf(servedArchive))
      assert.equal(fetched.source.etag, '"archive-v1"')
      assert.equal(fetched.source.lastModified, 'Tue, 01 Jan 2030 00:00:00 GMT')
      assert.match(fetched.license ?? '', /MIT License/u)
      assert.ok(existsSync(join(fetched.packageDir, 'LICENSE')), 'the license file stays in the package')
    } finally {
      fetched.cleanup()
    }
  })

  test('refuses an unsupported archive before any request and an oversized download before buffering it', async () => {
    const install = new SkillInstall({ root, maxBytes: 1024, apiBase, codeloadBase: apiBase })
    const before = requests.length
    await assert.rejects(install.fetch('https://example.invalid/demo.zip'), error =>
      error.code === 'skills/unsupported-archive')
    assert.equal(requests.length, before, 'a refused format makes no request')

    // A valid gzip whose compressed bytes exceed the small bound is refused by
    // the download cap rather than accepted and cut.
    const large = tarGz([
      ...skillPackageEntries('demo', { name: 'large', description: 'Large.' }),
      { path: 'demo/references/blob.bin', content: randomBytes(4096) },
    ])
    assert.ok(large.byteLength > 1024)
    servedArchive = large
    await assert.rejects(install.fetch(directUrl), error =>
      error.code === 'skills/install-too-large')
  })
})

describe('install bases', () => {
  test('default to the real hosts and are overridable from the environment', () => {
    assert.deepEqual(installBasesFromEnv({}), {
      apiBase: 'https://api.github.com', codeloadBase: 'https://codeload.github.com',
    })
    assert.deepEqual(installBasesFromEnv({
      OURFAIRY_GITHUB_API_BASE: 'http://127.0.0.1:9/api',
      OURFAIRY_GITHUB_CODELOAD_BASE: 'http://127.0.0.1:9/codeload',
    }), { apiBase: 'http://127.0.0.1:9/api', codeloadBase: 'http://127.0.0.1:9/codeload' })
  })
})
