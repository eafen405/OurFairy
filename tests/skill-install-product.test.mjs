/**
 * Ticket #298: address install through the real product composition.
 *
 * A loopback stub speaks the GitHub commit document and codeload tarball, plus
 * direct archive URLs; the real launcher, real SQLite store and real review path
 * do the rest. The fixtures are real package bytes, so the recorded manifest
 * hash and license are read back from the row rather than recomputed here.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import http from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'
import { skillPackageEntries, tarGz } from './helpers/tar-archive.mjs'

const home = makeHome('ourfairy-skill-install-product-')
const password = 'skill-install-product-password'
const skillRoot = join(home, 'dsh-home', 'skill')
const databasePath = join(skillRoot, 'skill.sqlite')

const SHA_ONE = '1'.repeat(40)
const SHA_TWO = '2'.repeat(40)

let model
let stub
let stubBase
let port
let admin
let alice
let sessionAlice
let run
let requestNo = 0
let callNo = 0
const requests = []
const ids = {}
let refSha = SHA_ONE
let codeloadArchive = null
const stubRequests = []

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One product POST. */
function request(path, token, body = {}) {
  return httpJson(port, path, { token, body })
}

/** The SQLite rows behind the store, through a second connection. */
function rows(sql, ...parameters) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

/** One version row by id. */
function versionOf(versionId) {
  return rows('SELECT * FROM skill_version WHERE id = ?', versionId)[0]
}

/** The absolute directory of one version's package. */
function packageDirectory(versionId) {
  const version = versionOf(versionId)
  assert.ok(version, `version ${versionId} must exist`)
  return join(skillRoot, ...version.package_path.split('/'))
}

/** All text blocks of one model request, joined. */
function requestText(body) {
  return (body?.messages ?? []).flatMap(message => {
    const content = message.content
    if (typeof content === 'string') return [content]
    return Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text) : []
  }).join('\n')
}

/** The newest catalog message in one model request. */
function latestCatalog(body) {
  const catalogs = []
  for (const message of body?.messages ?? []) {
    const content = message.content
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.includes('<available_skills>')) catalogs.push(block.text)
    }
  }
  return catalogs.at(-1) ?? ''
}

/** Whether one catalog advertises a skill name. */
function catalogNames(text, name) {
  return text.includes(`- \`${name}\`:`) || text.includes(`- \`${name}\` `)
}

/** One turn's final reply; tool-only steps pass through with empty text. */
async function send(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `install-request-${++requestNo}`, text })
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seen.has(message.messageId) && message.text.startsWith('REPLY:'))
    if (reply) return projection
    if (projection.error) assert.fail(`the chat failed before the reply: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the reply never returned to ${sessionId}`)
}

/** The whole committed log of one session. */
async function readEvents(identity, sessionId) {
  const read = await request('/chat/read', identity.token, { sessionId })
  const cut = read.projection.cursor
  const events = []
  let beforeSeq = cut + 1
  while (beforeSeq > 0) {
    const { page } = await request('/chat/page', identity.token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 128 })
    events.unshift(...page.events)
    beforeSeq = page.beforeSeq ?? 0
  }
  return events
}

/** Every durable transcript row. */
async function allMessages(identity, sessionId) {
  const read = await request('/chat/read', identity.token, { sessionId })
  const cut = read.projection.cursor
  const messages = new Map()
  let beforeSeq = cut + 1
  while (beforeSeq > 0) {
    const { page } = await request('/chat/page', identity.token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 128 })
    for (const message of page.messages) messages.set(message.messageId, message)
    beforeSeq = page.beforeSeq ?? 0
  }
  return [...messages.values()].sort((left, right) => left.position - right.position)
}

/** One real model-issued `skill_manage` call. */
async function callTool(identity, sessionId, name, args = {}) {
  const before = new Set((await readEvents(identity, sessionId)).filter(event => event.type === 'tool/call').map(event => event.data.callId))
  await send(identity, sessionId, `[[tool:${name}:${JSON.stringify(args)}]]`)
  const events = await readEvents(identity, sessionId)
  const call = events.filter(event => event.type === 'tool/call' && event.data.name === name && !before.has(event.data.callId)).at(-1)
  assert.ok(call, `the log must contain the new ${name} call`)
  const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  assert.ok(result, `the log must contain the result for ${call.data.callId}`)
  const text = (result.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    value = undefined
  }
  return { call, result, isError: result.data.message.isError === true, text, value }
}

