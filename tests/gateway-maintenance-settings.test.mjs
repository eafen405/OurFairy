/**
 * Ticket #247: the memory-maintenance numbers as deployment settings.
 *
 * The cases drive the shipped launcher against a real loopback Messages double,
 * exactly as the maintenance (#246) and gateway suites do. The values are read
 * and written through the authenticated gateway; their effect is observed in the
 * next maintenance evaluation, in the persisted `maintenance_state` row and in
 * the profile patch dsh itself loads after a restart — never by reaching into the
 * maintenance engine.
 *
 * The model double is deterministic and local; it is not a claim about a real
 * provider. The profile patch is read back through dsh's own patch loader, the
 * document that survives a restart, rather than through the gateway that wrote
 * it.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before the native
// modules below are loaded; it must stay the first helper import of this file.
import './helpers/dsh-peers.mjs'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

// The memory package owns the two numbers' product decision. Reading it here is
// what makes a gateway that stops consuming it fail: this file pins the policy
// to the spec's numbers and derives every gateway expectation from the policy.
const { MAINTENANCE_DECAY_HOURS, MAINTENANCE_TURNS } = await import('@ourfairy/dsh-memory/maintenance-policy')
const { loadOverlayPatches } = await import('@deepseek-ai/dsh-app-boot')

const PHAETHON_PASSWORD = 'gateway-maintenance-password'
/** The five tools a maintenance child may see, and no others. */
const MEMORY_TOOLS = ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch']

const homes = []
const doubles = []

after(async () => {
  for (const double of doubles) await double.close()
  for (const home of homes) removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-gateway-maintenance-')
  homes.push(home)
  return home
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** The maintenance state row for one source session, read from the row's own database. */
function maintenanceRow(home, sourceSession) {
  const database = new DatabaseSync(join(home, 'dsh-home', 'memory', 'memory.sqlite'))
  try {
    return database.prepare('SELECT * FROM maintenance_state WHERE source_session = ?').get(sourceSession)
  } finally {
    database.close()
  }
}

/** Set one source's persisted newest-closed-turn time, as an operator time change would. */
function setLastClosedAt(home, sourceSession, time) {
  const database = new DatabaseSync(join(home, 'dsh-home', 'memory', 'memory.sqlite'))
  try {
    database.exec('PRAGMA busy_timeout = 2000')
    database.prepare('UPDATE maintenance_state SET last_closed_at = ? WHERE source_session = ?').run(time, sourceSession)
  } finally {
    database.close()
  }
}

/**
 * The `memory` row the phone's last save persisted, read from the profile's user
 * layer with dsh's own patch loader.
 * @param {string} home - the isolated OURFAIRY_HOME the launcher booted with.
 * @returns {Record<string, any> | undefined} the saved row config.
 */
function savedMemory(home) {
  const patchPath = join(home, 'dsh-home', 'profiles', 'ourfairy', 'cordis.patch.yml')
  const row = loadOverlayPatches('dsh', patchPath).find(entry => entry.id === 'memory')
  return row?.config
}

/** Emit one Messages-protocol text response. */
function emitText(response, text) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: 'maintenance-settings-message', type: 'message', role: 'assistant',
    model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}

/**
 * Start a Messages double that answers source turns with a deterministic reply
 * and maintenance children with a zero-write completion, recording which
 * requests were children.
 */
async function startDouble() {
  const mainRequests = []
  const childRequests = []
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(Buffer.concat(chunks).toString('utf8'), response)) return
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool.name) : []
    const isChild = tools.length === MEMORY_TOOLS.length && MEMORY_TOOLS.every(name => tools.includes(name))
    if (isChild) {
      childRequests.push({ body, tools })
      emitText(response, 'MAINTENANCE-DONE')
      return
    }
    mainRequests.push({ body })
    const blocks = body.messages.flatMap(message => Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content }])
    const turnText = blocks.filter(block => block.type === 'text' && typeof block.text === 'string'
      && block.text.includes('TURN:')).at(-1)?.text ?? 'no turn'
    emitText(response, `REPLY:${turnText.slice(0, 120)}`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const double = {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    mainRequests,
    childRequests,
    env: {
      OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      MINIMAX_CN_API_KEY: 'mock-key',
    },
    close: () => new Promise(resolve => {
      server.closeAllConnections?.()
      server.close(resolve)
    }),
  }
  doubles.push(double)
  return double
}

async function bootBackend(home, env) {
  const run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD, ...env,
  })
  return startedPort(run)
}

async function stopBackend(home) {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

async function signIn(port) {
  return (await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PHAETHON_PASSWORD } })).token
}

async function newSession(port, token) {
  return (await httpJson(port, '/sessions/create', { token, body: {} })).session.id
}

