/**
 * Ticket #242: the native auto-compaction rows in the real product profile.
 *
 * Every behavioural case drives the shipped launcher against a real loopback
 * Messages double — the same external model interface a deployment uses. The
 * assertions read what crossed the wire, the durable events the phone replays,
 * and the reply the authenticated session receives; no plugin is assembled by
 * hand. The one non-boot case reads the shipped bundle through dsh's own patch
 * loader, which is the composition the launcher boots.
 *
 * @covers backend/attachments — the image the offload cases carry arrives
 * through the product's attachment routes.
 * @covers backend/memory — one case scripts a `memory_search` call and asserts
 * the compacted session can still make it.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import {
  dshDir, describeRun, httpJson, makeHome, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const PHAETHON_PASSWORD = 'native-compaction-password'
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const bundlePatch = join(repoRoot, combo.backend.bundlePathInRepo, 'cordis.patch.yml')
const boot = createRequire(join(dshDir, 'apps', 'cli', 'package.json'))('@deepseek-ai/dsh-app-boot')

const COMPACTION_INSTRUCTION = 'You are now acting as a compaction engine'
const SUMMARY_MARKER = 'COMPACTION-SUMMARY-MARKER'
const MEMORY_QUERY = 'COMPACTION-MEMORY-MARKER'
const SUMMARY_TEXT = `${MEMORY_QUERY} ${SUMMARY_MARKER}: the earlier turns were condensed.`
const AFTER_TEXT = 'AFTER-COMPACTION-REPLY'
const OLD_MARKER = 'OLD-TURN-MARKER'
const MID_MARKER = 'MID-TURN-MARKER'
const MID2_MARKER = 'RECENT-TURN-MARKER'
const NEW_MARKER = 'SECOND-TURN-MARKER'
const FINAL_MARKER = 'TURN-ONE-DONE-MARKER'
const SMALL_TOOL_OUTPUT = 'SMALL-TOOL-OUTPUT'

/** Generated text with an exact character count, so token sums are deterministic under the native 4-char estimator. */
function padded(marker, chars) {
  return `${marker} ${'x'.repeat(Math.max(0, chars - marker.length - 1))}`
}

const OLD_TEXT = padded(OLD_MARKER, 48000)
const MID_TEXT = padded(MID_MARKER, 40000)
const MID2_TEXT = padded(MID2_MARKER, 30000)
// The newest assistant text is deliberately just below the 16 000-token
// budget, so the tool result before it is the node that crosses the retained
// tail and the selector must back up to the tool call instead of orphaning it.
const FINAL_TEXT = padded(FINAL_MARKER, 63908)
const NEW_TEXT = padded(NEW_MARKER, 400)

const homes = []
const doubles = []
after(async () => {
  for (const double of doubles) await double.close()
  for (const home of homes) removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-native-compaction-')
  homes.push(home)
  return home
}

/** Every content block of one wire or projected message, in order. */
function blocksOf(message) {
  const content = message?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

/** The text blocks of one message joined in order. */
function textOf(message) {
  return blocksOf(message).filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Every block of every message in one captured request. */
function allBlocks(body) {
  return (body?.messages ?? []).flatMap(message => blocksOf(message))
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

/** True when the request already carries a compaction checkpoint. */
function hasCheckpoint(body) {
  return allBlocks(body).some(block => block.type === 'text' && block.text.includes('<compacted-summary>'))
}

/** The text of every tool result block in one captured request. */
function toolResultText(body) {
  return allBlocks(body).filter(block => block.type === 'tool_result').map(block => {
    if (typeof block.content === 'string') return block.content
    return (block.content ?? []).filter(inner => inner.type === 'text').map(inner => inner.text).join('')
  }).join('\n')
}

/**
 * Start a Messages double whose responder chooses each reply from the request
 * it received. The responder returns a text reply, a tool call, an HTTP error,
 * or `'hang'` (accept the request and never answer).
 */
async function startDouble(responder) {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let data = ''
    for await (const chunk of request) data += chunk
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(data, response)) return
    const body = JSON.parse(data)
    requests.push({ body })
    const reply = responder(body, requests.length - 1)
    if (reply === 'hang') return
    if (reply.kind === 'error') {
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: reply.message, type: reply.type, code: reply.code } }))
      return
    }
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
      const args = JSON.stringify(reply.tool.input)
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args } })
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

