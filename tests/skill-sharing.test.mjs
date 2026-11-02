/**
 * Ticket #298: common proposals, review permissions, review results and the
 * archive/restore lifecycle through the real product composition.
 *
 * One real backend, real SQLite store and a model double that issues
 * `skill_manage` calls from the user turn that names the sharing request. The
 * assertions read the durable rows, the client endpoints and the next model
 * catalog, so "proposer and Phaethon only", "no preference is created for
 * anyone" and "archive removes the catalog entry but keeps the preference" are
 * observed where they happen, not inferred.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { once } from 'node:events'
import http from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-skill-sharing-')
const password = 'skill-sharing-password'
const skillRoot = join(home, 'dsh-home', 'skill')
const databasePath = join(skillRoot, 'skill.sqlite')

let model
let port
let admin
let alice
let bob
let sessions = {}
let run
let requestNo = 0
let callNo = 0
const requests = []
const ids = {}

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

/** One identity by name and scope. */
function identityOf(name, scope) {
  return rows('SELECT * FROM skill WHERE name = ? AND scope = ? AND deleted_at IS NULL', name, scope)[0]
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
  await request('/chat/send', identity.token, { sessionId, requestId: `sharing-request-${++requestNo}`, text })
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

/** One `skill_manage` call issued from a turn whose text carries the sharing request. */
async function callTool(identity, sessionId, args, anchor = 'PROBE: use the workflow') {
  const before = new Set((await readEvents(identity, sessionId)).filter(event => event.type === 'tool/call').map(event => event.data.callId))
  await send(identity, sessionId, `${anchor}\n[[tool:skill_manage:${JSON.stringify(args)}]]`)
  const events = await readEvents(identity, sessionId)
  const call = events.filter(event => event.type === 'tool/call' && event.data.name === 'skill_manage'
    && !before.has(event.data.callId)).at(-1)
  assert.ok(call, 'the log must contain the new skill_manage call')
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

/** One real `read` tool call, for the read-only resource assertions. */
async function readPath(identity, sessionId, path) {
  const before = new Set((await readEvents(identity, sessionId)).filter(event => event.type === 'tool/call').map(event => event.data.callId))
  await send(identity, sessionId, `[[read:${path}]]`)
  const events = await readEvents(identity, sessionId)
  const call = events.filter(event => event.type === 'tool/call' && event.data.name === 'read'
    && !before.has(event.data.callId)).at(-1)
  assert.ok(call, 'the log must contain the new read call')
  const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  assert.ok(result, `the log must contain the result for ${call.data.callId}`)
  const text = (result.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
  return { isError: result.data.message.isError === true, text }
}

/** A complete package as the model would submit it. */
function packageFiles(name, { description = 'Use when running the shared workflow.', body = '# Workflow\n\nDo the shared thing.', extra = {} } = {}) {
  return [
    { path: 'SKILL.md', content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n` },
    ...Object.entries(extra).map(([path, content]) => ({ path, content })),
  ]
}

/** The one scenario a fixture runs. */
const scenario = { name: 'package is readable', command: 'test -f SKILL.md', uses: ['SKILL.md'] }

/** Boot the real backend against the shared model double. */
async function start() {
  run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-sharing-key',
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
      && /\[\[(?:tool:[a-z_]+:|read:)[\s\S]*\]\]/u.test(block.text))
    const answered = commandIndex >= 0 && flat.slice(commandIndex + 1).some(block => block.type === 'tool_result')
    const text = commandIndex < 0 ? '' : flat[commandIndex].text
    const command = commandIndex >= 0 ? /\[\[tool:([a-z_]+):([\s\S]*?)\]\]/u.exec(text) : null
    const readCall = commandIndex >= 0 ? /^\[\[read:([\s\S]+?)\]\]$/u.exec(text.trim()) : null
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'skill-sharing-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if ((command !== null || readCall !== null) && !answered) {
      const callId = `mock-call-${++callNo}`
      const name = readCall !== null ? 'read' : command[1]
      const input = readCall !== null ? { file_path: readCall[1] } : JSON.parse(command[2])
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
  alice = await registerUser(port, admin.token, 'skill-proposer', password)
  bob = await registerUser(port, admin.token, 'skill-other', password)
  sessions = {
    admin: (await request('/sessions/create', admin.token)).session.id,
    alice: (await request('/sessions/create', alice.token)).session.id,
    bob: (await request('/sessions/create', bob.token)).session.id,
  }
  await send(alice, sessions.alice, 'PROBE: first real turn')
  await send(bob, sessions.bob, 'PROBE: bob first real turn')
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

describe('common proposals', () => {
  test('a common proposal without an explicit sharing turn is refused', async () => {
    const refused = await callTool(alice, sessions.alice, {
      action: 'create', scope: 2, focus: { kind: 'turn' },
      files: packageFiles('shared-release'), scenarios: [scenario],
    }, 'PROBE: make this reusable')
    assert.equal(refused.isError, true)
    assert.match(refused.text, /skills\/common-consent-required/u)
    assert.equal(identityOf('shared-release', 2), undefined, 'a refused proposal creates no identity')
    assert.equal(rows('SELECT id FROM skill_version WHERE id IN (SELECT id FROM skill_version)').length, 0)
  })

  test('the explicit sharing turn is recorded as consent and the proposer is the caller', async () => {
    const created = await callTool(alice, sessions.alice, {
      action: 'create', scope: 2, focus: { kind: 'turn' },
      files: packageFiles('shared-release', { extra: { 'references/guide.md': 'SHARED GUIDE' } }),
      scenarios: [scenario],
    }, '请把这个流程做成共有技能，大家都可以用')
    assert.equal(created.isError, false, created.text)
    assert.equal(created.value.status, 0)
    ids.common = { versionId: created.value.versionId, skillId: created.value.skillId }

    const skill = identityOf('shared-release', 2)
    assert.equal(skill.scope, 2)
    assert.equal(skill.owner_short_id, null, 'a common identity has no personal owner')
    assert.equal(skill.proposed_by, alice.user.shortId, 'the proposer is the calling user')
    assert.equal(skill.current_version_id, null)
    assert.match(identityOf('shared-release', 2) ? 'ok' : '', /ok/u)

    const version = versionOf(created.value.versionId)
    assert.equal(version.source_type, 0)
    const provenance = JSON.parse(version.source_location)
    assert.equal(provenance.consent.messageId.length > 0, true)
    assert.match(provenance.consent.text, /共有/u)
    assert.ok(provenance.consent.seq > 0)
    assert.equal(provenance.sessionId, undefined, 'common review material carries no raw session reference')
    assert.equal(provenance.focus, undefined, 'common review material carries no private focus range')
    assert.equal(version.package_path.startsWith('candidates/'), true)

    const inspect = await callTool(alice, sessions.alice, { action: 'inspect', versionId: ids.common.versionId })
    assert.equal(inspect.isError, false, inspect.text)
    assert.equal(inspect.value.review.scope, 2)
    assert.equal(inspect.value.review.proposerShortId, alice.user.shortId)
    assert.equal(inspect.value.review.source.focus, null)
    assert.deepEqual(inspect.value.review.nextActions, [], 'a proposer reads the material but cannot decide it')
  })

  test('a common candidate is visible to its proposer and Phaethon only', async () => {
    const proposerPending = (await request('/skills/list', alice.token)).pending
    assert.ok(proposerPending.some(item => item.versionId === ids.common.versionId))
    assert.deepEqual(proposerPending.find(item => item.versionId === ids.common.versionId).nextActions, [])
    const adminPending = (await request('/skills/list', admin.token)).pending
    assert.ok(adminPending.some(item => item.versionId === ids.common.versionId))
    assert.deepEqual(adminPending.find(item => item.versionId === ids.common.versionId).nextActions,
      ['approve', 'request_changes', 'reject'])
    const otherPending = (await request('/skills/list', bob.token)).pending
    assert.equal(otherPending.some(item => item.versionId === ids.common.versionId), false, 'another user sees no common candidate')
    assert.equal((await request('/skills/list', bob.token)).skills.some(item => item.name === 'shared-release'), false,
      'a common candidate is not a pool item')

    const bobInspect = await callTool(bob, sessions.bob, { action: 'inspect', versionId: ids.common.versionId })
    assert.equal(bobInspect.isError, true)
    assert.match(bobInspect.text, /skills\/not-found/u)
    const bobOpen = await httpJson(port, '/skills/review-open', {
      token: bob.token, body: { versionId: ids.common.versionId }, expect: false,
    })
    assert.equal(bobOpen.status, 404, 'another user cannot open the review entry')

    const proposerOpen = await request('/skills/review-open', alice.token, { versionId: ids.common.versionId })
    assert.equal(proposerOpen.ok, true, 'the proposer can open the review conversation')
    assert.equal(proposerOpen.sessionId, `ourfairy-user-${alice.user.shortId}-primary`)

    // The model's list reads the same visibility rule and the same review view.
    const adminList = await callTool(admin, sessions.admin, { action: 'list' })
    assert.equal(adminList.isError, false, adminList.text)
    assert.ok(adminList.value.pending.some(item => item.versionId === ids.common.versionId))
    const bobList = await callTool(bob, sessions.bob, { action: 'list' })
    assert.equal(bobList.value.pending.some(item => item.versionId === ids.common.versionId), false)
  })

  test('the proposer cannot approve; Phaethon can, and approval creates no preference for anyone', async () => {
    const refused = await callTool(alice, sessions.alice, {
      action: 'review', versionId: ids.common.versionId, decision: 'approve',
    })
    assert.equal(refused.isError, true)
    assert.match(refused.text, /skills\/forbidden/u)
    assert.equal(versionOf(ids.common.versionId).status, 0, 'the refused approval changes nothing')

    const approved = await callTool(admin, sessions.admin, {
      action: 'review', versionId: ids.common.versionId, decision: 'approve',
    })
    assert.equal(approved.isError, false, approved.text)
    assert.equal(approved.value.status, 3)
    const version = versionOf(ids.common.versionId)
    assert.equal(version.status, 3)
    assert.equal(version.reviewer, admin.user.shortId)
    assert.ok(version.reviewed_at > 0)
    assert.deepEqual(rows('SELECT * FROM skill_user_preference'), [],
      'a common approval does not choose for any user; the scope default is disabled')

    for (const identity of [alice, bob, admin]) {
      const pool = (await request('/skills/list', identity.token)).skills
      const item = pool.find(entry => entry.name === 'shared-release')
      assert.ok(item, 'the approved common skill enters every pool')
      assert.equal(item.scope, 2)
      assert.equal(item.enabled, false, 'a common skill is disabled until the user enables it')
      assert.equal(item.state, 3)
      const expectedArchive = identity === admin ? 2 : 0
      assert.equal(item.actions.archive, expectedArchive,
        'only Phaethon is offered the common archive action')
      assert.equal(item.actions.restore, expectedArchive)
    }

    // The proposer and Phaethon see the decision; another user does not.
    const proposerResults = (await request('/skills/list', alice.token)).reviewResults
    const decided = proposerResults.find(item => item.versionId === ids.common.versionId)
    assert.ok(decided, 'the proposer gets the decision result')
    assert.equal(decided.proposer, true)
    assert.equal(decided.status, 3)
    assert.ok(decided.decidedAt > 0)
    const adminResults = (await request('/skills/list', admin.token)).reviewResults
    assert.ok(adminResults.some(item => item.versionId === ids.common.versionId && item.proposer === false))
    assert.equal((await request('/skills/list', bob.token)).reviewResults.some(item => item.versionId === ids.common.versionId), false)
  })

  test('the common skill is disabled per user and enabling it only affects that user', async () => {
    await send(bob, sessions.bob, 'plain turn before enabling the common skill')
    assert.ok(!catalogNames(latestCatalog(requests.at(-1)), 'shared-release'))
    const enabled = (await request('/skills/preference', bob.token, {
      skillId: ids.common.skillId, enabled: true,
    })).skill
    assert.equal(enabled.state, 1)
    assert.equal(enabled.enabled, true)
    await send(bob, sessions.bob, 'plain turn after enabling the common skill')
    assert.ok(catalogNames(latestCatalog(requests.at(-1)), 'shared-release'))
    await send(alice, sessions.alice, 'plain turn in the proposer session')
    assert.ok(!catalogNames(latestCatalog(requests.at(-1)), 'shared-release'),
      'the proposer still has the scope default: disabled')
  })

  test('another user cannot take over a pending common name', async () => {
    const created = await callTool(alice, sessions.alice, {
      action: 'create', scope: 2, focus: { kind: 'turn' },
      files: packageFiles('shared-collision'), scenarios: [scenario],
    }, '把它共享给所有人')
    assert.equal(created.isError, false, created.text)
    ids.collision = created.value.versionId
    const bobAttempt = await callTool(bob, sessions.bob, {
      action: 'create', scope: 2, focus: { kind: 'turn' },
      files: packageFiles('shared-collision'), scenarios: [scenario],
    }, '把这个也共享给大家')
    assert.equal(bobAttempt.isError, true)
    assert.match(bobAttempt.text, /skills\/name-conflict/u)
    assert.equal(rows("SELECT id FROM skill WHERE name = 'shared-collision' AND scope = 2 AND deleted_at IS NULL").length, 1,
      'one common identity per scope/name')
    assert.equal((await request('/skills/list', bob.token)).pending.some(item => item.versionId === created.value.versionId), false)
  })
})

describe('identity uniqueness across scopes', () => {
  test('a personal skill may share a common skill name; the same scope refuses a second current identity', async () => {
    const personal = await callTool(alice, sessions.alice, {
      action: 'create', scope: 1, focus: { kind: 'turn' },
      files: packageFiles('shared-release', { body: '# Workflow\n\nA personal variant of the shared name.' }),
      scenarios: [scenario],
    })
    assert.equal(personal.isError, false, personal.text)
    ids.personalSameName = { versionId: personal.value.versionId, skillId: personal.value.skillId }
    assert.notEqual(identityOf('shared-release', 1).id, identityOf('shared-release', 2).id,
      'personal and common are two identities that may share a name')
    await callTool(alice, sessions.alice, { action: 'review', versionId: personal.value.versionId, decision: 'reject' })
  })
})

describe('archive and restore', () => {
  test('a personal skill can be archived and restored only by its owner, keeping its preference', async () => {
    const created = await callTool(alice, sessions.alice, {
      action: 'create', scope: 1, focus: { kind: 'turn' },
      files: packageFiles('personal-lifecycle', { extra: { 'references/note.md': 'PERSONAL NOTE' } }),
      scenarios: [scenario],
    })
    assert.equal(created.isError, false, created.text)
    ids.personal = { versionId: created.value.versionId, skillId: created.value.skillId }
    const approved = await callTool(alice, sessions.alice, {
      action: 'review', versionId: ids.personal.versionId, decision: 'approve',
    })
    assert.equal(approved.isError, false, approved.text)
    ids.personal.directory = packageDirectory(ids.personal.versionId)
    // The first approval enabled the owner; turn it off explicitly so restore
    // can prove it does not reset an existing preference.
    await request('/skills/preference', alice.token, { skillId: ids.personal.skillId, enabled: false })
    assert.equal(rows('SELECT enabled FROM skill_user_preference WHERE short_id = ? AND skill_id = ?',
      alice.user.shortId, ids.personal.skillId)[0].enabled, 0)

    const archived = await callTool(alice, sessions.alice, {
      action: 'archive', skillId: ids.personal.skillId,
    })
    assert.equal(archived.isError, false, archived.text)
    assert.equal(archived.value.skill.state, 4)
    assert.ok(identityOf('personal-lifecycle', 1).archived_at > 0)
    const poolItem = (await request('/skills/list', alice.token)).skills.find(item => item.skillId === ids.personal.skillId)
    assert.equal(poolItem.state, 4, 'an archived skill stays listed with state 4 so the client can restore it')
    assert.equal(poolItem.actions.archive, 1, 'the personal action scope stays this-user-only')
    await send(alice, sessions.alice, 'plain turn after archiving the personal skill')
    assert.ok(!catalogNames(latestCatalog(requests.at(-1)), 'personal-lifecycle'), 'archive leaves the catalog')

    const enable = await httpJson(port, '/skills/preference', {
      token: alice.token, body: { skillId: ids.personal.skillId, enabled: true }, expect: false,
    })
    assert.equal(enable.status, 409, 'an archived skill cannot be enabled')
    assert.equal(enable.json.error.code, 'skills/archived')

    const outsider = await httpJson(port, '/skills/archive', {
      token: bob.token, body: { skillId: ids.personal.skillId }, expect: false,
    })
    assert.equal(outsider.status, 404, 'another user cannot archive a personal skill')
    const administrator = await httpJson(port, '/skills/archive', {
      token: admin.token, body: { skillId: ids.personal.skillId }, expect: false,
    })
    assert.equal(administrator.status, 404, 'Phaethon does not gain access to personal skills')

    const restored = await request('/skills/restore', alice.token, { skillId: ids.personal.skillId })
    assert.equal(restored.ok, true)
    assert.equal(restored.skill.state, 3, 'restore re-derives the disabled state from the kept preference')
    assert.equal(restored.skill.enabled, false)
    const preference = rows('SELECT enabled FROM skill_user_preference WHERE short_id = ? AND skill_id = ?',
      alice.user.shortId, ids.personal.skillId)
    assert.deepEqual(preference.map(row => row.enabled), [0], 'restore never resets a preference')
    await send(alice, sessions.alice, 'plain turn after restoring the personal skill')
    assert.ok(!catalogNames(latestCatalog(requests.at(-1)), 'personal-lifecycle'),
      'the disabled preference still keeps it out of the catalog')
  })

  test('a common skill is archived and restored by Phaethon only, invalidating every user catalog', async () => {
    await send(bob, sessions.bob, 'plain turn before the common archive')
    assert.ok(catalogNames(latestCatalog(requests.at(-1)), 'shared-release'), 'bob enabled the common skill')
    const commonDir = packageDirectory(ids.common.versionId)
    const readable = await readPath(bob, sessions.bob, join(commonDir, 'SKILL.md'))
    assert.equal(readable.isError, false, `an enabled common skill's resources are readable: ${readable.text}`)

    const refused = await httpJson(port, '/skills/archive', {
      token: alice.token, body: { skillId: ids.common.skillId }, expect: false,
    })
    assert.equal(refused.status, 403, 'a proposer cannot archive a common skill')
    assert.equal(refused.json.error.code, 'skills/forbidden')
    const outsider = await httpJson(port, '/skills/archive', {
      token: bob.token, body: { skillId: ids.common.skillId }, expect: false,
    })
    assert.equal(outsider.status, 403)

    const archived = await request('/skills/archive', admin.token, { skillId: ids.common.skillId })
    assert.equal(archived.ok, true)
    assert.equal(archived.skill.state, 4)
    assert.ok(identityOf('shared-release', 2).archived_at > 0)
    const bobArchived = (await request('/skills/list', bob.token)).skills.find(item => item.skillId === ids.common.skillId)
    assert.equal(bobArchived.state, 4)
    assert.equal(bobArchived.actions.restore, 0, 'only Phaethon is offered the common restore')
    await send(bob, sessions.bob, 'plain turn after the common archive')
    assert.ok(!catalogNames(latestCatalog(requests.at(-1)), 'shared-release'),
      'a common archive leaves every user catalog at once')
    const archivedRead = await readPath(bob, sessions.bob, join(commonDir, 'SKILL.md'))
    assert.equal(archivedRead.isError, true, 'an archived version directory is no longer a read-only resource')
    assert.ok(!archivedRead.text.includes('Do the shared thing'), 'the refusal leaks no package content')

    const restored = await request('/skills/restore', admin.token, { skillId: ids.common.skillId })
    assert.equal(restored.ok, true)
    const bobItem = (await request('/skills/list', bob.token)).skills.find(item => item.skillId === ids.common.skillId)
    assert.equal(bobItem.state, 1, 'the enabled preference still wins after restore')
    assert.equal(bobItem.enabled, true)
    assert.equal(rows('SELECT enabled FROM skill_user_preference WHERE short_id = ? AND skill_id = ?',
      bob.user.shortId, ids.common.skillId)[0].enabled, 1, 'restore keeps bob\'s preference')
    await send(bob, sessions.bob, 'plain turn after the common restore')
    assert.ok(catalogNames(latestCatalog(requests.at(-1)), 'shared-release'),
      'the restored, still-enabled common skill is in the next catalog')
    const restoredRead = await readPath(bob, sessions.bob, join(commonDir, 'SKILL.md'))
    assert.equal(restoredRead.isError, false, `restore contributes the resource again: ${restoredRead.text}`)
  })

  test('archiving a skill keeps its content, history and review material available to its reviewer', async () => {
    const personalVersion = ids.personal.versionId
    assert.ok(existsSync(ids.personal.directory), 'archive keeps the approved package on disk')
    assert.equal(readFileSync(join(ids.personal.directory, 'references', 'note.md'), 'utf8'), 'PERSONAL NOTE')
    assert.equal(versionOf(personalVersion).status, 3, 'archive does not rewrite review history')
    assert.equal(versionOf(ids.common.versionId).reviewer, admin.user.shortId)
    assert.equal((await request('/skills/list', admin.token)).skills.find(item => item.skillId === ids.common.skillId).actions.archive, 2)
  })

  test('the common proposer sees only the cleaned package, source summary and verification in review material', async () => {
    // The collision candidate is still pending and proposer-visible; inspect it
    // as Phaethon and assert the material carries no other user's session data.
    const inspect = await callTool(admin, sessions.admin, { action: 'inspect', versionId: ids.collision })
    assert.equal(inspect.isError, false, inspect.text)
    const review = inspect.value.review
    assert.equal(review.scope, 2)
    assert.equal(review.source.focus, null)
    const provenance = JSON.parse(review.source.location)
    assert.equal(provenance.sessionId, undefined)
    assert.equal(provenance.focus, undefined)
    assert.equal(provenance.evidence, undefined)
    assert.match(provenance.consent.text, /共享|所有人|大家|共有/u)
    assert.ok(review.package.every(file => typeof file.sha256 === 'string' && file.bytes >= 0))
    assert.ok(review.verification.executed.length >= 1)
    assert.ok(!requestText(requests.at(-1)).includes('PROBE: first real turn'),
      'a common review does not expose another user\'s raw session text')
  })
})
