/**
 * Ticket #243: the automatic-compaction trigger threshold as a deployment
 * setting.
 *
 * The cases drive the shipped launcher against a real loopback Messages double,
 * exactly as the other gateway and native-compaction suites do. The setting is
 * read and written through the authenticated gateway, and its effect is observed
 * in the next native pressure check and in the durable events the phone replays —
 * never by reaching into the compaction engine.
 *
 * The loopback double reports deterministic input-token usage so a pressure pass
 * can be produced on demand; it is a model double, not a claim about a real
 * provider. The profile patch is read back through dsh's own patch loader, the
 * document that survives a restart, rather than through the gateway that wrote
 * it.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { after, test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before the native
// modules below are loaded; it must stay the first helper import of this file.
import './helpers/dsh-peers.mjs'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'

const { loadOverlayPatches } = await import('@deepseek-ai/dsh-app-boot')

const PHAETHON_PASSWORD = 'gateway-compaction-password'
const COMPACTION_INSTRUCTION = 'You are now acting as a compaction engine'
const PRUNE_HEAD = 'PRUNE-HEAD-MARKER'
const PRUNE_MIDDLE = 'PRUNE-MIDDLE-MARKER'
const PRUNE_TAIL = 'PRUNE-TAIL-MARKER'
const PRUNE_OUTPUT_COMMAND = `printf '${PRUNE_HEAD}'; head -c 5900 /dev/zero | tr '\\0' a; printf '${PRUNE_MIDDLE}'; head -c 6000 /dev/zero | tr '\\0' b; printf '${PRUNE_TAIL}'`

const homes = []
const doubles = []

after(async () => {
  for (const double of doubles) await double.close()
  for (const home of homes) removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-gateway-compaction-')
  homes.push(home)
  return home
}

/** Every content block of one wire message, in order. */
function blocksOf(message) {
  const content = message?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

/** The text blocks of one message joined in order. */
function textOf(message) {
  return blocksOf(message).filter(block => block.type === 'text').map(block => block.text).join('')
}

/** The text of every tool result block in one captured request. */
function toolResultText(body) {
  return blocksOf({ content: (body?.messages ?? []).flatMap(message => blocksOf(message)) })
    .filter(block => block.type === 'tool_result')
    .map(block => {
      if (typeof block.content === 'string') return block.content
      return (block.content ?? []).filter(inner => inner.type === 'text').map(inner => inner.text).join('')
    })
    .join('\n')
}

/** The text of the last user message that is not the session's injected runtime context. */
function currentUserText(body) {
  const users = (body?.messages ?? []).filter(message => message.role === 'user')
  const current = users.findLast(message => {
    const text = textOf(message)
    return text !== '' && !text.startsWith('Current runtime context.')
  })
  return current === undefined ? '' : textOf(current)
}

/** True when the request is the native compaction summarization call. */
function isCompactionRequest(body) {
  return (body?.messages ?? []).some(message => message.role === 'user'
    && blocksOf(message).some(block => block.type === 'text' && block.text.includes(COMPACTION_INSTRUCTION)))
}

/**
 * Start a Messages double whose responder chooses each reply from the request
 * it received: a text reply or a tool call, each naming its reported input
 * tokens so the native pressure check has a deterministic measurement.
 */
async function startDouble(responder) {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let data = ''
    for await (const chunk of request) data += chunk
    const body = JSON.parse(data)
    requests.push({ body })
    const reply = responder(body, requests.length - 1)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({
      type: 'message_start',
      message: {
        id: `double-${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: 'MiniMax-M3.1-Flash',
        content: [],
        usage: { input_tokens: reply.usage?.input ?? 1000, output_tokens: 0 },
      },
    })
    if (reply.tool !== undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: {
        type: 'tool_use', id: reply.tool.id, name: reply.tool.name, input: {},
      } })
      emit({ type: 'content_block_delta', index: 0, delta: {
        type: 'input_json_delta', partial_json: JSON.stringify(reply.tool.input),
      } })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({
      type: 'message_delta',
      delta: { stop_reason: reply.tool === undefined ? 'end_turn' : 'tool_use', stop_sequence: null },
      usage: { output_tokens: reply.usage?.output ?? 0 },
    })
    emit({ type: 'message_stop' })
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const double = {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    requests,
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
  return { run, port: startedPort(run) }
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

async function send(port, token, sessionId, requestId, text) {
  await httpJson(port, '/chat/send', { token, body: { sessionId, requestId, text } })
}

/** Wait for one caller-visible condition on the projection the phone reads. */
async function until(port, token, sessionId, check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  let projection
  do {
    projection = (await httpJson(port, '/chat/read', { token, body: { sessionId } })).projection
    if (check(projection)) return projection
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  assert.fail(`condition not reached; projection was ${JSON.stringify({
    replyStatus: projection?.replyStatus,
    error: projection?.error,
    messages: projection?.messages?.map(message => [message.role, message.status, message.text?.slice(0, 40)]),
    types: projection?.events?.map(event => event.type),
  })}`)
}

/** Wait until one assistant settlement carries the marker. */
function waitReply(port, token, sessionId, marker) {
  return until(port, token, sessionId, projection => (projection.messages ?? [])
    .some(message => message.role === 2 && message.status === 2 && message.text?.includes(marker)))
}

/**
 * The `compaction-basic` row the phone's last save persisted, read from the
 * profile's user layer with dsh's own patch loader.
 * @param {string} home - the isolated OURFAIRY_HOME the launcher booted with.
 * @returns {Record<string, any> | undefined} the saved row config.
 */
function savedCompaction(home) {
  const patchPath = join(home, 'dsh-home', 'profiles', 'ourfairy', 'cordis.patch.yml')
  const row = loadOverlayPatches('dsh', patchPath).find(entry => entry.id === 'compaction-basic')
  return row?.config
}

test('the threshold is an administrator-only deployment setting: 500K default, 100K–900K, no silent rounding', async () => {
  const home = freshHome()
  const double = await startDouble(() => ({ text: 'UNUSED', usage: { input: 10, output: 1 } }))
  const { port } = await bootBackend(home, double.env)
  try {
    const admin = await signIn(port)
    const agent = await registerUser(port, admin, 'compaction-agent')

    const initial = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(initial.compaction, { thresholdTokens: 500000 }, 'the deployment default is 500K tokens')
    assert.equal(initial.editable.compaction, true, 'the shipped profile mounts the compaction row')
    assert.equal(initial.saved.compaction, false, 'no user-layer override exists yet')

    const anonymous = await httpJson(port, '/gateway/compaction', { body: { thresholdTokens: 500000 }, expect: false })
    assert.equal(anonymous.status, 401, anonymous.text)
    assert.equal(anonymous.json.error.code, 'gateway/unauthorized')
    for (const path of ['/gateway/read', '/gateway/compaction']) {
      const refused = await httpJson(port, path, {
        token: agent.token, body: path === '/gateway/read' ? {} : { thresholdTokens: 700000 }, expect: false,
      })
      assert.equal(refused.status, 403, `${path} must refuse an ordinary agent: ${refused.text}`)
      assert.equal(refused.json.error.code, 'gateway/forbidden')
    }

    const outsideRange = [99999, 900001, 500000.5, '500000', null]
    for (const thresholdTokens of outsideRange) {
      const refused = await httpJson(port, '/gateway/compaction', { token: admin, body: { thresholdTokens }, expect: false })
      assert.equal(refused.status, 400, `${JSON.stringify(thresholdTokens)}: ${refused.text}`)
      assert.equal(refused.json.error.code, 'gateway/invalid-compaction')
      assert.match(refused.json.error.message, /100000/u, 'the refusal states the lower bound')
      assert.match(refused.json.error.message, /900000/u, 'the refusal states the upper bound')
    }
    for (const body of [{}, { thresholdTokens: 500000, clamp: true }]) {
      const refused = await httpJson(port, '/gateway/compaction', { token: admin, body, expect: false })
      assert.equal(refused.status, 400, `${JSON.stringify(body)}: ${refused.text}`)
      assert.equal(refused.json.error.code, 'gateway/invalid-compaction')
    }

    const untouched = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(untouched.compaction, { thresholdTokens: 500000 }, 'a refused write is not reported as saved')
    assert.equal(untouched.saved.compaction, false)

    for (const thresholdTokens of [100000, 900000]) {
      const saved = await httpJson(port, '/gateway/compaction', { token: admin, body: { thresholdTokens } })
      assert.deepEqual(saved.compaction, { thresholdTokens }, 'both range boundaries are accepted as whole tokens')
    }
    const stored = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(stored.compaction, { thresholdTokens: 900000 })
    assert.equal(stored.saved.compaction, true)
    const row = savedCompaction(home)
    assert.equal(row.thresholdTokens, 900000,
      'the threshold is stored on the compaction-basic row, not invented by the gateway')
    assert.equal(row.retainTokens, 16000,
      'the retained tail stays deployment-owned; it is not a second editable setting')
  } finally {
    await stopBackend(home)
  }
})

test('a saved threshold drives the next pressure check, ignores model switching, and survives a restart', async () => {
  const home = freshHome()
  const double = await startDouble((body, index) => {
    if (isCompactionRequest(body)) return { text: 'COMPACTION-SUMMARY', usage: { input: 50, output: 10 } }
    const current = currentUserText(body)
    if (current.includes('HIGH-THRESHOLD-TURN')) {
      return { text: 'HIGH-THRESHOLD-REPLY', usage: { input: 500000, output: 5 } }
    }
    if (current.includes('AFTER-RESTART-TURN')) {
      return { text: 'AFTER-RESTART-REPLY', usage: { input: 500000, output: 5 } }
    }
    if (current.includes('LOW-THRESHOLD-TURN')) {
      return { text: 'LOW-THRESHOLD-REPLY', usage: { input: 150, output: 5 } }
    }
    if (current.includes('PRUNE-TURN')) {
      if (toolResultText(body).length > 10000) {
        return { text: 'PRUNE-TURN-DONE', usage: { input: 500000, output: 0 } }
      }
      return {
        tool: {
          id: `bash-call-${index}`,
          name: 'bash',
          input: { command: PRUNE_OUTPUT_COMMAND, description: 'produce a result larger than the pruning budget' },
        },
        usage: { input: 900, output: 5 },
      }
    }
    throw new Error(`unexpected request: ${JSON.stringify((body.messages ?? []).map(message => textOf(message).slice(0, 80)))}`)
  })
  const { port } = await bootBackend(home, double.env)
  try {
    const admin = await signIn(port)
    const sessionId = await newSession(port, admin)
    const high = await httpJson(port, '/gateway/compaction', { token: admin, body: { thresholdTokens: 900000 } })
    assert.deepEqual(high.compaction, { thresholdTokens: 900000 })

    await send(port, admin, sessionId, 'prune-turn', 'PRUNE-TURN runs a large command')
    await waitReply(port, admin, sessionId, 'PRUNE-TURN-DONE')

    // The last provider report was 500 000 input tokens, below the saved
    // 900 000 ceiling: the next step must not run a pressure pass.
    await send(port, admin, sessionId, 'high-turn', 'HIGH-THRESHOLD-TURN')
    const highProjection = await waitReply(port, admin, sessionId, 'HIGH-THRESHOLD-REPLY')
    assert.equal(highProjection.events.filter(event => event.type === 'compaction/prune').length, 0,
      'a 500 000-token session stays below the saved 900 000 ceiling')
    const highRequest = double.requests.find(request => currentUserText(request.body).includes('HIGH-THRESHOLD-TURN'))
    assert.ok(highRequest !== undefined, 'the high-threshold turn reached the model')
    assert.equal(toolResultText(highRequest.body).includes(PRUNE_MIDDLE), true,
      'below the ceiling the model still sees the whole tool result')

    // Lower the threshold; the running process must use it on the next pressure
    // check without a restart or re-mount.
    await httpJson(port, '/gateway/compaction', { token: admin, body: { thresholdTokens: 100000 } })

    // The next pressure check sees 500 000 >= the saved 100 000 and prunes the
    // oversized tool result before the request.
    await send(port, admin, sessionId, 'low-turn', 'LOW-THRESHOLD-TURN')
    const lowProjection = await waitReply(port, admin, sessionId, 'LOW-THRESHOLD-REPLY')
    assert.equal(lowProjection.events.filter(event => event.type === 'compaction/prune').length, 1,
      'the next pressure check uses the value saved moments earlier')
    const lowRequest = double.requests.find(request => currentUserText(request.body).includes('LOW-THRESHOLD-TURN'))
    assert.ok(lowRequest !== undefined, 'the low-threshold turn reached the model')
    const trimmed = toolResultText(lowRequest.body)
    assert.ok(trimmed.includes(PRUNE_HEAD), 'the head of the oversized result is retained')
    assert.ok(trimmed.includes(PRUNE_TAIL), 'the tail of the oversized result is retained')
    assert.equal(trimmed.includes(PRUNE_MIDDLE), false, 'the middle is pruned only after the saved threshold applied')
    assert.equal(double.requests.some(request => isCompactionRequest(request.body)), false,
      'pruning relieved the measured pressure, so no summarization request was needed')
  } finally {
    await stopBackend(home)
  }

  // The saved threshold is in the profile user layer, so a fresh process reads
  // it and its next pressure check uses it again.
  const restarted = await bootBackend(home, double.env)
  try {
    const admin = await signIn(restarted.port)
    const read = (await httpJson(restarted.port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(read.compaction, { thresholdTokens: 100000 }, 'the saved threshold survives a restart')
    assert.equal(read.saved.compaction, true)
    assert.equal(savedCompaction(home).thresholdTokens, 100000)

    const sessionId = await newSession(restarted.port, admin)
    await send(restarted.port, admin, sessionId, 'after-restart-prune', 'PRUNE-TURN after the restart')
    await waitReply(restarted.port, admin, sessionId, 'PRUNE-TURN-DONE')
    await send(restarted.port, admin, sessionId, 'after-restart-low', 'AFTER-RESTART-TURN')
    const after = await waitReply(restarted.port, admin, sessionId, 'AFTER-RESTART-REPLY')
    assert.equal(after.events.filter(event => event.type === 'compaction/prune').length, 1,
      'a fresh process still applies the persisted threshold on the next pressure check')

    // Switching the shared model is not a change to this deployment policy: a
    // real model switch leaves both the read value and its owning row alone.
    await httpJson(restarted.port, '/gateway/selection', { token: admin,
      body: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' } })
    const switched = (await httpJson(restarted.port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.equal(switched.selection.provider, 'deepseek-official', 'the shared selection changed')
    assert.equal(switched.selection.model, 'deepseek-flash')
    assert.deepEqual(switched.compaction, { thresholdTokens: 100000 },
      'switching the model leaves the compaction threshold alone')
    assert.equal(savedCompaction(home).thresholdTokens, 100000)
  } finally {
    await stopBackend(home)
  }
})