async function bootBackend(home, env, overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    ...env,
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

test('the shipped bundle composes native compaction and no command compaction row', () => {
  const rows = boot.composeEntries([boot.loadOverlayPatches('dsh', bundlePatch)])
  assert.deepEqual(rows.map(row => row.id), ['kernel', 'plugins'], 'the bundle keeps its two segments')
  const kernel = rows.find(row => row.id === 'kernel').config
  const byId = new Map(kernel.map(row => [row.id, row]))
  const compaction = byId.get('compaction-basic')
  assert.ok(compaction !== undefined, `kernel must mount compaction-basic; it mounts ${JSON.stringify([...byId.keys()])}`)
  assert.equal(compaction.name, '@deepseek-ai/dsh-compaction-basic')
  assert.deepEqual(compaction.config, { thresholdTokens: 500000, retainTokens: 16000 },
    'the deployment budgets are explicit: 500 000 absolute tokens and a 16 000-token retained tail')
  assert.equal(byId.get('token-meter')?.name, '@deepseek-ai/dsh-token-meter',
    'compaction pressure comes from the singleton token meter')
  const pruner = byId.get('tool-result-pruner')
  assert.equal(pruner?.name, '@deepseek-ai/dsh-compaction-tool-result-pruner')
  assert.deepEqual(pruner.config, { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
    'the model-visible tool-result budget is stated, not inherited from a dsh default')
  assert.equal(byId.get('image-offload')?.name, '@deepseek-ai/dsh-compaction-image-offload')
  const mounted = rows.flatMap(row => Array.isArray(row.config) ? row.config : [])
  assert.equal(mounted.some(row => row.name === '@deepseek-ai/dsh-command-compact'), false,
    'the /compact command surface stays out: the product mounts no command registry and only automatic entry points apply')
})

test('a session above the absolute ceiling condenses, keeps tool pairing and recent text, and continues', async () => {
  const home = freshHome()
  const double = await startDouble(body => {
    if (isCompactionRequest(body)) return { text: SUMMARY_TEXT, usage: { input: 50, output: 10 } }
    const current = currentUserText(body)
    if (current.includes(NEW_MARKER)) {
      if (toolResultText(body).includes('"matched"')) return { text: AFTER_TEXT, usage: { input: 120, output: 5 } }
      return {
        tool: { id: 'memory-call', name: 'memory_search', input: { query: MEMORY_QUERY } },
        usage: { input: 120, output: 5 },
      }
    }
    if (toolResultText(body).includes(SMALL_TOOL_OUTPUT)) {
      return { text: FINAL_TEXT, usage: { input: 500000, output: 0 } }
    }
    if (current.includes(OLD_MARKER)) return { text: 'ACK-OLD', usage: { input: 900, output: 5 } }
    if (current.includes(MID_MARKER)) return { text: 'ACK-MID', usage: { input: 900, output: 5 } }
    if (current.includes(MID2_MARKER)) {
      return {
        tool: {
          id: 'bash-call',
          name: 'bash',
          input: { command: `printf '${SMALL_TOOL_OUTPUT}'`, description: 'print the retained tool output' },
        },
        usage: { input: 900, output: 5 },
      }
    }
    throw new Error(`unexpected request: ${JSON.stringify((body.messages ?? []).map(message => textOf(message).slice(0, 80)))}`)
  })
  const { port } = await bootBackend(home, double.env)
  const token = await signIn(port)
  const sessionId = await newSession(port, token)
  try {
    await send(port, token, sessionId, 'core-old', OLD_TEXT)
    await waitReply(port, token, sessionId, 'ACK-OLD')
    await send(port, token, sessionId, 'core-mid', MID_TEXT)
    await waitReply(port, token, sessionId, 'ACK-MID')
    await send(port, token, sessionId, 'core-recent', MID2_TEXT)
    await waitReply(port, token, sessionId, FINAL_MARKER)

    // The next turn starts above 500 000 measured tokens: the last assistant
    // message reports 500 000 input tokens and its own text extends the surface
    // past that anchor. The native threshold would otherwise wait for 800 000.
    await send(port, token, sessionId, 'core-new', NEW_TEXT)
    await waitReply(port, token, sessionId, AFTER_TEXT)

    const compactionRequests = double.requests.filter(request => isCompactionRequest(request.body))
    assert.equal(compactionRequests.length, 1, 'one summarization call condenses the older span')
    const shadowInput = JSON.stringify(compactionRequests[0].body)
    assert.ok(shadowInput.includes(OLD_MARKER), 'the summary input contains the oldest turn')
    assert.ok(shadowInput.includes(MID_MARKER), 'the summary input contains the mid turn')
    assert.ok(shadowInput.includes(MID2_MARKER), 'the summary input contains the last compacted turn')
    assert.equal(shadowInput.includes(NEW_MARKER), false, 'the current user message is not sent to the summarizer')

    const post = double.requests.find(request => currentUserText(request.body).includes(NEW_MARKER)
      && hasCheckpoint(request.body))
    assert.ok(post !== undefined, 'the continued request carries the compaction checkpoint')
    const wire = JSON.stringify(post.body)
    assert.ok(wire.includes(SUMMARY_MARKER), 'the model sees the native <compacted-summary> replacement')
    assert.equal(wire.includes(OLD_MARKER), false, 'the condensed oldest turn is replaced, not repeated')
    assert.equal(wire.includes(MID_MARKER), false, 'the condensed mid turn is replaced, not repeated')
    assert.ok(wire.includes(FINAL_MARKER), 'the recent assistant text stays verbatim')
    assert.ok(wire.includes(NEW_MARKER), 'the current user message stays verbatim')

    const calls = allBlocks(post.body).filter(block => block.type === 'tool_use')
    const results = allBlocks(post.body).filter(block => block.type === 'tool_result')
    assert.ok(calls.some(call => call.name === 'bash'), 'the retained tool call is still in history')
    assert.deepEqual(
      results.map(result => result.tool_use_id).sort(),
      calls.map(call => call.id).sort(),
      'every retained tool result still names its retained tool call — compaction did not split the pair',
    )

    const projection = await waitReply(port, token, sessionId, AFTER_TEXT)
    const types = projection.events.map(event => event.type)
    assert.equal(types.filter(type => type === 'compaction/start').length, 1, `one compaction started: ${JSON.stringify(types)}`)
    assert.equal(types.filter(type => type === 'compaction/summary').length, 1, 'one summary was written')
    assert.equal(types.filter(type => type === 'compaction/end').length, 1, 'the compaction bracket closed')
    assert.equal(types.filter(type => type === 'compaction/prune').length, 0, 'this conversation had no oversized tool result to prune')
    const summary = projection.events.find(event => event.type === 'compaction/summary')
    assert.ok(summary.data.shadowedSeqs.length > 3, 'the compacted range covers the older turns, not just one message')
    assert.equal(summary.data.provider, 'minimax-cn', 'the native summarizer used the routed product model')
    assert.equal(summary.data.model, 'MiniMax-M3.1-Flash')
    assert.ok(summary.data.shadowedTokenCount > 29000,
      `the selector compacted everything above the 16k-token tail; shadowed ${summary.data.shadowedTokenCount}`)

    // The summary is session history only: the long-term memory store is a
    // different module and the compaction path wrote nothing to it.
    const { DatabaseSync } = await import('node:sqlite')
    const memory = new DatabaseSync(join(home, 'dsh-home', 'memory', 'memory.sqlite'), { readOnly: true })
    try {
      assert.equal(memory.prepare('SELECT count(*) AS rows FROM memories').get().rows, 0,
        'a compaction summary never becomes a long-term memory')
    } finally {
      memory.close()
    }

    // The model itself can search for the summary marker and finds nothing;
    // the store check above is the negative invariant, this is its model-visible face.
    const memoryRequest = double.requests.find(request => toolResultText(request.body).includes('"matched"'))
    assert.ok(memoryRequest !== undefined, 'the model called memory_search after compaction')
    assert.match(toolResultText(memoryRequest.body), /"matched":\s*0/u,
      'the session can still call memory_search and the summary is not retrievable')
  } finally {
    await stopBackend(home)
  }
})

const PRUNE_HEAD = 'PRUNE-HEAD-MARKER'
const PRUNE_MIDDLE = 'PRUNE-MIDDLE-MARKER'
const PRUNE_TAIL = 'PRUNE-TAIL-MARKER'
const PRUNE_OUTPUT_COMMAND = `printf '${PRUNE_HEAD}'; head -c 5900 /dev/zero | tr '\\0' a; printf '${PRUNE_MIDDLE}'; head -c 6000 /dev/zero | tr '\\0' b; printf '${PRUNE_TAIL}'`

test('a qualifying pressure pass prunes an oversized tool result before any summarization', async () => {
  const home = freshHome()
  const double = await startDouble(body => {
    if (isCompactionRequest(body)) return { text: SUMMARY_TEXT, usage: { input: 50, output: 10 } }
    const current = currentUserText(body)
    if (current.includes('PRUNE-NEW-TURN')) return { text: 'AFTER-PRUNE-REPLY', usage: { input: 150, output: 5 } }
    if (current.includes('PRUNE-OLD-TURN')) {
      if (toolResultText(body).length > 10000) return { text: 'TURN-ONE-DONE', usage: { input: 500000, output: 0 } }
      return {
        tool: {
          id: 'bash-call',
          name: 'bash',
          input: { command: PRUNE_OUTPUT_COMMAND, description: 'produce a result larger than the pruning budget' },
        },
        usage: { input: 900, output: 5 },
      }
    }
    throw new Error(`unexpected request: ${JSON.stringify((body.messages ?? []).map(message => textOf(message).slice(0, 80)))}`)
  })
  const { port } = await bootBackend(home, double.env)
  const token = await signIn(port)
  const sessionId = await newSession(port, token)
  try {
    await send(port, token, sessionId, 'prune-old', 'PRUNE-OLD-TURN please run it')
    await waitReply(port, token, sessionId, 'TURN-ONE-DONE')

    const before = double.requests.find(request => toolResultText(request.body).length > 10000)
    assert.ok(before !== undefined, 'the first turn carried the complete tool result')
    assert.ok(toolResultText(before.body).includes(PRUNE_MIDDLE), 'below pressure the model sees the whole result')

    await send(port, token, sessionId, 'prune-new', 'PRUNE-NEW-TURN after the big result')
    const projection = await waitReply(port, token, sessionId, 'AFTER-PRUNE-REPLY')

    const after = double.requests.find(request => currentUserText(request.body).includes('PRUNE-NEW-TURN'))
    assert.ok(after !== undefined, 'the continued request reached the model')
    const trimmed = toolResultText(after.body)
    assert.ok(trimmed.includes(PRUNE_HEAD), 'the head of the oversized result is retained')
    assert.ok(trimmed.includes(PRUNE_TAIL), 'the tail of the oversized result is retained')
    assert.equal(trimmed.includes(PRUNE_MIDDLE), false, 'the middle of the oversized result is gone')
    assert.match(trimmed, /\[\.\.\. tool result middle pruned \.\.\.\]/u, 'the native pruner marker is model-visible')

    const types = projection.events.map(event => event.type)
    assert.equal(types.filter(type => type === 'compaction/prune').length, 1,
      `one prune pass landed: ${JSON.stringify(types)}`)
    assert.equal(types.filter(type => type === 'compaction/summary').length, 0,
      'pruning relieved the measured pressure, so no summarization request was needed')
    assert.equal(types.filter(type => type === 'compaction/start').length, 0,
      'the pruner runs inside the pressure check but writes its own shadow-price event, not a summary bracket')
    assert.equal(double.requests.some(request => isCompactionRequest(request.body)), false,
      'no extra model call was made to trim the result')
  } finally {
    await stopBackend(home)
  }
})

test('an image-capable route over its image budget offloads the oldest image and keeps replying', async () => {
  const home = freshHome()
  const double = await startDouble(() => ({ text: 'IMAGE-REPLY', usage: { input: 300, output: 5 } }))
  // One native route budget lowered for the case: the route's own preflight then
  // reports IMAGE_OFFLOAD_REQUIRED exactly as a provider request-size cap does.
  const overlay = join(home, 'image-budget.patch.yml')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(overlay, `${JSON.stringify([{
    id: 'llm-pi-ai',
    config: {
      providers: {
        'minimax-cn': {
          apiKeyEnv: 'MINIMAX_CN_API_KEY',
          baseURL: double.baseURL,
          models: [{
            id: 'MiniMax-M3.1-Flash',
            name: 'MiniMax M3.1 Flash',
            contextWindow: 1000000,
            input: ['text', 'image'],
            reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
            compat: { forceAdaptiveThinking: true },
          }],
          maxRequestImageBytes: 1,
        },
      },
    },
  }], undefined, 2)}\n`)

  const first = await bootBackend(home, double.env, [overlay])
  const token = await signIn(first.port)
  const sessionId = await newSession(first.port, token)
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
  try {
    const uploadId = await uploadImage(first.port, token, sessionId, image)
    await httpJson(first.port, '/chat/send', {
      token,
      body: { sessionId, requestId: 'image-turn', text: 'SEE-THE-PIXEL', uploadIds: [uploadId] },
    })
    const projection = await waitReply(first.port, token, sessionId, 'IMAGE-REPLY')

    const wire = double.requests[0]?.body
    assert.ok(wire !== undefined, 'the retried request reached the model')
    assert.equal(allBlocks(wire).some(block => block.type === 'image'), false,
      'the retried request carries no image block')
    assert.match(JSON.stringify(wire), /image omitted to fit request image limits/u,
      'the offloaded occurrence reaches the model as its native placeholder text')
    const offloads = projection.events.filter(event => event.type === 'image/offload')
    assert.equal(offloads.length, 1, `one durable offload decision: ${JSON.stringify(projection.events.map(event => event.type))}`)
    assert.equal(offloads[0].data.targets.length, 1, 'the decision names the one image occurrence')
    assert.equal(offloads[0].data.targets[0].imageIndexes.length, 1)

    // The selection is durable: a cold restart replays it, so the next request
    // still sends the placeholder instead of the image.
    await stopBackend(home)
    const second = await bootBackend(home, double.env, [overlay])
    const secondToken = await signIn(second.port)
    await httpJson(second.port, '/chat/send', {
      token: secondToken,
      body: { sessionId, requestId: 'image-turn-2', text: 'SECOND-IMAGE-TURN' },
    })
    const replayed = await waitReply(second.port, secondToken, sessionId, 'IMAGE-REPLY')
    assert.equal(replayed.events.filter(event => event.type === 'image/offload').length, 1,
      'the cold restore reuses the recorded selection instead of offloading again')
    const secondWire = double.requests.at(-1).body
    assert.equal(allBlocks(secondWire).some(block => block.type === 'image'), false,
      'the next request after a cold restore still omits the image')
    assert.match(JSON.stringify(secondWire), /image omitted to fit request image limits/u)
  } finally {
    await stopBackend(home)
  }
})

/** Upload one image through the product's resumable attachment routes. */
async function uploadImage(port, token, sessionId, bytes) {
  const { createHash } = await import('node:crypto')
  const proposed = await httpJson(port, '/attachments/propose', {
    token,
    body: {
      sessionId,
      name: 'pixel.png',
      mime: 'image/png',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  })
  const uploadId = proposed.upload.uploadId
  const chunk = await binaryRequest(port, '/attachments/chunk', bytes, {
    authorization: `Bearer ${token}`,
    'content-type': 'application/octet-stream',
    'x-upload-id': uploadId,
    'x-upload-offset': '0',
  })
  assert.equal(chunk.status, 200, `chunk upload failed: ${JSON.stringify(chunk.json)}`)
  assert.equal(chunk.json.upload.offset, bytes.length)
  await httpJson(port, '/attachments/complete', { token, body: { uploadId } })
  return uploadId
}

/** POST one raw binary body; the chunk route is the one product route that is not JSON. */
function binaryRequest(port, path, bytes, headers) {
  return new Promise((resolve, reject) => {
    const call = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { ...headers, 'content-length': String(bytes.length) },
      agent: false,
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: response.statusCode, json: JSON.parse(text) })
      })
    })
    call.on('error', reject)
    call.end(bytes)
  })
}

