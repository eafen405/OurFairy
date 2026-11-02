/**
 * Ticket #299: skill evolution (revision candidates), growth confirmation,
 * atomic version switching, history isolation and rollback.
 *
 * Every case drives the shipped launcher, the real API server, the real SQLite
 * store and the real bwrap verification runner. A model double speaks the
 * Messages protocol and turns `[[tool:<name>:<json>]]` into a real tool call, so
 * the test observes `skill_manage` exactly as the model does: one JSON result
 * and, for an inspect, the derived `skill-review` chat row. Fixtures are real
 * packages; no test re-implements the manifest, the hash, a growth percentage
 * or a verification result.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-skill-evolution-')
const password = 'skill-evolution-password'
const skillRoot = join(home, 'dsh-home', 'skill')
const databasePath = join(skillRoot, 'skill.sqlite')
const envRoot = join(home, 'dsh-home', 'env')

let model
let port
let admin
let alice
let bob
let sessionAlice
let sessionAliceSecond
let sessionBob
let run
let requestNo = 0
let callNo = 0
const requests = []
const ids = {}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One product POST, asserting the HTTP status through the shared helper. */
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

/** One identity row by name. */
function identityOf(name) {
  return rows('SELECT * FROM skill WHERE name = ? AND deleted_at IS NULL', name)[0]
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

/** All text blocks of one model request, joined, for catalog/context assertions. */
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

/** Whether the catalog text advertises one skill name. */
function catalogNames(text, name) {
  return text.includes(`- \`${name}\`:`) || text.includes(`- \`${name}\` `)
}

/** One chat turn's final reply; tool-only steps pass through with empty text. */
async function send(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `evolution-request-${++requestNo}`, text })
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

/** Send one user message and answer the durable user row that carries it. */
async function sendUserMessage(identity, sessionId, text) {
  const before = new Set((await allMessages(identity, sessionId)).filter(message => message.role === 1).map(message => message.messageId))
  await send(identity, sessionId, text)
  const message = (await allMessages(identity, sessionId)).find(row => row.role === 1
    && row.text === text && !before.has(row.messageId))
  assert.ok(message, `the durable log must carry the user message ${JSON.stringify(text)}`)
  return message
}

/** The whole committed log of one session, paged from its current cut. */
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

/** Every durable transcript row, assembled from bounded pages. */
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

/** One real model-issued `skill_manage` call, returning its JSON value and durable events. */
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

/** A core body of exactly `length` Unicode characters. */
function bodyOf(length) {
  const prefix = '# Workflow\n\n'
  assert.ok(length >= prefix.length, `the body must fit its own heading; got ${length}`)
  return prefix + 'a'.repeat(length - prefix.length)
}