/** One GitHub-shaped skills repository tarball for the current ref. */
function repositoryArchive(sha) {
  return tarGz([
    { path: `skills-${sha}/README.md`, content: 'repository readme, never part of a skill' },
    ...skillPackageEntries(`skills-${sha}/skills/release-check`, {
      name: 'release-check',
      description: 'Use when running the release checklist.',
      body: '# Release checklist\n\nRead references/checklist.md and run scripts/check.sh.',
      extra: {
        'references/checklist.md': 'CHECKLIST FOR THE RELEASE',
        'scripts/check.sh': '#!/bin/sh\nexit 0\n',
        'LICENSE': 'MIT License\n\nPermission is hereby granted, free of charge.',
      },
    }),
    ...skillPackageEntries(`skills-${sha}/skills/other-check`, {
      name: 'other-check',
      description: 'Use when running the later check.',
      extra: { 'references/notes.md': 'OTHER CHECK NOTES' },
    }),
  ])
}

/** The scenario both installed skills can actually run from the package copy. */
const scenario = { name: 'package is readable', command: 'test -f SKILL.md', uses: ['SKILL.md'] }

/** Boot the real backend against the shared model double. */
async function start() {
  run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-install-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    OURFAIRY_GITHUB_API_BASE: stubBase,
    OURFAIRY_GITHUB_CODELOAD_BASE: stubBase,
    // A small install bound keeps the oversized-download case real without an
    // 11 MiB fixture; the default 10 MiB is exercised by Config validation.
    OURFAIRY_SKILL_INSTALL_MAX_BYTES: '16384',
  })
  port = startedPort(run)
}

/** Stop the backend and assert a clean exit. */
async function stop() {
  const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(stopped.code, 0, describeRun('stop', stopped))
}

before(async () => {
  codeloadArchive = repositoryArchive(SHA_ONE)
  stub = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const url = new URL(incoming.url, 'http://stub.invalid')
    stubRequests.push({ method: incoming.method, path: url.pathname })
    if (url.pathname === '/repos/acme/skills/commits/main') {
      const bytes = Buffer.from(JSON.stringify({ sha: refSha }))
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': bytes.byteLength })
      response.end(bytes)
      return
    }
    if (url.pathname === `/acme/skills/tar.gz/${refSha}` && refSha === SHA_ONE) {
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': codeloadArchive.byteLength })
      response.end(codeloadArchive)
      return
    }
    if (url.pathname === `/acme/skills/tar.gz/${SHA_TWO}`) {
      const archive = repositoryArchive(SHA_TWO)
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archive.byteLength })
      response.end(archive)
      return
    }
    if (url.pathname === '/direct/direct-check.tar.gz') {
      const archive = tarGz([
        ...skillPackageEntries('direct-check', {
          name: 'direct-check',
          description: 'Use when installing a direct archive.',
          extra: { 'LICENSE': 'Apache License 2.0' },
        }),
      ])
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': archive.byteLength,
        etag: '"direct-check-1"',
        'last-modified': 'Wed, 02 Jan 2030 00:00:00 GMT',
      })
      response.end(archive)
      return
    }
    if (url.pathname === '/direct/symlink.tar.gz') {
      const archive = tarGz([
        ...skillPackageEntries('symlink-check', { name: 'symlink-check' }),
        { path: 'symlink-check/references/link.md', type: 'symlink', linkname: '/etc/passwd' },
      ])
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archive.byteLength })
      response.end(archive)
      return
    }
    if (url.pathname === '/direct/traversal.tar.gz') {
      const archive = tarGz([
        ...skillPackageEntries('traversal-check', { name: 'traversal-check' }),
        { path: 'traversal-check/../../escaped.txt', content: 'escaped' },
      ])
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archive.byteLength })
      response.end(archive)
      return
    }
    if (url.pathname === '/direct/huge.tar.gz') {
      const archive = tarGz([
        ...skillPackageEntries('huge-check', { name: 'huge-check' }),
        { path: 'huge-check/references/blob.bin', content: randomBytes(65_536) },
      ])
      response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': archive.byteLength })
      response.end(archive)
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ message: `unexpected path ${url.pathname}` }))
  })
  stub.listen(0, '127.0.0.1')
  await once(stub, 'listening')
  stubBase = `http://127.0.0.1:${stub.address().port}`

  model = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    requests.push(body)
    const flat = (body.messages ?? []).flatMap(message => {
      const content = message.content
      if (typeof content === 'string') return [{ type: 'text', text: content }]
      return Array.isArray(content) ? content : []
    })
    const commandIndex = flat.findLastIndex(block => block.type === 'text' && typeof block.text === 'string'
      && (block.text.startsWith('[[tool:') || block.text.startsWith('[[skill:')))
    const answered = commandIndex >= 0 && flat.slice(commandIndex + 1).some(block => block.type === 'tool_result')
    const text = commandIndex < 0 ? '' : flat[commandIndex].text
    const toolCall = commandIndex >= 0 && !answered ? /^\[\[tool:([a-z_]+):([\s\S]*)\]\]$/u.exec(text) : null
    const skillCall = commandIndex >= 0 && !answered ? /^\[\[skill:([\s\S]+?)\]\]$/u.exec(text) : null
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'skill-install-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (toolCall !== null || skillCall !== null) {
      const callId = `mock-call-${++callNo}`
      const name = skillCall !== null ? 'skill' : toolCall[1]
      const input = skillCall !== null ? { name: skillCall[1] } : JSON.parse(toolCall[2])
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: callId, name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    } else {
      const reply = `REPLY:${requests.length}`
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    }
    emit({ type: 'message_stop' })
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')

  await start()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'skill-installer', password)
  sessionAlice = (await request('/sessions/create', alice.token)).session.id
  await send(alice, sessionAlice, 'PROBE: install a skill from its address')
})

