/**
 * Ticket #296: the skill runtime through the real product composition.
 *
 * Every case drives the shipped launcher, the real profile, the native skill
 * registry/filesystem provider/`skill` tool and a model double that speaks the
 * Messages protocol. Fixtures are written through `importReviewedPackage`
 * (the deployment seed's own path) or as seed directories; the test never
 * recomputes a manifest hash.
 *
 * The suite is deliberately sequential: it boots, exercises the first catalog
 * and a native activation, restarts cold with personal/common/shadow/archived
 * fixtures, then checks resource access and integrity. Each step's durable
 * facts are read back from `/chat/read`, `/chat/page` and `skill.sqlite`.
 */
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, readReport, registerUser, removeHome, runBackend, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'
import { importReviewedPackage } from '@ourfairy/dsh-skill-creator/seed'
import { SkillStore } from '../backend/skill-creator/dist/store.js'

const home = makeHome('ourfairy-skill-runtime-')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'ourfairy-skill-fixtures-'))
const seedDir = join(fixtureRoot, 'seeds')
const password = 'skill-runtime-password'
const skillRoot = join(home, 'dsh-home', 'skill')
const databasePath = join(skillRoot, 'skill.sqlite')

let model
let titleRequestCount = 0
let port
let admin
let alice
let bob
let sessionMain
let sessionBob
let sessionPhaethon
let probeReport
const requests = []
let run
let requestNo = 0
let callNo = 0
const ids = {}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One product POST, asserting the HTTP status through the shared helper. */
function request(path, token, body = {}) {
  return httpJson(port, path, { token, body })
}

/** Write one valid package; the frontmatter stays inside the supported subset. */
function writePackage(dir, { name, description, body = '# Workflow\n\nDo the thing.', files = {} }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return dir
}

/** A second connection's view of the skill database. */
function rows(sql, ...parameters) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

/** The absolute directory of one identity's approved current version. */
function versionDirectory(skillId) {
  const [skill] = rows('SELECT current_version_id FROM skill WHERE id = ?', skillId)
  assert.ok(skill?.current_version_id, `skill ${skillId} must have a current version`)
  const [version] = rows('SELECT package_path FROM skill_version WHERE id = ?', skill.current_version_id)
  assert.ok(version?.package_path, `version ${skill.current_version_id} must have a package path`)
  return join(skillRoot, ...version.package_path.split('/'))
}

/** The identity with one name in one scope, or undefined. */
function identityOf(name, scope) {
  return rows('SELECT * FROM skill WHERE name = ? AND scope = ? AND deleted_at IS NULL', name, scope)[0]
}

/** The private root the scoped working directory gives one user. */
function privateRoot(shortId) {
  return join(home, 'dsh-home', 'spaces', 'private', String(shortId))
}

/** All text blocks of one model request, joined, for catalog assertions. */
function requestText(body) {
  return (body?.messages ?? []).flatMap(message => {
    const content = message.content
    if (typeof content === 'string') return [content]
    return Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text) : []
  }).join('\n')
}

/** The newest catalog message in one model request; earlier catalogs stay in history. */
function latestCatalog(body) {
  const catalogs = []
  for (const message of body?.messages ?? []) {
    const content = message.content
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.includes('<available_skills>')) {
        catalogs.push(block.text)
      }
    }
  }
  return catalogs.at(-1) ?? ''
}

/** Whether the catalog text advertises one skill name. */
function catalogNames(text, name) {
  return text.includes(`- \`${name}\`:`) || text.includes(`- \`${name}\` `)
}

/** One turn's final reply; tool-only steps pass through with empty text. */
async function send(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `skill-request-${++requestNo}`, text })
  const until = Date.now() + 20_000
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

