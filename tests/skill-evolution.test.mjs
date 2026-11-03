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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { basename, join } from 'node:path'
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

/** A core body of exactly `length` Unicode characters, ending in a marker. */
function bodyOf(length, marker = 'a') {
  const prefix = '# Workflow\n\n'
  assert.ok(length >= prefix.length + marker.length, `the body must fit its own heading and marker; got ${length}`)
  return prefix + 'a'.repeat(length - prefix.length - marker.length) + marker
}

/** A complete package as the model would submit it. */
function packageFiles(name, { description = 'Use when running the reusable workflow.', body, bodyLength, marker, extra = {} } = {}) {
  const text = body ?? bodyOf(bodyLength, marker)
  return [
    { path: 'SKILL.md', content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${text}\n` },
    ...Object.entries(extra).map(([path, content]) => ({ path, content: typeof content === 'string' ? content : content.content })),
  ]
}

/** The shared verification scenario; reads the package copy it was given. */
const SCENARIO = { name: 'reads the packaged reference', command: 'test -f references/guide.md && grep -q GUIDE references/guide.md', uses: ['references/guide.md'] }

/**
 * Approve one pending revision/rollback candidate after a real user decision.
 *
 * A revision or rollback is source_type 3/4, so the approval needs the reviewing
 * user's own message sent after the deterministic inspect display. When a
 * growth confirmation is cited the test already inspected the candidate before
 * the user replied `确认增长`; re-inspecting here would make that confirmation
 * stale, so only the no-confirmation path opens its own display.
 */
async function approve(versionId, growthConfirmMessageId) {
  if (growthConfirmMessageId === undefined) {
    const display = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId })
    assert.equal(display.isError, false, display.text)
  }
  const evidence = await sendUserMessage(alice, sessionAlice, '批准')
  return callTool(alice, sessionAlice, 'skill_manage', {
    action: 'review', versionId, decision: 'approve',
    approvalMessageId: evidence.messageId,
    ...(growthConfirmMessageId === undefined ? {} : { growthConfirmMessageId }),
  })
}

/** One pending row as `skill_manage list` answers it. */
async function pendingOf(name) {
  const list = await callTool(alice, sessionAlice, 'skill_manage', { action: 'list' })
  assert.equal(list.isError, false, list.text)
  return list.value.pending.find(item => item.name === name)
}

/** Activate one skill through the native `skill` tool and answer its result text. */
async function nativeLoad(identity, sessionId, name) {
  const before = new Set((await readEvents(identity, sessionId)).filter(event => event.type === 'tool/call').map(event => event.data.callId))
  await send(identity, sessionId, `[[skill:${name}]]`)
  const events = await readEvents(identity, sessionId)
  const call = events.filter(event => event.type === 'tool/call' && event.data.name === 'skill' && !before.has(event.data.callId)).at(-1)
  assert.ok(call, `the log must contain the new skill call for ${name}`)
  const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  assert.ok(result, `the log must contain the result for ${call.data.callId}`)
  return {
    isError: result.data.message.isError === true,
    text: (result.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join(''),
  }
}

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
async function createRevision(name, parentVersionId, { bodyLength = 1090, marker, files, scenarios = [{ name: 'ok', command: 'true' }], benefit = 'fix the failed step', evidence = [{ kind: 'test', ref: 'the revision scenario' }], extra = {} } = {}) {
  return callTool(alice, sessionAlice, 'skill_manage', {
    action: 'create', scope: 1, focus: { kind: 'turn' },
    parentVersionId,
    targetBenefit: benefit,
    evidence,
    files: files ?? packageFiles(name, { bodyLength, marker, extra }),
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
    // Keep the memory-maintenance child out of this suite's model double: the
    // last-request assertions must read the user session's own request.
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50',
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
  sessionBob = (await request('/sessions/create', bob.token)).session.id

  // One closed real turn so `focus` has a turn to resolve. A second session is
  // requested only after the primary is non-empty, so the product hands out a
  // distinct session instead of the still-empty primary.
  await send(alice, sessionAlice, 'PROBE: the workflow that will become a skill')
  await send(bob, sessionBob, 'PROBE: an outsider session')
  sessionAliceSecond = (await request('/sessions/create', alice.token)).session.id
  assert.notEqual(sessionAliceSecond, sessionAlice, 'the cross-session case needs a distinct session')
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
    const tooLong = await createRevision('growth-demo', base.versionId, { benefit: 'x'.repeat(501) })
    assert.equal(tooLong.isError, true)
    assert.match(tooLong.text, /skills\/benefit-required/u, tooLong.text)
    assert.equal(rows('SELECT * FROM skill_version WHERE skill_id = ?', base.skillId).length, 1,
      'a refused revision leaves no version row')

    // §4: new content must cite evidence or a test. A new skill's focus is its
    // provenance; a revision needs at least one checked evidence entry.
    const noEvidence = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' }, parentVersionId: base.versionId,
      targetBenefit: 'recover from the failing second step',
      files: packageFiles('growth-demo', { bodyLength: 1090 }), scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(noEvidence.isError, true, 'a revision without evidence is refused')
    assert.match(noEvidence.text, /skills\/invalid-evidence/u, noEvidence.text)
    assert.equal(rows('SELECT * FROM skill_version WHERE skill_id = ?', base.skillId).length, 1,
      'the refused revision leaves no version row')

    // An unknown parent and a non-current parent are refused.
    const unknown = await createRevision('growth-demo', 999_999)
    assert.equal(unknown.isError, true)
    assert.match(unknown.text, /skills\/invalid-parent/u, unknown.text)

    const revision = await createRevision('growth-demo', base.versionId, {
      bodyLength: 1090, benefit: 'recover from the failing second step',
      evidence: [{ kind: 'test', ref: 'skills/e2e: growth-demo scenario', note: 'new scenario passes' }],
      extra: { 'references/guide.md': 'GUIDE v2' },
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
    assert.deepEqual(provenance.evidence, [{ kind: 'test', ref: 'skills/e2e: growth-demo scenario', note: 'new scenario passes' }],
      'the revision records the evidence it cited')

    const bobRevision = await callTool(bob, sessionBob, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' }, parentVersionId: base.versionId,
      targetBenefit: 'borrow another user\'s skill',
      files: packageFiles('growth-demo', { bodyLength: 1000 }), scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(bobRevision.isError, true, 'another user cannot revise a personal skill')
    assert.match(bobRevision.text, /skills\/not-found/u, bobRevision.text)

    const changed = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' }, parentVersionId: base.versionId,
      targetBenefit: 'rename into a second identity',
      evidence: [{ kind: 'test', ref: 'the rename attempt' }],
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

  test('a revision reuses unchanged verification and reruns only the affected scenarios', async () => {
    const base = await publishNewSkill('reuse-demo', {
      bodyLength: 1000,
      files: packageFiles('reuse-demo', {
        bodyLength: 1000,
        extra: {
          'references/stable.md': 'STABLE',
          'references/golden.txt': 'one',
          'references/changing.md': 'OLD',
        },
      }),
      scenarios: [
        { name: 'stable check', command: 'grep -q STABLE references/stable.md', uses: ['references/stable.md'] },
        { name: 'golden check', command: 'test -s references/golden.txt', uses: ['references/golden.txt'] },
        { name: 'changing check', command: 'grep -q OLD references/changing.md', uses: ['references/changing.md'] },
        { name: 'no dependencies', command: 'true' },
      ],
    })
    assert.equal(versionOf(base.versionId).core_characters, 1000)
    const parentReport = JSON.parse(versionOf(base.versionId).verification)
    assert.equal(parentReport.executed.length, 4, 'the first version executed every scenario')
    assert.deepEqual(parentReport.reused, [])
    assert.deepEqual(parentReport.executed.find(record => record.name === 'stable check').uses, ['references/stable.md'],
      'the record keeps the dependency the reuse decision reads')

    const revision = await createRevision('reuse-demo', base.versionId, {
      bodyLength: 1090,
      files: packageFiles('reuse-demo', {
        bodyLength: 1090,
        extra: {
          'references/stable.md': 'STABLE',
          'references/golden.txt': 'two',
          'references/changing.md': 'NEW',
        },
      }),
      scenarios: [
        { name: 'stable check', command: 'grep -q STABLE references/stable.md', uses: ['references/stable.md'] },
        { name: 'golden check', command: 'test -s references/golden.txt', uses: ['references/golden.txt'] },
        { name: 'changing check', command: 'grep -q NEW references/changing.md', uses: ['references/changing.md'] },
        { name: 'no dependencies', command: 'true' },
      ],
    })
    assert.equal(revision.isError, false, revision.text)
    const report = JSON.parse(versionOf(revision.value.versionId).verification)
    assert.equal(report.complete, true)
    assert.deepEqual(report.reused.map(record => record.name).sort(), ['no dependencies', 'stable check'],
      'an unchanged scenario and one with no dependencies reuse the parent run')
    assert.deepEqual(report.executed.map(record => record.name).sort(), ['changing check', 'golden check'],
      'a changed command or a changed used file reruns the scenario')
    assert.ok(report.reused.every(record => record.reusedFrom === base.versionId),
      'a reused record names the parent version it came from')
    assert.ok(report.executed.every(record => record.reusedFrom === undefined))
    assert.equal(report.reused.find(record => record.name === 'stable check').exitCode, 0)

    const inspect = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: revision.value.versionId,
    })
    assert.equal(inspect.isError, false, inspect.text)
    assert.deepEqual(inspect.value.review.verification.reused.map(record => record.name).sort(),
      ['no dependencies', 'stable check'])
    assert.deepEqual(inspect.value.review.verification.executed.map(record => record.name).sort(),
      ['changing check', 'golden check'])
    assert.ok(inspect.value.display.includes('验证：实际执行 2，复用 2，未执行 0，失败 0'), inspect.value.display)
    assert.ok(inspect.value.display.includes(`↺ stable check: grep -q STABLE references/stable.md → 复用自版本 ${base.versionId}`),
      inspect.value.display)
    assert.ok(inspect.value.display.includes('✔ changing check: grep -q NEW references/changing.md → exit 0'), inspect.value.display)

    const approved = await approve(revision.value.versionId)
    assert.equal(approved.isError, false, 'verification that is partly reused still authorises approval: ' + approved.text)
    assert.equal(versionOf(base.versionId).status, 4)
    assert.equal(versionOf(revision.value.versionId).status, 3)
  })

  test('a revision runs its optional with/without comparison in the disposable environment', async () => {
    const base = await publishNewSkill('comparison-demo', {
      bodyLength: 1000, marker: 'V1',
      files: packageFiles('comparison-demo', { bodyLength: 1000, marker: 'V1', extra: { 'references/guide.md': 'GUIDE V1' } }),
      scenarios: [SCENARIO],
    })
    const revision = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' },
      parentVersionId: base.versionId,
      targetBenefit: 'prove the guide is the difference',
      evidence: [{ kind: 'test', ref: 'the comparison scenario' }],
      files: packageFiles('comparison-demo', { bodyLength: 1090, marker: 'V2', extra: { 'references/guide.md': 'GUIDE V2' } }),
      scenarios: [SCENARIO],
      comparisons: [{
        name: 'guide presence',
        withSkill: 'test -f references/guide.md && echo WITH-GUIDE',
        withoutSkill: 'echo WITHOUT-GUIDE',
      }],
    })
    assert.equal(revision.isError, false, revision.text)
    const report = JSON.parse(versionOf(revision.value.versionId).verification)
    assert.equal(report.comparisons.length, 1)
    const [comparison] = report.comparisons
    assert.equal(comparison.name, 'guide presence')
    assert.equal(comparison.withSkill.exitCode, 0)
    assert.match(comparison.withSkill.stdoutSummary, /WITH-GUIDE/u)
    assert.equal(comparison.withoutSkill.exitCode, 0)
    assert.match(comparison.withoutSkill.stdoutSummary, /WITHOUT-GUIDE/u)
    assert.ok(comparison.withSkill.environment.cwd.includes(`${join(skillRoot, 'verify')}`),
      'the comparison runs in the disposable verification directory')

    const inspect = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: revision.value.versionId,
    })
    assert.equal(inspect.isError, false, inspect.text)
    assert.equal(inspect.value.review.verification.comparisons.length, 1)
    assert.ok(inspect.value.display.includes('比较 guide presence：有 Skill exit 0，无 Skill exit 0'), inspect.value.display)
    const approved = await approve(revision.value.versionId)
    assert.equal(approved.isError, false, 'a recorded comparison does not block approval: ' + approved.text)
  })
})

test('a model-supplied licence cannot override the package frontmatter licence', async () => {
  const name = 'licence-demo'
  const body = bodyOf(1000)
  const files = [{ path: 'SKILL.md', content: `---\nname: ${name}\ndescription: Use when recording the package licence.\nlicense: MIT\n---\n\n${body}\n` }]
  const created = await callTool(alice, sessionAlice, 'skill_manage', {
    action: 'create', scope: 1, focus: { kind: 'turn' },
    files,
    scenarios: [{ name: 'ok', command: 'true' }],
    license: 'MODEL-CLAIM',
  })
  assert.equal(created.isError, false, created.text)
  const version = versionOf(created.value.versionId)
  assert.equal(version.license, 'MIT', 'the package frontmatter licence is the recorded fact')
  const inspect = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: created.value.versionId })
  assert.equal(inspect.isError, false, inspect.text)
  assert.equal(inspect.value.review.license, 'MIT', 'the review package names the package licence, not the model claim')
})

describe('growth confirmation', () => {
  test('109% and 110% need no confirmation; 111% needs the user\'s own post-display message', async () => {
    const base109 = await publishNewSkill('growth-109', { bodyLength: 1000, marker: 'V1' })
    const revision109 = await createRevision('growth-109', base109.versionId, {
      bodyLength: 1090, marker: 'V2', benefit: 'complete the failure branch',
    })
    assert.equal(revision109.isError, false, revision109.text)
    assert.equal(versionOf(revision109.value.versionId).growth_exceeded, 0, '109% is under the limit')
    const approved109 = await approve(revision109.value.versionId)
    assert.equal(approved109.isError, false, `109% approves without a confirmation: ${approved109.text}`)
    assert.equal(versionOf(revision109.value.versionId).status, 3)

    const base110 = await publishNewSkill('growth-110', { bodyLength: 1000, marker: 'V1' })
    const revision110 = await createRevision('growth-110', base110.versionId, {
      bodyLength: 1100, marker: 'V2', benefit: 'add the verified fallback',
    })
    assert.equal(revision110.isError, false, revision110.text)
    assert.equal(versionOf(revision110.value.versionId).growth_exceeded, 0, 'exactly 110% is not exceeded')
    const approved110 = await approve(revision110.value.versionId)
    assert.equal(approved110.isError, false, `110% approves without a confirmation: ${approved110.text}`)
    assert.equal(versionOf(revision110.value.versionId).status, 3)

    const base111 = await publishNewSkill('growth-111', { bodyLength: 1000, marker: 'OLD' })
    const revision111 = await createRevision('growth-111', base111.versionId, {
      bodyLength: 1110, marker: 'NEW', benefit: 'add two verified steps',
    })
    assert.equal(revision111.isError, false, revision111.text)
    const versionId = revision111.value.versionId
    assert.equal(versionOf(versionId).growth_exceeded, 1, '111% exceeds the limit')

    // The owner disabled the skill earlier; approval must preserve that choice.
    await request('/skills/preference', alice.token, { skillId: base111.skillId, enabled: false })

    const blocked = await approve(versionId)
    assert.equal(blocked.isError, true)
    assert.match(blocked.text, /skills\/growth-confirmation-required/u, blocked.text)
    assert.equal(versionOf(versionId).status, 0, 'the unconfirmed candidate stays pending')

    const inspect = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId })
    assert.equal(inspect.isError, false, inspect.text)
    assert.equal(inspect.value.review.growth.exceeded, true)
    assert.equal(inspect.value.review.growth.oldCharacters, 1000)
    assert.equal(inspect.value.review.growth.newCharacters, 1110)
    assert.equal(inspect.value.review.growthConfirmation.percent, 11)
    assert.equal(inspect.value.review.growthConfirmation.required, true)
    assert.ok(inspect.value.display.includes('核心正文 1000 → 1110 字符（+11.0%）'), inspect.value.display)
    assert.ok(inspect.value.display.includes('篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」'), inspect.value.display)

    // Before the user replies, the model has no confirmation message to cite.
    assert.equal((await pendingOf('growth-111')).growthConfirmMessageId, undefined)

    const confirmation = await sendUserMessage(alice, sessionAlice, '确认增长')
    const pending = await pendingOf('growth-111')
    assert.equal(pending.growthConfirmMessageId, confirmation.messageId,
      'list names the user\'s own confirmation message so the model can cite it')

    const approved = await approve(versionId, confirmation.messageId)
    assert.equal(approved.isError, false, approved.text)
    assert.equal(approved.value.status, 3)
    const stored = versionOf(versionId)
    assert.equal(stored.status, 3)
    assert.equal(stored.growth_confirmed_by, alice.user.shortId)
    assert.ok(stored.growth_confirmed_at > 0)
    assert.equal(stored.growth_confirm_message, confirmation.messageId)
    assert.equal(identityOf('growth-111').current_version_id, versionId)
    assert.equal(versionOf(base111.versionId).status, 4)

    const [preference] = rows('SELECT * FROM skill_user_preference WHERE short_id = ? AND skill_id = ?',
      alice.user.shortId, base111.skillId)
    assert.equal(preference.enabled, 0, 'a version switch preserves the explicit preference')
    const pool = (await request('/skills/list', alice.token)).skills.find(item => item.skillId === base111.skillId)
    assert.equal(pool.enabled, false)
    assert.equal(pool.currentVersionId, versionId)

    // Re-enabling after the switch serves the new current version, not history.
    const reenabled = (await request('/skills/preference', alice.token, { skillId: base111.skillId, enabled: true })).skill
    assert.equal(reenabled.enabled, true)
    const activation = await nativeLoad(alice, sessionAlice, 'growth-111')
    assert.equal(activation.isError, false)
    assert.match(activation.text, /NEW/u, 'the approved revision is the only body the native loader serves')
    assert.ok(!activation.text.endsWith('OLD</skill_instructions>\n</skill_content>'), 'the old body is gone')
  })

  test('a modeled boolean, wrong text, wrong order, another session or another user cannot confirm growth', async () => {
    const base = await publishNewSkill('growth-forge', { bodyLength: 1000, marker: 'V1' })
    const candidate = await createRevision('growth-forge', base.versionId, {
      bodyLength: 1110, marker: 'V2', benefit: 'add the verified recovery branch',
    })
    assert.equal(candidate.isError, false, candidate.text)
    const versionId = candidate.value.versionId
    assert.equal(versionOf(versionId).growth_exceeded, 1)

    // A model-authored boolean is not a user message reference.
    const modeled = await approve(versionId, true)
    assert.equal(modeled.isError, true, 'a boolean instead of a message id is refused')
    assert.equal(versionOf(versionId).status, 0)

    // The display must exist before any confirmation can count.
    const inspect = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId })
    assert.equal(inspect.isError, false, inspect.text)

    const wrongText = await sendUserMessage(alice, sessionAlice, '确认增长吧')
    const wrongTextApproval = await approve(versionId, wrongText.messageId)
    assert.equal(wrongTextApproval.isError, true)
    assert.match(wrongTextApproval.text, /skills\/growth-confirmation-invalid/u, wrongTextApproval.text)
    assert.equal(versionOf(versionId).status, 0)
    assert.equal(versionOf(versionId).growth_confirm_message, null)

    const forged = await approve(versionId, 'not-a-real-message-id')
    assert.equal(forged.isError, true)
    assert.match(forged.text, /skills\/growth-confirmation-invalid/u, forged.text)

    // Same owner, different session: the confirmation must be in this session.
    const otherSession = await sendUserMessage(alice, sessionAliceSecond, '确认增长')
    const crossSession = await approve(versionId, otherSession.messageId)
    assert.equal(crossSession.isError, true)
    assert.match(crossSession.text, /skills\/growth-confirmation-invalid/u, crossSession.text)

    // Another user's exact message id cannot be borrowed either.
    const otherUser = await sendUserMessage(bob, sessionBob, '确认增长')
    const crossUser = await approve(versionId, otherUser.messageId)
    assert.equal(crossUser.isError, true)
    assert.match(crossUser.text, /skills\/growth-confirmation-invalid/u, crossUser.text)

    // The real message in the right session and after the display approves it.
    const confirmation = await sendUserMessage(alice, sessionAlice, '确认增长')
    const accepted = await approve(versionId, confirmation.messageId)
    assert.equal(accepted.isError, false, accepted.text)
    assert.equal(versionOf(versionId).status, 3)

    // Wrong order: a confirmation sent before the inspect display cannot count.
    const base2 = await publishNewSkill('growth-order', { bodyLength: 1000, marker: 'V1' })
    const early = await sendUserMessage(alice, sessionAlice, '确认增长')
    const orderedCandidate = await createRevision('growth-order', base2.versionId, {
      bodyLength: 1110, marker: 'V2', benefit: 'recover the second step',
    })
    assert.equal(orderedCandidate.isError, false, orderedCandidate.text)
    const orderedInspect = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: orderedCandidate.value.versionId,
    })
    assert.equal(orderedInspect.isError, false, orderedInspect.text)
    const prior = await approve(orderedCandidate.value.versionId, early.messageId)
    assert.equal(prior.isError, true, 'a message that predates the latest display is stale')
    assert.match(prior.text, /skills\/growth-confirmation-invalid/u, prior.text)
    const after = await sendUserMessage(alice, sessionAlice, '确认增长')
    const orderedApproval = await approve(orderedCandidate.value.versionId, after.messageId)
    assert.equal(orderedApproval.isError, false, orderedApproval.text)

    // A newer draft with a different hash invalidates the older confirmation:
    // the old id predates the new candidate's display and cannot approve it.
    const base3 = await publishNewSkill('growth-stale', { bodyLength: 1000, marker: 'V1' })
    const firstDraft = await createRevision('growth-stale', base3.versionId, {
      bodyLength: 1110, marker: 'V2', benefit: 'add the recovery branch',
    })
    assert.equal(firstDraft.isError, false, firstDraft.text)
    await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: firstDraft.value.versionId })
    const firstConfirmation = await sendUserMessage(alice, sessionAlice, '确认增长')
    const secondDraft = await createRevision('growth-stale', base3.versionId, {
      bodyLength: 1120, marker: 'V3', benefit: 'add the recovery branch and the retry note',
    })
    assert.equal(secondDraft.isError, false, secondDraft.text)
    assert.notEqual(versionOf(secondDraft.value.versionId).manifest_hash, versionOf(firstDraft.value.versionId).manifest_hash)
    const secondInspect = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: secondDraft.value.versionId,
    })
    assert.equal(secondInspect.isError, false, secondInspect.text)
    const stale = await approve(secondDraft.value.versionId, firstConfirmation.messageId)
    assert.equal(stale.isError, true, 'the confirmation for the older hash cannot approve the newer draft')
    assert.match(stale.text, /skills\/growth-confirmation-invalid/u, stale.text)
    const fresh = await sendUserMessage(alice, sessionAlice, '确认增长')
    const freshApproval = await approve(secondDraft.value.versionId, fresh.messageId)
    assert.equal(freshApproval.isError, false, freshApproval.text)
    assert.equal(versionOf(firstDraft.value.versionId).status, 0, 'the superseded draft stays pending but cannot publish later')
  })
})

describe('atomic version switching and the pool revision state', () => {
  test('the old current version serves during review; the switch serves only the revision and keeps history out of resources', async () => {
    const base = await publishNewSkill('switch-demo', {
      bodyLength: 1000, marker: 'V1',
      files: packageFiles('switch-demo', { bodyLength: 1000, marker: 'V1', extra: { 'references/guide.md': 'GUIDE V1' } }),
      scenarios: [SCENARIO],
    })
    const before = (await request('/skills/list', alice.token)).skills.find(item => item.skillId === base.skillId)
    assert.equal(before.currentVersionId, base.versionId)
    assert.equal(before.pendingRevision, false)

    const revision = await createRevision('switch-demo', base.versionId, {
      bodyLength: 1090, marker: 'V2', benefit: 'recover the failing comparison',
      files: packageFiles('switch-demo', {
        description: 'Use when the revised switch is needed.',
        bodyLength: 1090, marker: 'V2', extra: { 'references/guide.md': 'GUIDE V2' },
      }),
      scenarios: [SCENARIO],
    })
    assert.equal(revision.isError, false, revision.text)

    // During review: the pool names the old current version and the pending
    // revision, and the native loader still serves the old body.
    const during = (await request('/skills/list', alice.token)).skills.find(item => item.skillId === base.skillId)
    assert.equal(during.currentVersionId, base.versionId)
    assert.equal(during.pendingRevision, true, 'the pool names the revision in progress')
    assert.equal(during.state, 1)
    const pendingEntry = (await request('/skills/list', alice.token)).pending.find(item => item.versionId === revision.value.versionId)
    assert.ok(pendingEntry, 'the revision is in the separate pending area')
    const oldActivation = await nativeLoad(alice, sessionAlice, 'switch-demo')
    assert.equal(oldActivation.isError, false)
    assert.match(oldActivation.text, /V1/u, 'the old current version stays usable during review')
    assert.ok(!oldActivation.text.includes('V2'))

    // The approved version directory is a read-only resource; the candidate is not.
    const oldDirectory = packageDirectory(base.versionId)
    const candidateDirectory = packageDirectory(revision.value.versionId)
    const readOld = await callTool(alice, sessionAlice, 'read', { file_path: join(oldDirectory, 'SKILL.md') })
    assert.equal(readOld.isError, false, `the current version is readable: ${readOld.text}`)
    const readCandidate = await callTool(alice, sessionAlice, 'read', { file_path: join(candidateDirectory, 'SKILL.md') })
    assert.equal(readCandidate.isError, true, 'an unapproved candidate is not a read-only resource')

    // A second pending revision of the same parent can coexist; only one can publish.
    const second = await createRevision('switch-demo', base.versionId, {
      bodyLength: 1080, marker: 'V3', benefit: 'a smaller recovery that proves the same fix',
      files: packageFiles('switch-demo', {
        description: 'Use when the revised switch is needed.',
        bodyLength: 1080, marker: 'V3', extra: { 'references/guide.md': 'GUIDE V2' },
      }),
      scenarios: [SCENARIO],
    })
    assert.equal(second.isError, false, second.text)
    // Both decisions have real evidence from their own session; only one can
    // publish because both name the same parent version.
    const secondDisplay = await callTool(alice, sessionAliceSecond, 'skill_manage', {
      action: 'inspect', versionId: second.value.versionId,
    })
    assert.equal(secondDisplay.isError, false, secondDisplay.text)
    const secondEvidence = await sendUserMessage(alice, sessionAliceSecond, '批准')
    const [firstApproval, secondApproval] = await Promise.all([
      approve(revision.value.versionId),
      callTool(alice, sessionAliceSecond, 'skill_manage', {
        action: 'review', versionId: second.value.versionId, decision: 'approve',
        approvalMessageId: secondEvidence.messageId,
      }),
    ])
    const winners = [firstApproval, secondApproval].filter(result => result.isError === false)
    const losers = [firstApproval, secondApproval].filter(result => result.isError === true)
    assert.equal(winners.length, 1, `exactly one revision publishes: ${JSON.stringify([firstApproval.text, secondApproval.text])}`)
    assert.equal(losers.length, 1)
    assert.match(losers[0].text, /skills\/changed/u, 'the loser publishes against a stale parent pointer')
    const currentId = identityOf('switch-demo').current_version_id
    assert.ok(currentId === revision.value.versionId || currentId === second.value.versionId)
    const loserId = currentId === revision.value.versionId ? second.value.versionId : revision.value.versionId
    assert.equal(versionOf(loserId).status, 0, 'the losing revision stays pending for a real rebase')
    assert.equal(versionOf(base.versionId).status, 4)

    // After the switch: only the new current version serves the catalog and
    // the read-only resources; the superseded directory stays on disk for
    // audit and rollback but is not a model-visible resource.
    const after = (await request('/skills/list', alice.token)).skills.find(item => item.skillId === base.skillId)
    assert.equal(after.currentVersionId, currentId)
    assert.equal(after.pendingRevision, true, 'the losing revision still counts as a revision in progress')
    const winningMarker = currentId === revision.value.versionId ? 'V2' : 'V3'
    const winningDirectory = packageDirectory(currentId)
    await send(alice, sessionAlice, 'plain turn after the version switch')
    assert.ok(latestCatalog(requests.at(-1)).includes('Use when the revised switch is needed.'),
      'the approval invalidated this owner\'s catalog without a restart')
    const newActivation = await nativeLoad(alice, sessionAlice, 'switch-demo')
    assert.equal(newActivation.isError, false)
    assert.match(newActivation.text, new RegExp(winningMarker, 'u'))
    assert.ok(!newActivation.text.includes('V1'), 'the old body is not served after the switch')
    const readOldAfter = await callTool(alice, sessionAlice, 'read', { file_path: join(oldDirectory, 'SKILL.md') })
    assert.equal(readOldAfter.isError, true, 'a superseded version is not a read-only resource')
    const readNew = await callTool(alice, sessionAlice, 'read', { file_path: join(winningDirectory, 'SKILL.md') })
    assert.equal(readNew.isError, false, `the new current version is readable: ${readNew.text}`)
    assert.ok(existsSync(join(oldDirectory, 'SKILL.md')), 'history keeps its package directory on disk')

    // The losing revision cannot publish later against the old parent.
    const late = await approve(loserId)
    assert.equal(late.isError, true)
    assert.match(late.text, /skills\/changed/u, late.text)

    // Nor can a create still name the superseded parent.
    const staleCreate = await createRevision('switch-demo', base.versionId, {
      bodyLength: 1070, marker: 'V4', benefit: 'a stale rebase attempt',
      files: packageFiles('switch-demo', {
        bodyLength: 1070, marker: 'V4', extra: { 'references/guide.md': 'GUIDE V4' },
      }),
      scenarios: [SCENARIO],
    })
    assert.equal(staleCreate.isError, true)
    assert.match(staleCreate.text, /skills\/invalid-parent/u, staleCreate.text)
  })

  test('pendingRevision is true for a pending or changes-requested sibling and false once settled', async () => {
    const base = await publishNewSkill('revision-state', { bodyLength: 1000 })
    const read = async () => (await request('/skills/list', alice.token)).skills.find(item => item.skillId === base.skillId)
    assert.equal((await read()).pendingRevision, false)

    const pending = await createRevision('revision-state', base.versionId, { bodyLength: 1090 })
    assert.equal(pending.isError, false, pending.text)
    assert.equal((await read()).pendingRevision, true)

    const changes = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId: pending.value.versionId, decision: 'request_changes', note: 'tighten the failure branch',
    })
    assert.equal(changes.isError, false, changes.text)
    assert.equal((await read()).pendingRevision, true, 'a changes-requested sibling still marks the revision in progress')

    const rejectedCandidate = await createRevision('revision-state', base.versionId, { bodyLength: 1100 })
    assert.equal(rejectedCandidate.isError, false, rejectedCandidate.text)
    const rejected = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId: rejectedCandidate.value.versionId, decision: 'reject',
    })
    assert.equal(rejected.isError, false, rejected.text)
    assert.equal((await read()).pendingRevision, false,
      'a newer settled draft clears the older changes-requested state')
    const approvedCandidate = await createRevision('revision-state', base.versionId, { bodyLength: 1110, benefit: 'complete the recovery' })
    assert.equal(approvedCandidate.isError, false, approvedCandidate.text)
    await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: approvedCandidate.value.versionId })
    const confirmation = await sendUserMessage(alice, sessionAlice, '确认增长')
    const approved = await approve(approvedCandidate.value.versionId, confirmation.messageId)
    assert.equal(approved.isError, false, approved.text)
    assert.equal((await read()).pendingRevision, false, 'an approved current version has no revision in progress')
  })
})

describe('rollback', () => {
  test('a historical approved version becomes a new pending candidate with verification, never a pointer move', async () => {
    const base = await publishNewSkill('rollback-demo', {
      bodyLength: 1000, marker: 'V1',
      files: packageFiles('rollback-demo', {
        bodyLength: 1000, marker: 'V1', extra: { 'references/guide.md': 'GUIDE V1' },
      }),
      scenarios: [SCENARIO, { name: 'no dependencies', command: 'true' }],
    })
    const revision = await createRevision('rollback-demo', base.versionId, {
      bodyLength: 1090, marker: 'V2', benefit: 'recover the failing comparison',
      files: packageFiles('rollback-demo', {
        bodyLength: 1090, marker: 'V2', extra: { 'references/guide.md': 'GUIDE V2' },
      }),
      scenarios: [SCENARIO, { name: 'no dependencies', command: 'true' }],
    })
    assert.equal(revision.isError, false, revision.text)
    const approvedRevision = await approve(revision.value.versionId)
    assert.equal(approvedRevision.isError, false, approvedRevision.text)
    assert.equal(versionOf(base.versionId).status, 4)

    // A pending candidate is not a rollback source, and neither is the current.
    const pendingSibling = await createRevision('rollback-demo', revision.value.versionId, {
      bodyLength: 1080, marker: 'V2b', benefit: 'a smaller follow-up revision',
      files: packageFiles('rollback-demo', {
        bodyLength: 1080, marker: 'V2b', extra: { 'references/guide.md': 'GUIDE V2' },
      }),
      scenarios: [SCENARIO, { name: 'no dependencies', command: 'true' }],
    })
    assert.equal(pendingSibling.isError, false, pendingSibling.text)
    const fromPending = await callTool(alice, sessionAlice, 'skill_manage', { action: 'rollback', versionId: pendingSibling.value.versionId })
    assert.equal(fromPending.isError, true)
    assert.match(fromPending.text, /skills\/invalid-rollback/u, fromPending.text)
    const fromCurrent = await callTool(alice, sessionAlice, 'skill_manage', { action: 'rollback', versionId: revision.value.versionId })
    assert.equal(fromCurrent.isError, true)
    assert.match(fromCurrent.text, /skills\/invalid-rollback/u, fromCurrent.text)
    const unknown = await callTool(alice, sessionAlice, 'skill_manage', { action: 'rollback', versionId: 999_999 })
    assert.equal(unknown.isError, true)
    assert.match(unknown.text, /skills\/not-found/u, unknown.text)

    const rollback = await callTool(alice, sessionAlice, 'skill_manage', { action: 'rollback', versionId: base.versionId })
    assert.equal(rollback.isError, false, rollback.text)
    assert.equal(rollback.value.status, 0)
    assert.deepEqual(rollback.value.nextActions, ['inspect', 'review'])
    const rolled = versionOf(rollback.value.versionId)
    assert.equal(rolled.parent_version_id, revision.value.versionId, 'the rollback candidate revises the current version')
    assert.equal(rolled.source_type, 4, 'a rollback is source type rollback')
    assert.equal(rolled.manifest_hash, versionOf(base.versionId).manifest_hash, 'the clean historical bytes are copied')
    assert.equal(rolled.core_characters, 1000)
    assert.match(rolled.package_path, /^candidates\//u)
    assert.equal(identityOf('rollback-demo').current_version_id, revision.value.versionId,
      'rollback never moves the pointer without review')
    const report = JSON.parse(rolled.verification)
    assert.equal(report.complete, true)
    assert.ok(report.reused.length >= 1, 'an unchanged scenario reuses the current version run')
    assert.ok(report.executed.length >= 1, 'a scenario depending on the changed guide reruns')
    assert.deepEqual(report.reused.map(record => record.name), ['no dependencies'])
    assert.deepEqual(report.executed.map(record => record.name), [SCENARIO.name])
    const provenance = JSON.parse(rolled.source_location)
    assert.equal(provenance.rollbackOf, base.versionId)
    assert.match(provenance.benefit, /回滚/u)

    const history = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: base.versionId })
    assert.equal(history.isError, false, history.text)
    assert.deepEqual(history.value.review.nextActions, ['rollback'],
      'a historical approved version names rollback as its next action')

    const inspect = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: rollback.value.versionId })
    assert.equal(inspect.isError, false, inspect.text)
    assert.equal(inspect.value.review.source.type, 4)
    assert.equal(inspect.value.review.parentVersionId, revision.value.versionId)
    assert.equal(inspect.value.review.growth.exceeded, false)
    assert.match(inspect.value.review.benefit, /回滚/u)

    // Another user cannot inspect or review the rollback candidate.
    const bobRollback = await callTool(bob, sessionBob, 'skill_manage', { action: 'rollback', versionId: base.versionId })
    assert.equal(bobRollback.isError, true)
    assert.match(bobRollback.text, /skills\/not-found/u, bobRollback.text)

    // The normal review publishes it and the historical body serves again.
    const published = await approve(rollback.value.versionId)
    assert.equal(published.isError, false, published.text)
    assert.equal(identityOf('rollback-demo').current_version_id, rollback.value.versionId)
    assert.equal(versionOf(revision.value.versionId).status, 4)
    assert.equal(versionOf(base.versionId).status, 4, 'the historical row stays superseded history')
    const activation = await nativeLoad(alice, sessionAlice, 'rollback-demo')
    assert.equal(activation.isError, false)
    assert.match(activation.text, /V1/u, 'the rolled-back content is the current version')
    assert.ok(!activation.text.includes('V2'))

    // Restoring the content that is already current is refused as a no-op.
    const repeat = await callTool(alice, sessionAlice, 'skill_manage', { action: 'rollback', versionId: base.versionId })
    assert.equal(repeat.isError, true)
    assert.match(repeat.text, /skills\/invalid-rollback/u, repeat.text)
    assert.match(repeat.text, /current/u, repeat.text)
  })

  test('the bundled Skill Creator carries the revision, growth and rollback contract', async () => {
    const loaded = await nativeLoad(alice, sessionAlice, 'skill-creator')
    assert.equal(loaded.isError, false)
    assert.match(loaded.text, /## Revisions, rollback and growth/u)
    assert.match(loaded.text, /parentVersionId/u)
    assert.match(loaded.text, /targetBenefit/u)
    assert.match(loaded.text, /complete rewrite/u)
    assert.match(loaded.text, /110%/u)
    assert.match(loaded.text, /确认增长/u)
    assert.match(loaded.text, /skill_manage rollback/u)
  })
})

describe('source-graded approval evidence', () => {
  test('a revision cannot be approved without the user\'s own post-display message', async () => {
    const base = await publishNewSkill('approval-grade', { bodyLength: 1000 })
    const revision = await createRevision('approval-grade', base.versionId, {
      bodyLength: 1090, benefit: 'recover the failing branch',
    })
    assert.equal(revision.isError, false, revision.text)
    const versionId = revision.value.versionId

    // A display exists, but the model still cannot approve on its own.
    const inspect = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId })
    assert.equal(inspect.isError, false, inspect.text)
    assert.equal(inspect.value.review.approval.required, true, 'a revision needs user approval evidence')
    const bare = await callTool(alice, sessionAlice, 'skill_manage', { action: 'review', versionId, decision: 'approve' })
    assert.equal(bare.isError, true, 'a bare approval is refused')
    assert.match(bare.text, /skills\/approval-confirmation-required/u, bare.text)
    assert.equal(versionOf(versionId).status, 0, 'the refused approval leaves the candidate pending')

    // A message sent before the latest display cannot be the evidence.
    const early = await sendUserMessage(alice, sessionAlice, 'early decision')
    await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId })
    const stale = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId, decision: 'approve', approvalMessageId: early.messageId,
    })
    assert.equal(stale.isError, true, 'a message from before the latest display is stale')
    assert.match(stale.text, /skills\/approval-confirmation-invalid/u, stale.text)

    // A forged id is refused.
    const forged = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId, decision: 'approve', approvalMessageId: 'not-a-real-message-id',
    })
    assert.equal(forged.isError, true)
    assert.match(forged.text, /skills\/approval-confirmation-invalid/u, forged.text)

    // Another user's real message id cannot be borrowed.
    const otherUser = await sendUserMessage(bob, sessionBob, 'approve it')
    const borrowed = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId, decision: 'approve', approvalMessageId: otherUser.messageId,
    })
    assert.equal(borrowed.isError, true)
    assert.match(borrowed.text, /skills\/approval-confirmation-invalid/u, borrowed.text)

    // The user's own post-display message approves and is recorded on the row.
    const decision = await sendUserMessage(alice, sessionAlice, '批准')
    const approved = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId, decision: 'approve', approvalMessageId: decision.messageId,
    })
    assert.equal(approved.isError, false, approved.text)
    assert.equal(versionOf(versionId).status, 3)
    assert.equal(versionOf(versionId).approval_message_id, decision.messageId,
      'the approval names the user message it was justified with')
  })
})

describe('changed-content verification', () => {
  test('a changed revision runs a scenario again even when every scenario would be reusable', async () => {
    const scenarios = [{ name: 'no dependencies', command: 'true' }]
    const base = await publishNewSkill('reuse-force', {
      bodyLength: 1000,
      files: packageFiles('reuse-force', { bodyLength: 1000 }),
      scenarios,
    })
    assert.equal(JSON.parse(versionOf(base.versionId).verification).executed.length, 1)

    const revision = await createRevision('reuse-force', base.versionId, {
      bodyLength: 1090,
      files: packageFiles('reuse-force', { bodyLength: 1090 }),
      scenarios,
    })
    assert.equal(revision.isError, false, revision.text)
    const report = JSON.parse(versionOf(revision.value.versionId).verification)
    assert.deepEqual(report.executed.map(record => record.name), ['no dependencies'],
      'the changed body forces a real execution of the declared scenario')
    assert.deepEqual(report.reused, [], 'no parent run is reused for changed content')

    const inspect = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: revision.value.versionId })
    assert.equal(inspect.isError, false, inspect.text)
    assert.ok(inspect.value.display.includes('验证：实际执行 1，复用 0'), inspect.value.display)
  })

  test('the review gate refuses a pre-fix reuse-only report for changed content', async () => {
    const base = await publishNewSkill('reuse-gate', { bodyLength: 1000 })
    const revision = await createRevision('reuse-gate', base.versionId, { bodyLength: 1090, benefit: 'recover the branch' })
    assert.equal(revision.isError, false, revision.text)

    // Reconstruct the pre-fix shape: only the parent's records, no execution.
    const parentReport = JSON.parse(versionOf(base.versionId).verification)
    const reuseOnly = {
      complete: true,
      executed: [],
      reused: parentReport.executed.map(record => ({ ...record, reusedFrom: base.versionId })),
      unexecuted: [],
      failed: [],
      comparisons: [],
      environment: parentReport.environment,
      ranAt: Date.now(),
    }
    const database = new DatabaseSync(databasePath)
    try {
      database.prepare('UPDATE skill_version SET verification = ? WHERE id = ?').run(JSON.stringify(reuseOnly), revision.value.versionId)
    } finally {
      database.close()
    }
    const refused = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'review', versionId: revision.value.versionId, decision: 'approve',
    })
    assert.equal(refused.isError, true, 'new content cannot be approved on reused parent evidence')
    assert.match(refused.text, /skills\/verification-incomplete/u, refused.text)
    assert.equal(versionOf(revision.value.versionId).status, 0)
  })
})

describe('growth confirmation is consumed once', () => {
  test('one 确认增长 message cannot settle two growth candidates', async () => {
    const baseA = await publishNewSkill('growth-once-a', { bodyLength: 1000, marker: 'A1' })
    const first = await createRevision('growth-once-a', baseA.versionId, {
      bodyLength: 1110, marker: 'A2', benefit: 'add the recovery branch',
    })
    const baseB = await publishNewSkill('growth-once-b', { bodyLength: 1000, marker: 'B1' })
    const second = await createRevision('growth-once-b', baseB.versionId, {
      bodyLength: 1110, marker: 'B2', benefit: 'add the recovery branch',
    })
    assert.equal(first.isError, false, first.text)
    assert.equal(second.isError, false, second.text)
    assert.equal(versionOf(first.value.versionId).growth_exceeded, 1)
    assert.equal(versionOf(second.value.versionId).growth_exceeded, 1)

    // Both candidates were displayed, then the user confirms once.
    await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: first.value.versionId })
    await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: second.value.versionId })
    const confirmation = await sendUserMessage(alice, sessionAlice, '确认增长')

    const approvedFirst = await approve(first.value.versionId, confirmation.messageId)
    assert.equal(approvedFirst.isError, false, approvedFirst.text)
    assert.equal(versionOf(first.value.versionId).growth_confirm_message, confirmation.messageId)

    const reused = await approve(second.value.versionId, confirmation.messageId)
    assert.equal(reused.isError, true, 'one confirmation message approves one growth candidate only')
    assert.match(reused.text, /skills\/growth-confirmation-used/u, reused.text)
    assert.equal(versionOf(second.value.versionId).status, 0, 'the second candidate stays pending')
    assert.equal(versionOf(second.value.versionId).growth_confirm_message, null)
  })
})

describe('publish crash reconciliation', () => {
  test('a displaced pending candidate is moved back and a content-less one is settled at boot', async () => {
    // A: a kill between the approval rename and the transaction leaves the
    // pending row pointing at candidates/ while the bytes sit in versions/.
    const displaced = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' },
      files: packageFiles('crash-recover', { bodyLength: 1000 }),
      scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(displaced.isError, false, displaced.text)
    const displacedDir = packageDirectory(displaced.value.versionId)
    const versionsRoot = join(skillRoot, 'versions', String(displaced.value.skillId))
    mkdirSync(versionsRoot, { recursive: true })
    renameSync(displacedDir, join(versionsRoot, basename(displacedDir)))
    assert.ok(!existsSync(displacedDir))

    // B: the bytes are gone entirely, so the row can never be reviewed.
    const lost = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' },
      files: packageFiles('crash-lost', { bodyLength: 1000 }),
      scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(lost.isError, false, lost.text)
    rmSync(packageDirectory(lost.value.versionId), { recursive: true, force: true })

    // Stale staging from an interrupted write must not survive the reboot.
    const staleStaging = join(skillRoot, 'tmp', 'crashed-staging')
    mkdirSync(staleStaging, { recursive: true })

    await stop()
    await start()

    const recovered = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'inspect', versionId: displaced.value.versionId,
    })
    assert.equal(recovered.isError, false, `the displaced candidate is inspectable again: ${recovered.text}`)
    assert.equal(versionOf(displaced.value.versionId).package_path, `candidates/${basename(displacedDir)}`,
      'the row keeps its candidate path')
    assert.ok(existsSync(packageDirectory(displaced.value.versionId)), 'the boot reconciliation moved it back')
    assert.ok(!existsSync(staleStaging), 'the interrupted staging directory is removed')

    const broken = versionOf(lost.value.versionId)
    assert.equal(broken.status, 2, 'a pending candidate whose bytes are gone is settled as rejected')
    assert.match(broken.review_note, /启动对账/u)
    const gone = await callTool(alice, sessionAlice, 'skill_manage', { action: 'inspect', versionId: lost.value.versionId })
    assert.equal(gone.isError, true, 'a settled broken candidate cannot be inspected')
  })
})