/** A complete package as the model would submit it. */
function packageFiles(name, { description = 'Use when running the reusable workflow.', body, bodyLength, extra = {} } = {}) {
  const text = body ?? bodyOf(bodyLength)
  return [
    { path: 'SKILL.md', content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${text}\n` },
    ...Object.entries(extra).map(([path, content]) => ({ path, content: typeof content === 'string' ? content : content.content })),
  ]
}

/** The shared verification scenario; reads the package copy it was given. */
const SCENARIO = { name: 'reads the packaged reference', command: 'test -f references/guide.md && grep -q GUIDE references/guide.md', uses: ['references/guide.md'] }

/** Create one new skill and approve it; answer the approved version. */
async function publishNewSkill(name, { bodyLength = 1000, files, scenarios = [{ name: 'ok', command: 'true' }] } = {}) {
  const created = await callTool(alice, sessionAlice, 'skill_manage', {
    action: 'create', scope: 1, focus: { kind: 'turn' },
    files: files ?? packageFiles(name, { bodyLength }), scenarios,
  })
  assert.equal(created.isError, false, `create ${name} must succeed: ${created.text}`)
  const approved = await callTool(alice, sessionAlice, 'skill_manage', {
    action: 'review', versionId: created.value.versionId, decision: 'approve',
  })
  assert.equal(approved.isError, false, `approve ${name} must succeed: ${approved.text}`)
  return { skillId: created.value.skillId, versionId: created.value.versionId }
}

/** Create one revision candidate of an approved skill. */
async function createRevision(name, parentVersionId, { bodyLength = 1090, files, scenarios = [{ name: 'ok', command: 'true' }], benefit = 'fix the failed step', extra = {} } = {}) {
  return callTool(alice, sessionAlice, 'skill_manage', {
    action: 'create', scope: 1, focus: { kind: 'turn' },
    parentVersionId,
    targetBenefit: benefit,
    files: files ?? packageFiles(name, { bodyLength, extra }),
    scenarios,
  })
}

/** Boot the real backend against the shared model double. */
async function start() {
  run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-evolution-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
  })
  port = startedPort(run)
}

/** Stop the backend and assert a clean exit. */
async function stop() {
  const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(stopped.code, 0, describeRun('stop', stopped))
}

before(async () => {
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
    emit({ type: 'message_start', message: { id: 'skill-evolution-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
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
  alice = await registerUser(port, admin.token, 'skill-evolver', password)
  bob = await registerUser(port, admin.token, 'skill-evolution-outsider', password)
  sessionAlice = (await request('/sessions/create', alice.token)).session.id
  sessionAliceSecond = (await request('/sessions/create', alice.token)).session.id
  sessionBob = (await request('/sessions/create', bob.token)).session.id

  // One closed real turn so `focus` has a turn to resolve.
  await send(alice, sessionAlice, 'PROBE: the workflow that will become a skill')
  await send(bob, sessionBob, 'PROBE: an outsider session')
  await send(alice, sessionAliceSecond, 'PROBE: the second session of the same owner')
})

after(async () => {
  try {
    await stop()
  } catch {
    // A failing assertion may have stopped the backend already.
  }
  if (model !== undefined) await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

describe('revision candidates', () => {
  test('a revision needs the current parent and a real benefit; it keeps the identity and records growth', async () => {
    const base = await publishNewSkill('growth-demo', { bodyLength: 1000 })
    ids.growth = base

    // No benefit, then a blank benefit: neither creates a candidate.
    const none = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' }, parentVersionId: base.versionId,
      files: packageFiles('growth-demo', { bodyLength: 1090 }), scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(none.isError, true)
    assert.match(none.text, /skills\/benefit-required/u, none.text)
    const blank = await createRevision('growth-demo', base.versionId, { benefit: '   ' })
    assert.equal(blank.isError, true)
    assert.match(blank.text, /skills\/benefit-required/u, blank.text)
    assert.equal(rows('SELECT * FROM skill_version WHERE skill_id = ?', base.skillId).length, 1,
      'a refused revision leaves no version row')

    // An unknown parent and a non-current parent are refused.
    const unknown = await createRevision('growth-demo', 999_999)
    assert.equal(unknown.isError, true)
    assert.match(unknown.text, /skills\/invalid-parent/u, unknown.text)

    const revision = await createRevision('growth-demo', base.versionId, {
      bodyLength: 1090, benefit: 'recover from the failing second step', extra: { 'references/guide.md': 'GUIDE v2' },
    })
    assert.equal(revision.isError, false, revision.text)
    assert.equal(revision.value.status, 0)
    assert.deepEqual(revision.value.nextActions, ['inspect', 'review'])
    const version = versionOf(revision.value.versionId)
    assert.equal(version.parent_version_id, base.versionId)
    assert.equal(version.source_type, 3, 'a revision is source type evolution')
    assert.equal(version.core_characters, 1090)
    assert.equal(version.growth_exceeded, 0, '109% of the parent needs no growth confirmation')
    assert.equal(version.status, 0)
    assert.equal(identityOf('growth-demo').id, base.skillId, 'a revision joins the one identity')
    assert.equal(identityOf('growth-demo').current_version_id, base.versionId,
      'the old current version stays current while the revision is pending')
    const provenance = JSON.parse(version.source_location)
    assert.equal(provenance.benefit, 'recover from the failing second step')
    assert.equal(provenance.focus.kind, 'turn')

    const changed = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' }, parentVersionId: base.versionId,
      targetBenefit: 'rename into a second identity',
      files: packageFiles('growth-demo-renamed', { bodyLength: 1000 }), scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(changed.isError, true, 'a revision keeps the identity name')
    assert.match(changed.text, /skills\/invalid-parent/u, changed.text)
    assert.equal(identityOf('growth-demo-renamed'), undefined)

    const inspect = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: revision.value.versionId,
    })
    assert.equal(inspect.isError, false, inspect.text)
    const review = inspect.value.review
    assert.equal(review.parentVersionId, base.versionId)
    assert.equal(review.benefit, 'recover from the failing second step')
    assert.equal(review.growth.exceeded, false)
    assert.equal(review.growth.oldCharacters, 1000)
    assert.equal(review.growth.newCharacters, 1090)
    assert.equal(review.growthConfirmation.required, false)
    assert.deepEqual(review.changes.added, ['references/guide.md'])
    assert.deepEqual(review.changes.changed, ['SKILL.md'])
    assert.equal(review.changes.removed.length, 0)
    assert.ok(inspect.value.display.includes('核心正文 1000 → 1090 字符（+9.0%）'), inspect.value.display)
    assert.ok(inspect.value.display.includes('目标收益：recover from the failing second step'), inspect.value.display)
    assert.ok(!inspect.value.display.includes('确认增长'), 'a 109% revision carries no growth instruction')
    ids.growthRevision = { versionId: revision.value.versionId, skillId: base.skillId }
  })
})