test('a provider context-overflow rejection condenses and retries without spending the provider retry budget', async () => {
  const home = freshHome()
  const double = await startDouble(body => {
    if (isCompactionRequest(body)) return { text: SUMMARY_TEXT, usage: { input: 40, output: 8 } }
    const current = currentUserText(body)
    if (hasCheckpoint(body)) return { text: 'AFTER-OVERFLOW-REPLY', usage: { input: 120, output: 5 } }
    if (current.includes('OVERFLOW-TRIGGER')) {
      return {
        kind: 'error',
        status: 400,
        message: 'mock input exceeds the model context window',
        type: 'invalid_request_error',
        code: 'context_length_exceeded',
      }
    }
    if (current.includes('HELLO-OVERFLOW')) return { text: 'HI-OVERFLOW', usage: { input: 90, output: 5 } }
    throw new Error(`unexpected request: ${JSON.stringify((body.messages ?? []).map(message => textOf(message).slice(0, 80)))}`)
  })
  const { port } = await bootBackend(home, double.env)
  const token = await signIn(port)
  const sessionId = await newSession(port, token)
  try {
    await send(port, token, sessionId, 'overflow-hello', 'HELLO-OVERFLOW')
    await waitReply(port, token, sessionId, 'HI-OVERFLOW')
    await send(port, token, sessionId, 'overflow-trigger', 'OVERFLOW-TRIGGER')
    const projection = await waitReply(port, token, sessionId, 'AFTER-OVERFLOW-REPLY')

    assert.equal(double.requests.length, 4,
      `one refused attempt, one summary, one retry: ${double.requests.map(request => isCompactionRequest(request.body) ? 'summary' : currentUserText(request.body).slice(0, 20)).join(', ')}`)
    const refused = double.requests[1].body
    assert.ok(currentUserText(refused).includes('OVERFLOW-TRIGGER'))
    const summaryRequest = double.requests[2].body
    assert.ok(isCompactionRequest(summaryRequest), 'the overflow recovery asked for a summary')
    assert.match(JSON.stringify(summaryRequest), /HI-OVERFLOW/u, 'the summary input contains the compacted head')
    const retry = double.requests[3].body
    assert.ok(hasCheckpoint(retry), 'the retried request is rebuilt from the checkpoint')
    assert.ok(currentUserText(retry).includes('OVERFLOW-TRIGGER'), 'the user request survives the recovery')
    assert.equal(JSON.stringify(retry).includes('HI-OVERFLOW'), false, 'the compacted head is not replayed verbatim')

    const types = projection.events.map(event => event.type)
    assert.equal(types.filter(type => type === 'compaction/start').length, 1, `one overflow compaction: ${JSON.stringify(types)}`)
    assert.equal(types.filter(type => type === 'compaction/summary').length, 1)
    assert.equal(types.filter(type => type === 'compaction/end').length, 1)
    assert.equal(types.filter(type => type.startsWith('llm/retry')).length, 0,
      'overflow recovery is a context repair, not a provider retry')
    assert.equal(projection.error, null)
  } finally {
    await stopBackend(home)
  }
})

