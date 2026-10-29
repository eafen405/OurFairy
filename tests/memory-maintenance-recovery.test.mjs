/**
 * Restart recomputation, decay and configured thresholds for memory
 * maintenance (ticket #246).
 *
 * The backend boots the real profile with the memory row's config seeded from
 * the same environment the bundle exposes. The tests stop and start the real
 * backend around persisted `memory.sqlite` state, so the recovery being proved
 * is the product's recomputation, not an in-process timer.
 *
 * @covers backend/memory
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { MAINTENANCE_DECAY_HOURS, MAINTENANCE_TURNS } from '@ourfairy/dsh-memory/maintenance-policy'
import {
  describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'
import { MemoryStore } from '../backend/memory/dist/store.js'
import { readMaintenanceSettings } from '../backend/memory/dist/maintenance.js'

const home = makeHome('ourfairy-memory-recovery-')
const password = 'maintenance-recovery-password'
const databasePath = join(home, 'dsh-home', 'memory', 'memory.sqlite')
const MEMORY_TOOLS = ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch']
const env = { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
  MINIMAX_CN_API_KEY: 'mock-recovery-key', OURFAIRY_MEMORY_MAINTENANCE_TURNS: '5',
  OURFAIRY_MEMORY_MAINTENANCE_DECAY_HOURS: '3' }
let port, model, modelPort, admin, requestNo = 0
let childRequests = 0

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

async function newSession(identity) {
  return (await request('/sessions/create', identity.token)).session.id
}

async function sendTurn(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `recovery-turn-${++requestNo}`, text })
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seen.has(message.messageId) && message.text.startsWith('REPLY:'))
    if (reply) return reply
    if (projection.error) assert.fail(`chat failed before the reply: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the reply never returned to session ${sessionId}`)
}

/** The last closed-turn seq in one source session, read through the product route. */
async function latestEndSeq(identity, sessionId) {
  const projection = (await request('/chat/read', identity.token, { sessionId, maxEvents: 256 })).projection
  return projection.events.filter(event => event.type === 'turn/end').at(-1).seq
}

async function waitFor(label, predicate, timeout = 20000) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    last = await predicate()
    if (last) return last
    await delay(25)
  }
  assert.fail(`timed out waiting for ${label}; last value ${JSON.stringify(last)}`)
}

function maintenanceRow(sourceSession) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare('SELECT * FROM maintenance_state WHERE source_session = ?').get(sourceSession)
  } finally {
    database.close()
  }
}

function setLastClosedAt(sourceSession, time) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA busy_timeout = 2000')
    database.prepare('UPDATE maintenance_state SET last_closed_at = ? WHERE source_session = ?').run(time, sourceSession)
  } finally {
    database.close()
  }
}

async function startBackend() {
  const run = await runBackendAsync(startArgs(), { ...env,
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
}

async function stopBackend() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

before(async () => {
  model = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(Buffer.concat(chunks).toString('utf8'), response)) return
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool.name) : []
    const isChild = tools.length === MEMORY_TOOLS.length && MEMORY_TOOLS.every(name => tools.includes(name))
    if (isChild) {
      childRequests += 1
      respond(response, 'MAINTENANCE-DONE')
      return
    }
    const blocks = body.messages.flatMap(message => Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content }])
    const turnText = blocks.filter(block => block.type === 'text' && typeof block.text === 'string'
      && block.text.includes('TURN:')).at(-1)?.text ?? 'no turn'
    respond(response, `REPLY:${turnText.slice(0, 120)}`)
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  modelPort = model.address().port
})