after(async () => {
  try {
    await stop()
  } catch {
    // A failing assertion may have stopped the backend already.
  }
  if (model !== undefined) await new Promise(resolve => model.close(resolve))
  if (stub !== undefined) await new Promise(resolve => stub.close(resolve))
  removeHome(home)
})

describe('address install through the product', () => {
  test('a GitHub tree install records the fixed commit, digest, manifest hash and license', async () => {
    const installed = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, address: 'https://github.com/acme/skills/tree/main/skills/release-check',
      scenarios: [scenario],
    })
    assert.equal(installed.isError, false, `the install must succeed: ${installed.text}`)
    assert.equal(installed.value.status, 0)
    ids.github = {
      versionId: installed.value.versionId,
      skillId: installed.value.skillId,
      directory: packageDirectory(installed.value.versionId),
    }
    const version = versionOf(installed.value.versionId)
    assert.equal(version.source_type, 1, 'an installed version records the install source type')
    const source = JSON.parse(version.source_location)
    assert.equal(source.address, 'https://github.com/acme/skills/tree/main/skills/release-check')
    assert.equal(source.resolvedVersion, SHA_ONE)
    assert.equal(source.digest, createHash('sha256').update(codeloadArchive).digest('hex'))
    assert.ok(source.fetchedAt > 0)
    assert.match(version.license, /MIT License/u)
    assert.match(version.package_path, /^candidates\//u)
    assert.ok(existsSync(join(ids.github.directory, 'references', 'checklist.md')))
    assert.ok(existsSync(join(ids.github.directory, 'LICENSE')), 'the license file stays in the package')

    // The install landed in the isolated candidate area, never a native scan
    // root and never a session-writable directory.
    assert.ok(ids.github.directory.startsWith(join(skillRoot, 'candidates')))
    assert.deepEqual(readdirSync(join(skillRoot, 'tmp')), [], 'the fetch staging area is cleaned up')
    assert.equal(existsSync(join(home, 'dsh-home', 'skills', 'release-check')), false)
    assert.equal(existsSync(join(home, 'dsh-home', 'skills', 'release-check', 'SKILL.md')), false)

    // Install requires review: no pool item, no catalog entry, no activation.
    const pool = (await request('/skills/list', alice.token)).skills
    assert.equal(pool.some(item => item.name === 'release-check'), false, 'a pending install is not a pool item')
    const pending = (await request('/skills/list', alice.token)).pending
    assert.ok(pending.some(item => item.versionId === installed.value.versionId && item.sourceType === 1))
    await send(alice, sessionAlice, 'plain turn while the installed candidate waits')
    assert.ok(!catalogNames(latestCatalog(requests.at(-1)), 'release-check'), 'an unreviewed install is not catalogued')
    await send(alice, sessionAlice, '[[skill:release-check]]')
    const events = await readEvents(alice, sessionAlice)
    const call = events.filter(event => event.type === 'tool/call' && event.data.name === 'skill').at(-1)
    const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
    assert.equal(result.data.message.isError, true, 'the native loader cannot see an unreviewed install')
    assert.deepEqual(stubRequests.filter(request => request.path === '/repos/acme/skills/commits/main').length, 1)
  })

  test('the reviewed install becomes current, and a later branch change cannot rewrite it', async () => {
    const approved = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId: ids.github.versionId, decision: 'approve',
    })
    assert.equal(approved.isError, false, approved.text)
    assert.equal(versionOf(ids.github.versionId).status, 3)
    await send(alice, sessionAlice, 'plain turn after approving the install')
    assert.ok(catalogNames(latestCatalog(requests.at(-1)), 'release-check'))

    // The approved package moved from candidates/<uuid> to versions/<skill>/<uuid>.
    ids.github.approvedDirectory = packageDirectory(ids.github.versionId)
    assert.ok(ids.github.approvedDirectory.startsWith(join(skillRoot, 'versions')))
    const beforeRow = versionOf(ids.github.versionId)
    const beforeBytes = readFileSync(join(ids.github.approvedDirectory, 'SKILL.md'), 'utf8')

    // The branch advances and its content changes. The already-recorded
    // candidate and its approved version keep the bytes they fetched.
    refSha = SHA_TWO
    const second = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, address: 'github:acme/skills/skills/other-check@main',
      scenarios: [scenario],
    })
    assert.equal(second.isError, false, second.text)
    const secondVersion = versionOf(second.value.versionId)
    assert.equal(JSON.parse(secondVersion.source_location).resolvedVersion, SHA_TWO)
    assert.equal(readFileSync(join(ids.github.approvedDirectory, 'SKILL.md'), 'utf8'), beforeBytes,
      'the earlier install keeps its package bytes')
    assert.equal(versionOf(ids.github.versionId).manifest_hash, beforeRow.manifest_hash)
    assert.equal(JSON.parse(versionOf(ids.github.versionId).source_location).resolvedVersion, SHA_ONE)
  })

  test('a direct archive records its digest, ETag, Last-Modified and license', async () => {
    const installed = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, address: `${stubBase}/direct/direct-check.tar.gz`, scenarios: [scenario],
    })
    assert.equal(installed.isError, false, installed.text)
    ids.direct = installed.value.versionId
    const version = versionOf(installed.value.versionId)
    const source = JSON.parse(version.source_location)
    assert.equal(source.address, `${stubBase}/direct/direct-check.tar.gz`)
    assert.match(source.resolvedVersion, /^[0-9a-f]{64}$/u)
    assert.equal(source.digest, source.resolvedVersion)
    assert.equal(source.etag, '"direct-check-1"')
    assert.equal(source.lastModified, 'Wed, 02 Jan 2030 00:00:00 GMT')
    assert.match(version.license, /Apache License 2\.0/u)
  })

  test('unsafe, oversized and unsupported installs are refused without leaving candidates', async () => {
    const cases = [
      [`${stubBase}/direct/symlink.tar.gz`, /symlink/u],
      [`${stubBase}/direct/traversal.tar.gz`, /\.\.|segment/u],
      [`${stubBase}/direct/huge.tar.gz`, /install limit|too-large|exceeds/u],
      ['https://example.invalid/skill.zip', /zip archives are not supported/u],
    ]
    const before = rows('SELECT id FROM skill_version')
    const stubBefore = stubRequests.length
    for (const [address, pattern] of cases) {
      const refused = await callTool(alice, sessionAlice, 'skill_manage', {
        action: 'create', scope: 1, address, scenarios: [scenario],
      })
      assert.equal(refused.isError, true, `install from ${address} must be refused`)
      assert.match(refused.text, pattern, `the refusal must name the reason: ${refused.text}`)
    }
    assert.deepEqual(rows('SELECT id FROM skill_version').map(row => row.id), before.map(row => row.id),
      'a refused install writes no version row')
    assert.equal(readdirSync(join(skillRoot, 'tmp')).length, 0, 'a refused install cleans its staging directory')
    assert.equal(existsSync(join(home, 'escaped.txt')), false, 'no archive path escapes the skill data root')
    assert.equal(existsSync(join(home, 'dsh-home', 'escaped.txt')), false)
    assert.equal(stubRequests.length > stubBefore, true, 'each network case actually reached the stub')
  })

  test('an installed candidate joins the ordinary review display and pending entry', async () => {
    const inspect = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: ids.github.versionId,
    })
    assert.equal(inspect.isError, false, inspect.text)
    assert.equal(inspect.value.review.source.type, 1)
    assert.equal(inspect.value.review.source.address, 'https://github.com/acme/skills/tree/main/skills/release-check')
    assert.equal(inspect.value.review.source.resolvedVersion, SHA_ONE)
    assert.equal(inspect.value.review.license.includes('MIT License'), true)
    const display = inspect.value.display
    assert.ok(display.includes('技能候选 release-check'), display)
    const opened = await request('/skills/review-open', alice.token, { versionId: ids.direct })
    assert.equal(opened.ok, true)
    assert.equal(opened.sessionId, `ourfairy-user-${alice.user.shortId}-primary`)
  })
})