/** The newest tool result, paired through its call, with the call's name. */
async function lastToolResult(identity, sessionId) {
  const events = await readEvents(identity, sessionId)
  const call = events.filter(event => event.type === 'tool/call').at(-1)
  assert.ok(call, 'the log must contain a tool call')
  const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  assert.ok(result, `the log must contain the result for ${call.data.callId}`)
  const text = (result.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
  return { name: call.data.name, callId: call.data.callId, text, isError: result.data.message.isError === true }
}

/** Open the skill store while the backend is stopped. */
function openStore() {
  return new SkillStore({ path: databasePath })
}

/** Boot the real backend against the shared model double. */
async function start() {
  run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    // Keep the memory-maintenance child out of this suite's model double: the
    // last-request assertions must read the user session's own request.
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50',
    OURFAIRY_SEED_SKILLS_DIR: seedDir,
  })
  port = startedPort(run)
}

/** Stop the backend and assert a clean exit. */
async function stop() {
  const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(stopped.code, 0, describeRun('stop', stopped))
}

before(async () => {
  // A hostile user-dsh root: if the native filesystem provider kept its default
  // roots, this package would enter every catalog.
  writePackage(join(home, 'dsh-home', 'skills', 'rogue-user'), {
    name: 'rogue-user',
    description: 'A package in the deployment user root that must never be discovered.',
  })
  // The deployment seed: common, reviewed packages imported by the skill row.
  writePackage(join(seedDir, 'activation-demo'), {
    name: 'activation-demo',
    description: 'Use when activating the seeded demo skill.',
    files: { 'references/guide.md': 'seeded reference body' },
  })
  writePackage(join(seedDir, 'tamper-demo'), {
    name: 'tamper-demo',
    description: 'Use when testing package integrity.',
    files: { 'references/notes.md': 'tamper reference body' },
  })
  writePackage(join(seedDir, 'archived-demo'), {
    name: 'archived-demo',
    description: 'Use when testing archive exclusion.',
  })
  writePackage(join(seedDir, 'shadow-demo'), {
    name: 'shadow-demo',
    description: 'common variant',
  })

  model = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) {
      titleRequestCount += 1
      return
    }
    const body = JSON.parse(raw)
    requests.push(body)
    const flat = (body.messages ?? []).flatMap(message => {
      const content = message.content
      if (typeof content === 'string') return [{ type: 'text', text: content }]
      return Array.isArray(content) ? content : []
    })
    const commandIndex = flat.findLastIndex(block => block.type === 'text'
      && typeof block.text === 'string' && /\[\[(?:skill|read|write|bash):[\s\S]+?\]\]/u.test(block.text))
    const answered = commandIndex >= 0 && flat.slice(commandIndex + 1).some(block => block.type === 'tool_result')
    const command = commandIndex < 0 ? undefined : /\[\[(skill|read|write|bash):([\s\S]+?)\]\]/u.exec(flat[commandIndex].text)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'skill-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (command !== undefined && !answered) {
      const [, kind, argument] = command
      const callId = `mock-call-${++callNo}`
      const name = kind === 'skill' ? 'skill' : kind
      const args = kind === 'skill' ? { name: argument }
        : kind === 'read' || kind === 'write' ? { file_path: argument, ...(kind === 'write' ? { content: 'overwritten' } : {}) }
          : { command: argument, description: 'attempt to write the skill package' }
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: callId, name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    } else {
      const text = `REPLY:${requests.length}`
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    }
    emit({ type: 'message_stop' })
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')

  const probePath = join(home, 'probe.json')
  const probe = runBackend(['probe', '--report', probePath], {
    OURFAIRY_HOME: home,
    OURFAIRY_SEED_SKILLS_DIR: seedDir,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  })
  assert.equal(probe.code, 0, describeRun('probe', probe))
  probeReport = readReport(probePath)

  await start()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'skill-alice', password)
  bob = await registerUser(port, admin.token, 'skill-bob', password)
})