after(async () => {
  await stopBackend().catch(() => undefined)
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

function respond(response, text) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: 'recovery-message', type: 'message', role: 'assistant',
    model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}

test('configured 5-turn / 3-hour values and restart recomputation drive the next interval', async () => {
  await startBackend()
  const alice = await registerUser(port, admin.token, 'recovery-decay', password)
  const session = await newSession(alice)
  for (let index = 0; index < 4; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:重启衰减第${index}轮`)
  }
  const latestEnd = await latestEndSeq(alice, session)
  const observed = await waitFor('the observed interval', () => {
    const row = maintenanceRow(session)
    return row?.cut_seq === latestEnd ? row : undefined
  })
  assert.equal(observed.child_session, null, 'four turns stay below the configured threshold of five')
  const cut = observed.cut_seq
  await stopBackend()

  // Seven hours? No: one complete configured interval is three hours, so four
  // hours of rest lower the threshold from five to four.
  setLastClosedAt(session, Date.now() - 4 * 60 * 60 * 1000)
  await startBackend()
  const completed = await waitFor('the restarted decayed completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.equal(completed.cut_seq, cut, 'the persisted interval is the one maintained')
  assert.equal(completed.watermark_seq, cut, 'the completion advances over the persisted cut')
  assert.equal(childRequests, 1, 'the configured threshold and decay start one child')
  await stopBackend()

  // One turn with a very old newest-closed time clamps the threshold to one.
  await startBackend()
  const bob = await registerUser(port, admin.token, 'recovery-floor', password)
  const floorSession = await newSession(bob)
  await sendTurn(bob, floorSession, 'TURN:0:最低门槛')
  const floorEnd = await latestEndSeq(bob, floorSession)
  const floorObserved = await waitFor('the floor interval', () => {
    const row = maintenanceRow(floorSession)
    return row?.cut_seq === floorEnd ? row : undefined
  })
  await stopBackend()
  setLastClosedAt(floorSession, Date.now() - 100 * 60 * 60 * 1000)
  await startBackend()
  const floorCompleted = await waitFor('the restarted floor completion', () => {
    const row = maintenanceRow(floorSession)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.equal(floorCompleted.watermark_seq, floorObserved.cut_seq, 'the floor of one admits a single closed turn')
  assert.equal(childRequests, 2, 'exactly one more child ran for the second source')
  await stopBackend()
})

test('the maintenance settings reader reads volatile fields at call time and applies the policy bounds', () => {
  let turns = MAINTENANCE_TURNS.min
  const read = (turnValue, decayValue = MAINTENANCE_DECAY_HOURS.default) => readMaintenanceSettings({
    maintenanceTurns: { get: () => turnValue },
    maintenanceDecayHours: { get: () => decayValue },
    maintenanceModel: { get: () => 'MiniMax-M3.1-Flash' },
    maintenanceProvider: { get: () => 'minimax-cn' },
  })
  const settings = () => read(turns)
  assert.equal(settings().turns, MAINTENANCE_TURNS.min)
  turns = MAINTENANCE_TURNS.default
  assert.equal(settings().turns, MAINTENANCE_TURNS.default, 'a later write changes the next read')
  // The accepted range is the policy's: both bounds are taken as written, and
  // one step outside each is refused here rather than only by the row's Config.
  for (const value of [MAINTENANCE_TURNS.min, MAINTENANCE_TURNS.max]) {
    assert.equal(read(value).turns, value, 'both policy turn bounds are accepted at read time')
  }
  for (const value of [MAINTENANCE_DECAY_HOURS.min, MAINTENANCE_DECAY_HOURS.max]) {
    assert.equal(read(MAINTENANCE_TURNS.default, value).decayHours, value,
      'both policy decay bounds are accepted at read time')
  }
  assert.throws(() => read(MAINTENANCE_TURNS.min - 1), /maintenanceTurns/,
    'one turn below the policy minimum is refused at read time')
  assert.throws(() => read(MAINTENANCE_TURNS.max + 1), /maintenanceTurns/,
    'one turn above the policy maximum is refused at read time')
  assert.throws(() => read(MAINTENANCE_TURNS.default, MAINTENANCE_DECAY_HOURS.min - 1), /maintenanceDecayHours/,
    'one hour below the policy minimum is refused at read time')
  assert.throws(() => read(MAINTENANCE_TURNS.default, MAINTENANCE_DECAY_HOURS.max + 1), /maintenanceDecayHours/,
    'one hour above the policy maximum is refused at read time')
})

test('a version 1 memory database gains the frozen-cut column without losing state', () => {
  const legacyHome = makeHome('ourfairy-memory-migrate-')
  const path = join(legacyHome, 'memory.sqlite')
  try {
    const database = new DatabaseSync(path)
    database.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta (key, value) VALUES ('schema_version', '1');
      CREATE TABLE maintenance_state (
        source_session TEXT PRIMARY KEY,
        watermark_seq INTEGER NOT NULL DEFAULT -1,
        last_closed_at INTEGER,
        child_session TEXT,
        status INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO maintenance_state (source_session, watermark_seq, last_closed_at, child_session, status, updated_at)
        VALUES ('legacy-source', 7, 1000, NULL, 0, 1000);
    `)
    database.close()
    const store = new MemoryStore({ path })
    try {
      const row = store.maintenance('legacy-source')
      assert.ok(row !== undefined, 'the legacy row survives the migration')
      assert.equal(row.watermark_seq, 7)
      assert.equal(row.cut_seq, null, 'the new column starts empty for a pre-existing row')
    } finally {
      store.close()
    }
  } finally {
    removeHome(legacyHome)
  }
})