/** Wait until a killed backend pid is gone (a killed detached group leader is reaped by init). */
async function waitForExit(pid, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`backend pid ${pid} did not exit`)
}

test('a cold restore ignores the stale compaction bracket of the previous lifecycle and compacts again', async () => {
  const home = freshHome()
  let releaseSummary
  const summaryStarted = new Promise(resolve => { releaseSummary = resolve })
  const crashed = await startDouble(body => {
    if (isCompactionRequest(body)) {
      releaseSummary()
      return 'hang'
    }
    const current = currentUserText(body)
    if (toolResultText(body).includes(SMALL_TOOL_OUTPUT)) return { text: 'TURN-ONE-DONE', usage: { input: 500000, output: 0 } }
    if (current.includes(OLD_MARKER)) return { text: 'ACK-OLD', usage: { input: 900, output: 5 } }
    if (current.includes(MID_MARKER)) return { text: 'ACK-MID', usage: { input: 900, output: 5 } }
    if (current.includes(MID2_MARKER)) {
      return {
        tool: {
          id: 'bash-call',
          name: 'bash',
          input: { command: `printf '${SMALL_TOOL_OUTPUT}'`, description: 'print the retained tool output' },
        },
        usage: { input: 900, output: 5 },
      }
    }
    throw new Error(`unexpected request: ${JSON.stringify((body.messages ?? []).map(message => textOf(message).slice(0, 80)))}`)
  })
  const firstRun = await bootBackend(home, crashed.env)
  const token = await signIn(firstRun.port)
  const sessionId = await newSession(firstRun.port, token)
  try {
    await send(firstRun.port, token, sessionId, 'cold-old', OLD_TEXT)
    await waitReply(firstRun.port, token, sessionId, 'ACK-OLD')
    await send(firstRun.port, token, sessionId, 'cold-mid', MID_TEXT)
    await waitReply(firstRun.port, token, sessionId, 'ACK-MID')
    await send(firstRun.port, token, sessionId, 'cold-recent', MID2_TEXT)
    await waitReply(firstRun.port, token, sessionId, 'TURN-ONE-DONE')

    await send(firstRun.port, token, sessionId, 'cold-trigger', NEW_TEXT)
    await summaryStarted
    const pid = JSON.parse(firstRun.run.stdout).pid
    try { process.kill(-pid, 'SIGKILL') } catch { process.kill(pid, 'SIGKILL') }
    await waitForExit(pid)

    const restarted = await startDouble(body => {
      if (isCompactionRequest(body)) return { text: SUMMARY_TEXT, usage: { input: 50, output: 10 } }
      const current = currentUserText(body)
      if (current.includes('COLD-RESTORE-TURN')) return { text: 'AFTER-COLD-RECOVERY', usage: { input: 120, output: 5 } }
      throw new Error(`unexpected request: ${JSON.stringify((body.messages ?? []).map(message => textOf(message).slice(0, 80)))}`)
    })
    const secondRun = await bootBackend(home, restarted.env)
    const secondToken = await signIn(secondRun.port)
    await httpJson(secondRun.port, '/chat/send', {
      token: secondToken,
      body: { sessionId, requestId: 'cold-restore', text: 'COLD-RESTORE-TURN' },
    })
    const projection = await waitReply(secondRun.port, secondToken, sessionId, 'AFTER-COLD-RECOVERY')

    const types = projection.events.map(event => event.type)
    const starts = projection.events.filter(event => event.type === 'compaction/start')
    assert.equal(starts.length, 2, `the killed attempt and the restored one both left a start: ${JSON.stringify(types)}`)
    const endSeed = projection.events.find(event => event.type === 'session/end-seed'
      && event.seq > starts[0].seq)
    assert.ok(endSeed !== undefined, 'the restored session seeded a new lifecycle after the stale start')
    const endsBeforeSeed = projection.events.filter(event => event.type === 'compaction/end'
      && event.seq < endSeed.seq && event.seq > starts[0].seq)
    assert.deepEqual(endsBeforeSeed, [], 'the killed attempt left no closing marker: the bracket is genuinely stale')
    const restoredStart = starts.find(event => event.seq > endSeed.seq)
    assert.ok(restoredStart !== undefined, 'the restored turn opened a new bracket')
    const restoredEnd = projection.events.find(event => event.type === 'compaction/end'
      && event.seq > restoredStart.seq)
    assert.ok(restoredEnd !== undefined, `the restored compaction closed: ${JSON.stringify(types)}`)
    assert.equal(restoredEnd.data.error, undefined, 'the restored compaction closed without an error')

    const summaryRequest = restarted.requests.find(request => isCompactionRequest(request.body))
    assert.ok(summaryRequest !== undefined, 'the restored compaction summarized through the real route')
    assert.match(JSON.stringify(summaryRequest.body), new RegExp(OLD_MARKER, 'u'),
      'the restored selector compacted the oldest turn')
    const restoredRequest = restarted.requests.find(request => currentUserText(request.body).includes('COLD-RESTORE-TURN'))
    assert.ok(restoredRequest !== undefined)
    assert.ok(hasCheckpoint(restoredRequest.body), 'the restored reply continues from the compaction checkpoint')
    assert.ok(JSON.stringify(restoredRequest.body).includes(MID_MARKER), 'the recent turn survived the cold restore')
  } finally {
    await stopBackend(home)
  }
})