after(async () => {
  try {
    await stop()
  } catch {
    // A failing assertion may have left the backend down already; cleanup still
    // has to remove the home and stop the double.
  }
  if (model !== undefined) await new Promise(resolve => model.close(resolve))
  removeHome(home)
  rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('skill runtime through the real composition', () => {
  test('the probe reports the skill rows and a complete bundled-only catalog', () => {
    const rowIds = new Set(probeReport.rows.map(row => row.id))
    for (const id of ['skill', 'skill-filesystem', 'tool-skill', 'skills']) {
      assert.ok(rowIds.has(id), `the probe must report the mounted ${id} row; it reported ${JSON.stringify([...rowIds])}`)
    }
    assert.equal(probeReport.skills?.complete, true, 'the native catalog observation must be complete')
    assert.ok(probeReport.skills.names.includes('skill-creator'), 'the trusted bundled root contributes the Skill Creator')
    assert.deepEqual(probeReport.skills.names.filter(name => name.startsWith('rogue')), [],
      'the deployment user root must not contribute a skill')

    const seeded = rows("SELECT s.name, v.source_type, v.created_by, v.reviewer, v.status FROM skill s JOIN skill_version v ON v.id = s.current_version_id WHERE s.scope = 2 ORDER BY s.name")
    assert.deepEqual(seeded.map(row => row.name), ['activation-demo', 'archived-demo', 'shadow-demo', 'tamper-demo'])
    for (const row of seeded) {
      assert.equal(row.source_type, 5, `${row.name} is a deployment seed`)
      assert.equal(row.created_by, 0)
      assert.equal(row.reviewer, 0)
      assert.equal(row.status, 3)
    }
    assert.deepEqual(rows('SELECT * FROM skill WHERE name = ?', 'skill-creator'), [],
      'the bundled meta skill is a native bundled skill, never a database row')
  })

  test('an empty session has no catalog; the first real turn publishes the bundled catalog without a user bubble', async () => {
    const beforeRequests = requests.length
    sessionMain = (await request('/sessions/create', alice.token)).session.id
    const empty = await request('/chat/read', alice.token, { sessionId: sessionMain })
    assert.deepEqual(empty.projection.messages, [])
    assert.deepEqual(empty.projection.events.filter(event => event.type === 'user/message'), [],
      'an empty session has no catalog or other user message')
    await delay(300)
    assert.equal(requests.length, beforeRequests, 'creating/resuming an empty session must not call the model')

    // Project, deployment-user and session-writable roots all hold valid
    // packages. The provider has defaults off, so none of them may appear.
    const root = privateRoot(alice.user.shortId)
    writePackage(join(root, '.dsh', 'skills', 'rogue-project-dsh'), {
      name: 'rogue-project-dsh', description: 'A project .dsh skill that must stay closed.',
    })
    writePackage(join(root, '.agents', 'skills', 'rogue-project-agents'), {
      name: 'rogue-project-agents', description: 'A project .agents skill that must stay closed.',
    })
    writePackage(join(root, 'rogue-writable'), {
      name: 'rogue-writable', description: 'A session-writable skill that must stay closed.',
    })

    const projection = await send(alice, sessionMain, 'hello there')
    const latest = latestCatalog(requests.at(-1))
    assert.ok(catalogNames(latest, 'skill-creator'), 'the first turn request must carry the bundled skill catalog')
    for (const name of ['rogue-user', 'rogue-project-dsh', 'rogue-project-agents', 'rogue-writable', 'activation-demo']) {
      assert.ok(!catalogNames(latest, name), `${name} must not enter the first catalog`)
    }
    assert.ok(!projection.messages.some(message => message.role === 3), 'a catalog publication is not an activation')
    assert.ok(!projection.messages.some(message => message.text.includes('<available_skills>')),
      'the catalog message must not be projected as a user bubble')
    assert.deepEqual(projection.messages.filter(message => message.role === 1).map(message => message.text), ['hello there'])
    const events = await readEvents(alice, sessionMain)
    assert.ok(events.some(event => event.type === 'user/message' && event.data.source?.kind === 'skill-catalog'),
      'the catalog is a durable native user/message the transcript fold ignores')
    assert.ok(events.some(event => event.type === 'assistant/message'), 'the reply is durable')
  })

  test('a seeded common skill is disabled by default and enabling it changes the next catalog', async () => {
    const pool = (await request('/skills/list', alice.token)).skills
    const activation = pool.find(item => item.name === 'activation-demo')
    assert.ok(activation, 'the seeded common skill is in the pool')
    assert.equal(activation.scope, 2)
    assert.equal(activation.state, 3, 'a common skill with no preference is disabled')
    assert.equal(activation.enabled, false)
    assert.deepEqual(activation.actions, { toggle: 1, archive: 0, restore: 0 },
      'only Phaethon is offered the common lifecycle actions; this caller may only toggle it')
    assert.equal(pool.some(item => item.name === 'skill-creator'), false, 'the bundled native skill is not a product pool item')

    const updated = (await request('/skills/preference', alice.token, { skillId: activation.skillId, enabled: true })).skill
    assert.equal(updated.state, 1)
    assert.equal(updated.enabled, true)
    ids.activation = activation.skillId

    const before = requests.length
    const projection = await send(alice, sessionMain, 'plain turn after enabling')
    assert.equal(requests.length, before + 1, 'a plain turn makes one model request')
    const latest = latestCatalog(requests.at(-1))
    assert.ok(catalogNames(latest, 'activation-demo'), 'enabling a skill enters the next catalog')
    assert.ok(latest.includes('The available skill catalog changed'),
      'the second catalog is a replacement, not a repeated initial catalog')
    assert.equal(projection.messages.filter(message => message.role === 3).length, 0,
      'a catalog update must not produce an activation row')
  })

  test('a successful native skill call adds exactly one activation row; failed and prose paths add none', async () => {
    const projection = await send(alice, sessionMain, '[[skill:activation-demo]]')
    const activationRows = projection.messages.filter(message => message.role === 3)
    assert.equal(activationRows.length, 1, 'one successful skill result makes one activation row')
    const row = activationRows[0]
    assert.equal(row.kind, 1)
    assert.equal(row.status, 2)
    assert.equal(row.requestId, null)
    assert.equal(row.text, '加载了skill:activation-demo')
    assert.match(row.messageId, /^skill-activation:/u)

    const result = await lastToolResult(alice, sessionMain)
    assert.equal(result.name, 'skill')
    assert.equal(result.isError, false)
    assert.equal(row.toolCallId, result.callId)
    assert.equal(row.messageId, `skill-activation:${result.callId}`)
    const events = await readEvents(alice, sessionMain)
    const resultEvent = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === result.callId)
    assert.ok(resultEvent, 'the activation row pairs with a durable tool/result')
    assert.equal(row.seq, resultEvent.seq, 'the row seq is the durable tool/result seq')
    const calls = events.filter(event => event.type === 'tool/call' && event.data.name === 'skill'
      && JSON.parse(event.data.arguments).name === 'activation-demo')
    assert.equal(calls.length, 1, 'the same skill call appears once in the durable log')

    // Unknown name: the native tool refuses and no success row appears.
    await send(alice, sessionMain, '[[skill:definitely-not-a-skill]]')
    assert.equal((await allMessages(alice, sessionMain)).filter(message => message.role === 3).length, 1,
      'a failed activation adds no row')
    assert.equal((await lastToolResult(alice, sessionMain)).isError, true, 'the unknown skill is a failed tool call')

    // Prose `/name` is not an activation path: the product forces userInvocable off.
    await send(alice, sessionMain, 'please use /activation-demo without loading it')
    assert.equal((await allMessages(alice, sessionMain)).filter(message => message.role === 3).length, 1,
      'a /name gesture adds no activation row')
    assert.ok(!requestText(requests.at(-1)).includes('<skill_content name="activation-demo">'),
      'a /name gesture must not inject the body')

    ids.sessionMain = sessionMain
    ids.activationRow = row
  })

  test('a cold restart reproduces the activation row exactly once and keeps the closed roots closed', async () => {
    const before = await request('/chat/read', alice.token, { sessionId: sessionMain })
    await stop()

    // Personal, common-shadow and archived fixtures are written while stopped,
    // through the same reviewed-package import the deployment seed uses.
    const store = openStore()
    try {
      const alicePrivate = writePackage(join(fixtureRoot, 'alice-private'), {
        name: 'alice-private',
        description: 'Alice private workflow.',
        body: '# Private workflow\n\nRead the reference.',
        files: { 'references/secret.md': 'ALICE-PRIVATE-SECRET' },
      })
      const imported = importReviewedPackage({
        root: skillRoot, store, packageDir: alicePrivate, scope: 1, ownerShortId: alice.user.shortId,
        createdBy: alice.user.shortId, sourceType: 0,
        preference: { shortId: alice.user.shortId, enabled: true },
      })
      ids.alicePrivate = imported.skillId
      ids.alicePrivatePath = join(versionDirectory(imported.skillId), 'references', 'secret.md')

      const personalShadow = writePackage(join(fixtureRoot, 'shadow-personal'), {
        name: 'shadow-demo', description: 'personal variant',
      })
      ids.shadowPersonal = importReviewedPackage({
        root: skillRoot, store, packageDir: personalShadow, scope: 1, ownerShortId: alice.user.shortId,
        createdBy: alice.user.shortId, sourceType: 0,
      }).skillId
      const commonShadow = identityOf('shadow-demo', 2)
      store.setPreference({ shortId: alice.user.shortId, skillId: commonShadow.id, enabled: true })
      ids.shadowCommon = commonShadow.id

      const archived = identityOf('archived-demo', 2)
      store.setPreference({ shortId: alice.user.shortId, skillId: archived.id, enabled: true })
      store.archiveIdentity(archived.id, 0)
      ids.archived = archived.id
      ids.archivedDir = versionDirectory(archived.id)

      const tamper = identityOf('tamper-demo', 2)
      store.setPreference({ shortId: alice.user.shortId, skillId: tamper.id, enabled: true })
      ids.tamper = tamper.id
      ids.tamperDir = versionDirectory(tamper.id)
    } finally {
      store.close()
    }

    await start()
    const resumed = await request('/chat/read', alice.token, { sessionId: sessionMain })
    assert.deepEqual(resumed.projection.messages, before.projection.messages,
      'a cold restart rebuilds the same projection, activation row included')
    assert.equal((await allMessages(alice, sessionMain)).filter(message => message.role === 3).length, 1,
      'the activation row is not duplicated by the restart')
    const events = await readEvents(alice, sessionMain)
    assert.equal(events.filter(event => event.type === 'tool/result'
      && event.data.message.toolCallId === ids.activationRow.toolCallId).length, 1,
    'the durable log holds one result for that call')

    // The resumed catalog still excludes every closed root and the archive.
    await send(alice, sessionMain, 'plain turn after restart')
    const latest = latestCatalog(requests.at(-1))
    assert.ok(catalogNames(latest, 'skill-creator'))
    assert.ok(catalogNames(latest, 'alice-private'))
    assert.ok(catalogNames(latest, 'shadow-demo'))
    assert.ok(latest.includes('personal variant'), 'the personal shadow wins the catalog name')
    assert.ok(!latest.includes('common variant'), 'the shadowed common description does not enter the catalog')
    assert.ok(!catalogNames(latest, 'archived-demo'), 'an archived skill stays out of the catalog')
    for (const name of ['rogue-user', 'rogue-project-dsh', 'rogue-project-agents', 'rogue-writable']) {
      assert.ok(!catalogNames(latest, name), `${name} must stay out of the resumed catalog`)
    }
    assert.equal((await allMessages(alice, sessionMain)).filter(message => message.role === 3).length, 1,
      'the catalog turn adds no activation row')
  })

  test('the pool reports shadow, archive and disabled states and disabling the personal winner restores the common one', async () => {
    const pool = (await request('/skills/list', alice.token)).skills
    const personal = pool.find(item => item.name === 'shadow-demo' && item.scope === 1)
    const common = pool.find(item => item.name === 'shadow-demo' && item.scope === 2)
    assert.equal(personal.state, 1, 'the enabled personal winner is in the catalog')
    assert.equal(common.state, 2, 'the same-name common item is shadowed')
    assert.deepEqual(common.shadowedBy, { skillId: personal.skillId, name: 'shadow-demo' })
    const archived = pool.find(item => item.name === 'archived-demo')
    assert.equal(archived.state, 4)
    assert.equal(pool.find(item => item.name === 'activation-demo').state, 1)

    const disabled = (await request('/skills/preference', alice.token, { skillId: personal.skillId, enabled: false })).skill
    assert.equal(disabled.state, 3)
    const after = (await request('/skills/list', alice.token)).skills
    assert.equal(after.find(item => item.name === 'shadow-demo' && item.scope === 2).state, 1,
      'disabling the personal winner lets the common one enter the catalog')
    await send(alice, sessionMain, 'plain turn after disabling the personal shadow')
    const latest = latestCatalog(requests.at(-1))
    assert.ok(latest.includes('common variant'), 'the next catalog carries the common winner')
    assert.ok(!latest.includes('personal variant'), 'the disabled personal description is gone from the catalog')
  })

  test('the activated package resources are readable and cannot be rewritten', async () => {
    const projection = await send(alice, sessionMain, '[[skill:alice-private]]')
    assert.equal(projection.messages.filter(message => message.text === '加载了skill:alice-private').length, 1)
    const secretPath = ids.alicePrivatePath
    const before = readFileSync(secretPath, 'utf8')

    const readProjection = await send(alice, sessionMain, `[[read:${secretPath}]]`)
    const readResult = await lastToolResult(alice, sessionMain)
    assert.equal(readResult.name, 'read')
    assert.equal(readResult.isError, false, `the reference must be readable: ${readResult.text}`)
    assert.ok(readResult.text.includes('ALICE-PRIVATE-SECRET'), 'the read returns the reference content')

    const writeProjection = await send(alice, sessionMain, `[[write:${secretPath}]]`)
    const writeResult = await lastToolResult(alice, sessionMain)
    assert.equal(writeResult.name, 'write')
    assert.equal(writeResult.isError, true, 'a write into the version area must be refused')
    assert.match(writeResult.text, /writable|outside|denied|permission/iu, `the write refusal must name the scope: ${writeResult.text}`)
    assert.equal(readFileSync(secretPath, 'utf8'), before, 'the refused write leaves the file unchanged')

    const appendProjection = await send(alice, sessionMain, `[[bash:printf 'appended\\n' >> '${secretPath}']]`)
    const appendResult = await lastToolResult(alice, sessionMain)
    assert.equal(appendResult.name, 'bash')
    assert.match(appendResult.text, /read-only file system/iu, `the shell mount must be read-only: ${appendResult.text}`)
    assert.equal(readFileSync(secretPath, 'utf8'), before, 'the refused append leaves the file unchanged')

    // The data root itself is never a read root: only exact version directories
    // and the bundled root are contributed.
    await send(alice, sessionMain, `[[read:${join(skillRoot, 'skill.sqlite')}]]`)
    const dataRootRead = await lastToolResult(alice, sessionMain)
    assert.equal(dataRootRead.isError, true, 'the skill data root is not readable')
    assert.match(dataRootRead.text, /outside authorized spaces|permission denied/iu, dataRootRead.text)
    void readProjection
    void writeProjection
    void appendProjection
  })

  test('another user and Phaethon cannot see or read the personal skill', async () => {
    const pool = (await request('/skills/list', bob.token)).skills
    assert.equal(pool.some(item => item.name === 'alice-private'), false, 'another user does not see the personal skill')
    const detail = await httpJson(port, '/skills/detail', { token: bob.token, body: { skillId: ids.alicePrivate }, expect: false })
    assert.equal(detail.status, 404, `another user's detail read is not found: ${detail.text}`)
    assert.equal(detail.json?.error?.code, 'skills/not-found')
    const preference = await httpJson(port, '/skills/preference', {
      token: bob.token, body: { skillId: ids.alicePrivate, enabled: true }, expect: false,
    })
    assert.equal(preference.status, 404, 'another user cannot change the personal preference')

    const phaethonPool = (await request('/skills/list', admin.token)).skills
    assert.equal(phaethonPool.some(item => item.name === 'alice-private'), false,
      'the administrator identity does not widen personal visibility')
    const phaethonDetail = await httpJson(port, '/skills/detail', {
      token: admin.token, body: { skillId: ids.alicePrivate }, expect: false,
    })
    assert.equal(phaethonDetail.status, 404)

    const path = ids.alicePrivatePath
    sessionBob = (await request('/sessions/create', bob.token)).session.id
    await send(bob, sessionBob, `[[read:${path}]]`)
    const bobRead = await lastToolResult(bob, sessionBob)
    assert.equal(bobRead.name, 'read')
    assert.equal(bobRead.isError, true, 'another user cannot read the resource')
    assert.match(bobRead.text, /outside authorized spaces|permission denied|denied/iu, bobRead.text)
    assert.ok(!bobRead.text.includes('ALICE-PRIVATE-SECRET'), 'the refusal leaks no content')
    const bobCatalog = requestText(requests.at(-1))
    assert.ok(!catalogNames(bobCatalog, 'alice-private'), "another user's catalog never carries the personal skill")

    sessionPhaethon = (await request('/sessions/create', admin.token)).session.id
    await send({ token: admin.token }, sessionPhaethon, `[[read:${path}]]`)
    const phaethonRead = await lastToolResult({ token: admin.token }, sessionPhaethon)
    assert.equal(phaethonRead.isError, true, "the administrator cannot read another user's personal resource")
    assert.ok(!phaethonRead.text.includes('ALICE-PRIVATE-SECRET'))
  })

  test('a tampered version fails activation and archived/disabled skills stay out of the catalog', async () => {
    await send(alice, sessionMain, 'plain turn before tampering')
    const catalog = latestCatalog(requests.at(-1))
    assert.ok(catalogNames(catalog, 'tamper-demo'), 'the enabled tamper fixture is catalogued before tampering')
    assert.ok(!catalogNames(catalog, 'archived-demo'), 'the archived fixture is never catalogued')

    // Change a reference file after approval: the manifest hash no longer matches.
    appendFileSync(join(ids.tamperDir, 'references', 'notes.md'), '\ntampered\n')
    const before = (await allMessages(alice, sessionMain)).filter(message => message.role === 3).length
    await send(alice, sessionMain, '[[skill:tamper-demo]]')
    const result = await lastToolResult(alice, sessionMain)
    assert.equal(result.name, 'skill')
    assert.equal(result.isError, true, 'activation of a tampered package fails')
    assert.match(result.text, /integrity check failed/iu, `the failure must name the integrity check: ${result.text}`)
    const afterMessages = await allMessages(alice, sessionMain)
    const after = afterMessages.filter(message => message.role === 3).length
    assert.equal(after, before,
      `a failed activation adds no row; before=${before}, after=${after}, roles=${JSON.stringify(afterMessages.map(message => [message.role, message.text]))}`)

    // An archived version directory is not a catalog winner, so it is not a
    // read root either; the owner cannot read history through the resource path.
    await send(alice, sessionMain, `[[read:${join(ids.archivedDir, 'SKILL.md')}]]`)
    const archivedRead = await lastToolResult(alice, sessionMain)
    assert.equal(archivedRead.isError, true, 'an archived version is not readable')
    assert.match(archivedRead.text, /outside authorized spaces|permission denied/iu, archivedRead.text)

    await send(alice, sessionMain, 'plain turn after tampering')
    const latest = latestCatalog(requests.at(-1))
    assert.ok(!catalogNames(latest, 'archived-demo'), 'archive keeps the skill out of the next catalog')
    assert.ok(!latest.includes('personal variant'), 'the disabled personal winner stays out')
    assert.ok(latest.includes('common variant'), 'the enabled common winner stays in')
  })
})

