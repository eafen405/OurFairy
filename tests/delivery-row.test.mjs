/**
 * Ticket #99: delivery runs as its own product row.
 *
 * The case disables that one row through the composition's supported overlay
 * (`--patch`) and asserts only what a caller can see: the model is offered no
 * `deliver_message` tool, a pending delivery is not recovered, and chat still
 * sends and reads. The complement — the same pending row settling when the row
 * is mounted — is the final boot here; the ordinary delivery suites cover the
 * semantics with the row mounted.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'
import {
  dshDir, describeRun, httpJson, makeHome, removeHome, runBackendAsync, startArgs, startedPort, writeOverlay,
} from './helpers/backend.mjs'

const PHAETHON_PASSWORD = 'delivery-row-password'
const PENDING_TEXT = 'Pending behind the failing business update'
const DISABLED_ATTEMPT = 'Never delivered while the row is disabled'
const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))

const servers = []
const homes = []
after(async () => {
  for (const server of servers) await server.close()
  for (const home of homes) removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-delivery-row-')
  homes.push(home)
  return home
}

async function modelDouble(options = {}) {
  const server = await startMockLlmServer({ host: '127.0.0.1', port: 0, apiKey: 'mock-key', sequence: ['success'], ...options })
  servers.push(server)
  return { server, env: { OURFAIRY_MINIMAX_BASE_URL: `${server.baseURL}`, MINIMAX_CN_API_KEY: 'mock-key' } }
}

async function start(home, env, overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), {
    OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD, ...env,
  })
  return startedPort(run)
}

async function stop(home) {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

async function signIn(port, name, password) {
  return (await httpJson(port, '/identity/sign-in', { body: { name, password } })).token
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Wait for one caller-visible condition, polling the projection the phone reads. */
async function until(port, token, sessionId, check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let projection
  do {
    projection = (await httpJson(port, '/chat/read', { token, body: { sessionId } })).projection
    if (check(projection)) return projection
    await delay(25)
  } while (Date.now() < deadline)
  assert.fail(`condition not reached; projection was ${JSON.stringify({
    replyStatus: projection?.replyStatus, error: projection?.error,
    messages: projection?.messages?.map(message => [message.role, message.status, message.text.slice(0, 60)]),
    types: projection?.events?.map(event => event.type),
  })}`)
}

async function requestUntil(work, check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await work()
    if (check(value)) return value
    if (Date.now() > deadline) assert.fail('condition not reached before the timeout')
    await delay(25)
  }
}

const dbPath = home => join(home, 'dsh-home', 'identity', 'identity.sqlite')

/** Tool names the model was offered in one captured request. */
const offeredTools = request => (Array.isArray(request?.body?.tools) ? request.body.tools.map(tool => tool?.name) : [])