test('out-of-range maintenance settings fail the composition at load', async () => {
  const cases = [
    { name: 'turns below the minimum', env: { OURFAIRY_MEMORY_MAINTENANCE_TURNS: '4' }, field: 'maintenanceTurns' },
    { name: 'decay above the maximum', env: { OURFAIRY_MEMORY_MAINTENANCE_DECAY_HOURS: '25' }, field: 'maintenanceDecayHours' },
  ]
  for (const entry of cases) {
    const caseHome = makeHome('ourfairy-memory-config-')
    try {
      const run = await runBackendAsync(['probe', '--report', join(caseHome, 'report.json')], {
        OURFAIRY_HOME: caseHome, MINIMAX_CN_API_KEY: 'mock-config-key', ...entry.env,
      })
      assert.notEqual(run.code, 0, `${entry.name} must fail the load: ${describeRun('probe', run)}`)
      assert.match(`${run.stdout}\n${run.stderr}`, new RegExp(entry.field), `${entry.name} must name ${entry.field}`)
    } finally {
      removeHome(caseHome)
    }
  }
})

test('a persisted out-of-range maintenance value fails the load at the owning Config schema', async () => {
  const caseHome = makeHome('ourfairy-memory-persisted-')
  try {
    // A first boot writes the deployment profile. The gateway's settings save
    // persists the row's whole config into the profile's user layer, so this
    // case writes that layer exactly as a save would and boots again.
    const first = await runBackendAsync(['probe', '--report', join(caseHome, 'first.json')], {
      OURFAIRY_HOME: caseHome, MINIMAX_CN_API_KEY: 'mock-config-key',
    })
    assert.equal(first.code, 0, describeRun('the profile-creating probe', first))
    const profilePatch = join(caseHome, 'dsh-home', 'profiles', 'ourfairy', 'cordis.patch.yml')
    writeFileSync(profilePatch, '- id: memory\n  config:\n'
      + `    path: ${JSON.stringify(join(caseHome, 'dsh-home', 'memory', 'memory.sqlite'))}\n`
      + `    maintenanceTurns: ${MAINTENANCE_TURNS.min - 1}\n`)

    const run = await runBackendAsync(['probe', '--report', join(caseHome, 'second.json')], {
      OURFAIRY_HOME: caseHome, MINIMAX_CN_API_KEY: 'mock-config-key',
    })
    assert.notEqual(run.code, 0, `a persisted out-of-range value must fail the load: ${describeRun('probe', run)}`)
    const output = `${run.stdout}\n${run.stderr}`
    assert.match(output, /maintenanceTurns/, 'the failure names the field')
    assert.match(output, new RegExp(`expected number >= ${MAINTENANCE_TURNS.min}`),
      'the owning Config schema rejects the persisted value at the policy minimum')
  } finally {
    removeHome(caseHome)
  }
})