/** One ordinary chat turn: send text and wait for its final Fairy reply. */
async function sendTurn(port, token, sessionId, text, requestId) {
  const seen = new Set((await httpJson(port, '/chat/read', { token, body: { sessionId } }))
    .projection.messages.map(message => message.messageId))
  await httpJson(port, '/chat/send', { token, body: { sessionId, requestId, text } })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const { projection } = await httpJson(port, '/chat/read', { token, body: { sessionId } })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seen.has(message.messageId) && message.text.startsWith('REPLY:'))
    if (reply) return reply
    if (projection.error) assert.fail(`chat failed before the reply: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the reply never returned to session ${sessionId}`)
}

/** The last closed-turn seq in one source session, read through the product route. */
async function latestEndSeq(port, token, sessionId) {
  const { projection } = await httpJson(port, '/chat/read', { token, body: { sessionId, maxEvents: 256 } })
  return projection.events.filter(event => event.type === 'turn/end').at(-1).seq
}

/** Poll one predicate until it answers a truthy value or the deadline passes. */
async function waitFor(label, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await predicate()
    if (last) return last
    await delay(25)
  }
  assert.fail(`timed out waiting for ${label}; last value ${JSON.stringify(last)}`)
}

test('the maintenance numbers are an administrator-only deployment setting: 15/6 defaults, 5–50 and 3–24, no clamping', async () => {
  const home = freshHome()
  const double = await startDouble()
  const port = await bootBackend(home, double.env)
  try {
    const admin = await signIn(port)
    const agent = await registerUser(port, admin, 'maintenance-agent')

    // The product decision the policy must carry, stated independently of it.
    assert.deepEqual({ ...MAINTENANCE_TURNS }, { default: 15, min: 5, max: 50 },
      'the memory package policy carries the spec\'s turn default and range')
    assert.deepEqual({ ...MAINTENANCE_DECAY_HOURS }, { default: 6, min: 3, max: 24 },
      'the memory package policy carries the spec\'s decay default and range')

    const initial = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    // The served defaults are the bundle's explicit deployment config, so this
    // asserts those values and not the policy's defaults: a deployment seeds a
    // row, and the policy only supplies a fallback when a row carries no value.
    assert.deepEqual(initial.maintenance, { triggerTurns: 15, decayHours: 6 },
      'the deployment defaults are 15 closed turns and a 6-hour decay interval')
    assert.equal(initial.editable.maintenance, true, 'the shipped profile mounts the memory row')
    assert.equal(initial.saved.maintenance, false, 'no user-layer override exists yet')

    const anonymous = await httpJson(port, '/gateway/maintenance', { body: { triggerTurns: 15, decayHours: 6 }, expect: false })
    assert.equal(anonymous.status, 401, anonymous.text)
    assert.equal(anonymous.json.error.code, 'gateway/unauthorized')
    for (const path of ['/gateway/read', '/gateway/maintenance']) {
      const refused = await httpJson(port, path, {
        token: agent.token, body: path === '/gateway/read' ? {} : { triggerTurns: 15, decayHours: 6 }, expect: false,
      })
      assert.equal(refused.status, 403, `${path} must refuse an ordinary agent: ${refused.text}`)
      assert.equal(refused.json.error.code, 'gateway/forbidden')
    }

    const outsideRange = [
      { triggerTurns: MAINTENANCE_TURNS.min - 1, decayHours: MAINTENANCE_DECAY_HOURS.default },
      { triggerTurns: MAINTENANCE_TURNS.max + 1, decayHours: MAINTENANCE_DECAY_HOURS.default },
      { triggerTurns: 5.5, decayHours: 6 }, { triggerTurns: '5', decayHours: 6 },
      { triggerTurns: null, decayHours: 6 },
      { triggerTurns: 15, decayHours: 2 }, { triggerTurns: 15, decayHours: 25 },
      { triggerTurns: 15, decayHours: 3.5 }, { triggerTurns: 15, decayHours: '6' },
    ]
    for (const body of outsideRange) {
      const refused = await httpJson(port, '/gateway/maintenance', { token: admin, body, expect: false })
      assert.equal(refused.status, 400, `${JSON.stringify(body)}: ${refused.text}`)
      assert.equal(refused.json.error.code, 'gateway/invalid-maintenance')
      if (body.triggerTurns !== MAINTENANCE_TURNS.default) {
        assert.match(refused.json.error.message,
          new RegExp(`from ${MAINTENANCE_TURNS.min} to ${MAINTENANCE_TURNS.max}`, 'u'),
          'the refusal states the policy\'s turn range')
      } else {
        assert.match(refused.json.error.message,
          new RegExp(`from ${MAINTENANCE_DECAY_HOURS.min} to ${MAINTENANCE_DECAY_HOURS.max}`, 'u'),
          'the refusal states the policy\'s hour range')
      }
    }
    for (const body of [{}, { triggerTurns: 15 }, { decayHours: 6 },
      { triggerTurns: 15, decayHours: 6, clamp: true }]) {
      const refused = await httpJson(port, '/gateway/maintenance', { token: admin, body, expect: false })
      assert.equal(refused.status, 400, `${JSON.stringify(body)}: ${refused.text}`)
      assert.equal(refused.json.error.code, 'gateway/invalid-maintenance')
    }

    const untouched = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(untouched.maintenance, { triggerTurns: 15, decayHours: 6 },
      'a refused write is not reported as saved')
    assert.equal(untouched.saved.maintenance, false)

    const boundaries = [
      { triggerTurns: MAINTENANCE_TURNS.min, decayHours: MAINTENANCE_DECAY_HOURS.min },
      { triggerTurns: MAINTENANCE_TURNS.max, decayHours: MAINTENANCE_DECAY_HOURS.max },
    ]
    assert.deepEqual(boundaries, [{ triggerTurns: 5, decayHours: 3 }, { triggerTurns: 50, decayHours: 24 }],
      'the policy boundaries are the spec\'s 5/50 and 3/24')
    for (const maintenance of boundaries) {
      const saved = await httpJson(port, '/gateway/maintenance', { token: admin, body: maintenance })
      assert.deepEqual(saved.maintenance, maintenance, 'both range boundaries are accepted inclusively')
    }
    const stored = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(stored.maintenance, { triggerTurns: 50, decayHours: 24 })
    assert.equal(stored.saved.maintenance, true)
    const row = savedMemory(home)
    assert.equal(row.maintenanceTurns, 50, 'the value is stored on the memory row, not invented by the gateway')
    assert.equal(row.maintenanceDecayHours, 24)
    // The memory row's other volatile fields are written back too; the native
    // settings writer keeps the deployment's own `!!js` expressions for them,
    // so compare the expression's text rather than claiming a resolved value.
    assert.match(JSON.stringify(row.maintenanceModel), /MiniMax-M3\.1-Flash/u,
      'saving the two numbers leaves the light-model route alone')
    assert.match(JSON.stringify(row.maintenanceProvider), /minimax-cn/u)
    assert.match(JSON.stringify(row.path), /memory\.sqlite/u, 'the native row keeps its database path')
  } finally {
    await stopBackend(home)
  }

  // The saved values are in the profile user layer, so a fresh process reads
  // them instead of the deployment defaults.
  const restartedPort = await bootBackend(home, double.env)
  try {
    const admin = await signIn(restartedPort)
    const read = (await httpJson(restartedPort, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(read.maintenance, { triggerTurns: 50, decayHours: 24 },
      'the saved maintenance numbers survive a restart')
    assert.equal(read.saved.maintenance, true)
    assert.equal(savedMemory(home).maintenanceTurns, 50)
  } finally {
    await stopBackend(home)
  }
})

test('a saved trigger turn count re-evaluates a parked interval, does not reset the watermark, and survives a restart', async () => {
  const home = freshHome()
  const double = await startDouble()
  const port = await bootBackend(home, double.env)
  let existingSession
  let existingWatermark
  try {
    const admin = await signIn(port)
    const alice = await registerUser(port, admin, 'maintenance-hot-trigger')
    existingSession = await newSession(port, alice.token)
    for (let index = 0; index < 6; index += 1) {
      await sendTurn(port, alice.token, existingSession, `TURN:${index}:维护设置前置${index}轮`, `hot-trigger-${index}`)
    }
    const latest = await latestEndSeq(port, alice.token, existingSession)
    const observed = await waitFor('the observed parked interval', () => {
      const row = maintenanceRow(home, existingSession)
      return row?.cut_seq === latest ? row : undefined
    })
    assert.equal(observed.child_session, null, 'six turns stay below the default threshold of fifteen')
    await delay(1200)
    assert.equal(double.childRequests.length, 0, 'no child starts before the saved first number applies')

    const read = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(read.maintenance, { triggerTurns: 15, decayHours: 6 })
    const saved = await httpJson(port, '/gateway/maintenance', {
      token: admin, body: { triggerTurns: 5, decayHours: 6 },
    })
    assert.deepEqual(saved.maintenance, { triggerTurns: 5, decayHours: 6 })

    const completed = await waitFor('the parked interval maintained under the saved five turns', () => {
      const row = maintenanceRow(home, existingSession)
      return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
    })
    assert.equal(completed.watermark_seq, latest, 'the completed watermark covers exactly the parked interval')
    assert.equal(completed.cut_seq, latest)
    assert.equal(double.childRequests.length, 1, 'the same parked interval starts exactly one child after the save')
    existingWatermark = completed.watermark_seq

    // Changing the second number is a settings write only: the persisted
    // watermark must not move back, so the interval already maintained is not
    // maintained again.
    await httpJson(port, '/gateway/maintenance', { token: admin, body: { triggerTurns: 5, decayHours: 3 } })
    await delay(2200)
    const afterSecondSave = maintenanceRow(home, existingSession)
    assert.equal(afterSecondSave.watermark_seq, existingWatermark, 'a settings save does not reset the existing watermark')
    assert.equal(double.childRequests.length, 1, 'the maintained interval is not maintained again by the second save')
    assert.deepEqual(
      (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway.maintenance,
      { triggerTurns: 5, decayHours: 3 },
    )
  } finally {
    await stopBackend(home)
  }

  // The saved numbers are in the profile user layer. A fresh process applies
  // the five-turn trigger to a brand-new source, while the existing source's
  // watermark stays where the first process left it.
  const restartedPort = await bootBackend(home, double.env)
  try {
    const admin = await signIn(restartedPort)
    const read = (await httpJson(restartedPort, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(read.maintenance, { triggerTurns: 5, decayHours: 3 }, 'the saved numbers survive the restart')
    assert.equal(read.saved.maintenance, true)
    await delay(2200)
    assert.equal(maintenanceRow(home, existingSession).watermark_seq, existingWatermark,
      'restart uses the persisted watermark instead of resetting it')
    assert.equal(double.childRequests.length, 1, 'the fully maintained source does not start another child on boot')

    const bob = await registerUser(restartedPort, admin, 'maintenance-hot-restart')
    const freshSession = await newSession(restartedPort, bob.token)
    for (let index = 0; index < 5; index += 1) {
      await sendTurn(restartedPort, bob.token, freshSession, `TURN:${index}:重启后五轮${index}`, `hot-restart-${index}`)
    }
    const freshLatest = await latestEndSeq(restartedPort, bob.token, freshSession)
    const freshCompleted = await waitFor('the restarted five-turn maintenance', () => {
      const row = maintenanceRow(home, freshSession)
      return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
    })
    assert.equal(freshCompleted.watermark_seq, freshLatest)
    assert.equal(double.childRequests.length, 2, 'the persisted five-turn trigger starts one child in the new process')
    assert.equal(double.childRequests[1].body.model, 'MiniMax-M3.1-Flash',
      'the saved settings keep the deployment light-model route')
  } finally {
    await stopBackend(home)
  }
})

test('a saved decay interval re-evaluates a parked interval under the new threshold', async () => {
  const home = freshHome()
  const double = await startDouble()
  const port = await bootBackend(home, double.env)
  try {
    const admin = await signIn(port)
    const alice = await registerUser(port, admin, 'maintenance-hot-decay')
    const session = await newSession(port, alice.token)
    for (let index = 0; index < 10; index += 1) {
      await sendTurn(port, alice.token, session, `TURN:${index}:衰减设置前置${index}轮`, `hot-decay-${index}`)
    }
    const latest = await latestEndSeq(port, alice.token, session)
    const observed = await waitFor('the observed interval', () => {
      const row = maintenanceRow(home, session)
      return row?.cut_seq === latest ? row : undefined
    })
    assert.equal(observed.child_session, null, 'ten turns stay below the default threshold of fifteen')

    // Fifteen hours of rest: under the deployment's six-hour decay the
    // threshold is 15 - floor(15/6) = 13, so ten pending turns are still below
    // it. The interval is parked and untouched.
    setLastClosedAt(home, session, Date.now() - 15 * 60 * 60 * 1000)
    await delay(2200)
    assert.equal(double.childRequests.length, 0,
      'under the deployment decay the parked ten-turn interval stays below its threshold')

    // Under the saved three-hour decay the same clock gives 15 - 5 = 10, so
    // the parked interval now meets the threshold without any new turn.
    const saved = await httpJson(port, '/gateway/maintenance', {
      token: admin, body: { triggerTurns: 15, decayHours: 3 },
    })
    assert.deepEqual(saved.maintenance, { triggerTurns: 15, decayHours: 3 })
    const completed = await waitFor('the parked interval maintained under the saved three-hour decay', () => {
      const row = maintenanceRow(home, session)
      return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
    })
    assert.equal(completed.watermark_seq, latest, 'the maintained interval is the same parked one')
    assert.equal(double.childRequests.length, 1,
      'the same parked interval starts exactly one child under the newly saved decay')
  } finally {
    await stopBackend(home)
  }
})