test('disabling the delivery row removes the tool and recovery while chat still routes', async () => {
  const home = freshHome()

  // ── With the row mounted: leave one delivery pending behind a failing update.
  const mounted = await modelDouble({
    sequence: ['tool_call_success', 'success'],
    toolName: 'deliver_message',
    toolArguments: JSON.stringify({ recipientShortId: 2, text: PENDING_TEXT }),
  })
  let port = await start(home, mounted.env)
  const admin = await signIn(port, 'phaethon', PHAETHON_PASSWORD)
  const recipient = await httpJson(port, '/identity/invite', { token: admin })
  const registered = await httpJson(port, '/identity/register', {
    body: { inviteCode: recipient.invite.code, name: 'delivery-row-recipient', password: 'recipient-password' },
  })
  assert.equal(registered.user.shortId, 2, 'the pending fixture names short number 2')
  const recipientToken = registered.token
  const senderSession = (await httpJson(port, '/sessions/create', { token: admin, body: {} })).session.id

  const db = new DatabaseSync(dbPath(home))
  db.exec(`CREATE TRIGGER fail_delivery_update BEFORE UPDATE ON deliveries WHEN NEW.recipient_short_id = 2
    BEGIN SELECT RAISE(ABORT, 'injected business update failure'); END`)
  await httpJson(port, '/chat/send', { token: admin, body: { sessionId: senderSession, requestId: 'pending-delivery', text: 'deliver during the mounted row' } })
  // The second model request proves the tool has already run; the native append
  // succeeded and only the business update was refused.
  await requestUntil(async () => mounted.server.requests.length, length => length >= 2)
  const pending = db.prepare('SELECT * FROM deliveries WHERE text = ?').get(PENDING_TEXT)
  assert.ok(pending !== undefined, 'the mounted row prepared a durable delivery row')
  assert.equal(pending.status, 0, 'the business update failure leaves the row pending')
  db.exec('DROP TRIGGER fail_delivery_update')
  db.close()
  await stop(home)

  // ── With only the delivery row disabled: the tool and recovery are gone, chat still works.
  const disabled = await modelDouble({
    sequence: ['success', 'tool_call_success', 'success'],
    toolName: 'deliver_message',
    toolArguments: JSON.stringify({ recipientShortId: 2, text: DISABLED_ATTEMPT }),
  })
  const overlay = writeOverlay(home, [{ id: 'delivery', disabled: true }], 'no-delivery.patch.yml')
  port = await start(home, disabled.env, [overlay])
  const session = (await httpJson(port, '/sessions/create', { token: admin, body: {} })).session.id
  await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session, requestId: 'chat-still-routes', text: 'hello without the delivery row' } })
  const projection = await until(port, admin, session, value =>
    value.replyStatus === 0 && value.messages.some(message => message.role === 2 && message.status === 2))
  assert.ok(projection.messages.some(message => message.role === 1), 'chat accepted the user message with the row disabled')
  assert.equal(disabled.server.requests.length, 1, 'the chat send is the only model request so far')

  const catalog = offeredTools(disabled.server.requests[0])
  assert.ok(catalog.includes('todo_write'), `the catalog was captured; it offered ${JSON.stringify(catalog)}`)
  assert.equal(catalog.includes('deliver_message'), false,
    `the disabled row must offer no deliver_message tool; catalog was ${JSON.stringify(catalog)}`)

  // A caller that asks for the absent capability is answered with an explicit failure.
  await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session, requestId: 'call-absent-tool', text: 'try the delivery tool' } })
  await requestUntil(async () => disabled.server.requests.length, length => length >= 3)
  const toolResults = disabled.server.requests[2].body.messages.flatMap(message =>
    Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'tool_result')
  const toolText = block => typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
  assert.ok(toolResults.some(block => toolText(block).includes('unknown tool "deliver_message"')),
    `the absent capability must fail explicitly; tool results were ${JSON.stringify(toolResults)}`)

  // Recovery is a property of the disabled row: the pending delivery stays pending.
  const check = new DatabaseSync(dbPath(home))
  const stillPending = check.prepare('SELECT * FROM deliveries WHERE text = ?').get(PENDING_TEXT)
  assert.equal(stillPending.status, 0, 'the disabled row must not recover the pending delivery')
  assert.equal(check.prepare('SELECT COUNT(*) AS count FROM deliveries').get().count, 1,
    'the absent tool cannot prepare another delivery row')
  check.close()

  const target = (await httpJson(port, '/sessions/primary', { token: recipientToken, body: {} })).session.id
  const delivered = (await httpJson(port, '/chat/read', { token: recipientToken, body: { sessionId: target } })).projection
  assert.deepEqual(delivered.events.filter(event => event.type === 'delivery/message').map(event => event.data.message.content[0].text),
    [PENDING_TEXT], 'the disabled row appended nothing for the refused call')
  await stop(home)

  // ── The same pending row recovers once the row is mounted again.
  port = await start(home, disabled.env)
  const recovered = await requestUntil(async () => {
    const probe = new DatabaseSync(dbPath(home))
    try { return probe.prepare('SELECT status FROM deliveries WHERE text = ?').get(PENDING_TEXT).status }
    finally { probe.close() }
  }, status => status === 1)
  assert.equal(recovered, 1, 'mounted delivery recovery settles the pending row')
  await stop(home)
})
