/**
 * Ticket #320: the bill reading in the model-visible request.
 *
 * Every claim this ticket makes is about what a request looks like, so every
 * assertion reads the request body the model double actually captured — not a
 * rebuilt assembly and not the system prompt alone.
 *
 * That last distinction is the trap this file exists for. `joinContextSections`
 * re-joins the *whole* snapshot on every attempt, so any context that changes
 * rewrites the snapshot the old snapshot did not touch, and a test that only
 * compared `body.system` between two requests would pass without noticing. The
 * cases below therefore compare the real message arrays.
 *
 * The double names one tool call from the user's text and, once the harness
 * hands the result back, echoes it — so a chained call needs no script, and a
 * multi-step turn can be driven with `tool_use` without a bespoke sequence.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readCombo, repoPath } from '../scripts/combo.ts'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, repoRoot, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const PASSWORD = 'bill-context-password'
const homes = []
const models = []

after(async () => {
  for (const model of models) await new Promise(resolve => model.close(resolve))
  for (const home of homes) if (process.env.KEEP_BILL_HOME !== '1') removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-bill-context-')
  homes.push(home)
  return home
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Every content block of one wire message, in order. */
function blocksOf(message) {
  return typeof message?.content === 'string' ? [{ type: 'text', text: message.content }] : (message?.content ?? [])
}

/** The model-facing text of one wire message. */
function textOf(message) {
  return blocksOf(message).filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Start one Messages double that keeps every request body.
 *
 * A user text of the form `{"tool":name,"args":{…}}` becomes a real tool call
 * on the next request; once a tool result is present the double echoes it as
 * `RESULT:…`. Anything else is acknowledged as text.
 *
 * @param options - `inputTokens` is the `message_start` usage every conversation
 *   response reports.
 * @returns the double's base URL, its captured conversation request bodies, and
 *   a close.
 */
async function startModel(options = {}) {
  const requests = []
  const server = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(Buffer.concat(chunks).toString('utf8'), response)) return
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(body)
    const blocks = body.messages.flatMap(message => blocksOf(message))
    const commandIndex = blocks.findLastIndex(block => block.type === 'text' && block.text.startsWith('{"tool":'))
    const command = commandIndex < 0 ? undefined : JSON.parse(blocks[commandIndex].text)
    const result = commandIndex < 0 ? undefined : blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')

    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'bill-double', type: 'message', role: 'assistant', model: 'test',
      content: [], usage: { input_tokens: options.inputTokens ?? 300, output_tokens: 0 } } })
    if (command !== undefined && result === undefined) {
      // A tool call: the harness runs the tool, then sends another request, so
      // one turn spans several steps and re-resolves its context each time.
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: command.callId ?? 'bill-call', name: command.tool, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(command.args ?? {}) } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
    } else {
      const text = result === undefined ? 'ACK' : `RESULT:${JSON.stringify(toolResultBlocks(result))}`
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
    }
    emit({ type: 'message_stop' })
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  models.push(server)
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => server.close(resolve => resolve()),
  }
}

/** The one `tool_result` block's text, as the harness rendered it. */
function toolResultBlocks(result) {
  const content = result.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

async function boot(home, model, env = {}) {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PASSWORD,
    MINIMAX_CN_API_KEY: 'mock-bill-key', OURFAIRY_MINIMAX_BASE_URL: model.baseURL, ...env })
  return startedPort(run)
}

async function stop(home) {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

/** One fresh session of one identity. */
async function newSession(port, token) {
  return (await httpJson(port, '/sessions/create', { token })).session.id
}

/** One projection read of one session. */
function read(port, token, sessionId) {
  return httpJson(port, '/chat/read', { token, body: { sessionId } }).then(value => value.projection)
}

/**
 * Wait for one condition over the session's projection.
 *
 * @returns the projection that satisfied it.
 */
async function until(port, token, sessionId, predicate, label) {
  const deadline = Date.now() + 40_000
  let projection
  while (Date.now() < deadline) {
    projection = await read(port, token, sessionId)
    if (predicate(projection)) return projection
    if (projection.error) assert.fail(`chat failed while waiting for ${label}: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`timed out waiting for ${label}; projection was ${JSON.stringify({
    replyStatus: projection?.replyStatus,
    error: projection?.error,
    messages: projection?.messages?.map(message => [message.role, message.status, message.text?.slice(0, 40)]),
  })}`)
}

/**
 * One settled turn: send one text and wait for the reply it produced.
 *
 * The wait condition is a *new* committed assistant message, not merely
 * `replyStatus === 0`, because a second send in the same session starts from a
 * projection that was already idle.
 */
async function turn(port, token, sessionId, requestId, text) {
  const before = (await read(port, token, sessionId)).messages.filter(message => message.role === 2 && message.status === 2).length
  await httpJson(port, '/chat/send', { token, body: { sessionId, requestId, text } })
  return until(port, token, sessionId, projection => projection.replyStatus === 0
    && projection.attempt === null
    && projection.messages.filter(message => message.role === 2 && message.status === 2).length > before, requestId)
}

/**
 * The bill reading of one captured request, or `undefined` when it carries none.
 *
 * The channel only ever appends, so a request in a long session carries every
 * snapshot it ever projected. The reading in force is the newest one — reading
 * the first would report a reading the turn had already replaced.
 */
function billLineOf(body) {
  const snapshot = snapshotOf(body)
  if (snapshot === undefined) return undefined
  return snapshot.slice(snapshot.indexOf('电费读数：'))
}

/** The one runtime-context snapshot of one captured request. */
function snapshotOf(body) {
  return (body.messages ?? []).map(textOf).filter(text => text.startsWith('Current runtime context.')).at(-1)
}

test('the bill reading closes the runtime context, after every other section', async () => {
  const home = freshHome()
  const model = await startModel({ inputTokens: 300 })
  const port = await boot(home, model)
  const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
  try {
    const sessionId = await newSession(port, admin.token)
    // Two turns, so the opening turn's own native injections are behind us and
    // this reads the steady state a conversation actually spends its time in.
    await turn(port, admin.token, sessionId, 'bill-order-1', 'hello bill')
    await turn(port, admin.token, sessionId, 'bill-order-2', 'and again')

    const body = model.requests.at(-1)
    const messages = body.messages ?? []
    const last = messages.at(-1)
    assert.equal(textOf(last).startsWith('Current runtime context.'), true,
      `on a steady-state turn the last message is the runtime-context snapshot; tail was ${JSON.stringify(messages.map(textOf).slice(-2))}`)
    const snapshot = snapshotOf(body)
    const billIndex = snapshot.indexOf('电费读数：')
    assert.ok(billIndex >= 0, `the snapshot carries the bill reading; snapshot was ${snapshot}`)
    for (const [name, marker] of [
      ['working directory', 'Current working directory:'],
      ['file policy', 'Current DSH file policy:'],
    ]) {
      const index = snapshot.indexOf(marker)
      assert.ok(index >= 0, `${name} must still contribute to the snapshot`)
      assert.ok(index < billIndex, `the bill reading must come after the ${name} section; snapshot was ${snapshot}`)
    }
    // The reading is the snapshot's final section, not merely somewhere present:
    // an order value that ties with or loses to another contributor fails here.
    const tail = snapshot.slice(billIndex)
    assert.equal(tail.includes('\n\n'), false,
      `nothing may follow the reading inside the snapshot; got ${JSON.stringify(tail)}`)
    assert.match(tail, /^电费读数：[^\n]+。$/u, `the reading is one closed line; got ${JSON.stringify(tail)}`)

    // Every earlier request agrees: the reading is always the snapshot's tail,
    // including the opening turn, where dsh's own skill catalog reminder
    // legitimately follows the snapshot as a separate message.
    for (const request of model.requests) {
      const text = snapshotOf(request)
      assert.ok(text !== undefined, 'every request carries a runtime-context snapshot')
      assert.ok(text.indexOf('电费读数：') > 0, `every snapshot carries the reading; got ${text}`)
      assert.equal(text.slice(text.indexOf('电费读数：')).includes('\n\n'), false,
        'the reading is the snapshot tail in every request')
    }
  } finally {
    await stop(home)
  }
})

test('two adjacent requests differ only by the appended bill snapshot', async () => {
  const home = freshHome()
  const model = await startModel({ inputTokens: 300 })
  const port = await boot(home, model)
  const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
  try {
    const sessionId = await newSession(port, admin.token)
    await turn(port, admin.token, sessionId, 'bill-a', 'first question')
    const first = model.requests.at(-1)
    await turn(port, admin.token, sessionId, 'bill-b', 'second question')
    const second = model.requests.at(-1)
    assert.notEqual(first, second, 'two turns produced two requests')

    const a = first.messages.map(textOf)
    const b = second.messages.map(textOf)
    // The second request is the first one plus what happened in between: the
    // assistant reply, the new user turn, and the newest runtime-context
    // snapshot. Everything before that must be byte-identical — this is the
    // claim that makes the reading safe for a reusable request prefix.
    const common = Math.min(a.length, b.length)
    let diverged = -1
    for (let index = 0; index < common; index += 1) {
      if (a[index] !== b[index]) { diverged = index; break }
    }
    assert.equal(diverged, -1,
      `no message before the newest snapshot may change; compared with ${JSON.stringify(a.slice(Math.max(0, diverged - 1), diverged + 2))}`)
    // The prefix a reusable cache would keep is exactly the earlier snapshot and
    // everything before it: the first request's messages all reappear verbatim.
    const firstSnapshotIndex = a.findLastIndex(text => text.startsWith('Current runtime context.'))
    assert.ok(firstSnapshotIndex >= 0, 'the first request carries a snapshot')
    assert.deepEqual(b.slice(0, firstSnapshotIndex + 1), a.slice(0, firstSnapshotIndex + 1),
      'every message up to and including the first snapshot is byte-identical in the next request')

    // And the tail is only the newer snapshot: nothing else repeats the bill.
    const tail = b.slice(firstSnapshotIndex + 1)
    assert.equal(tail.filter(text => text.startsWith('Current runtime context.')).length, 1, 'exactly one new snapshot')
    assert.equal(tail.filter(text => text.includes('电费读数：')).length, 1, 'the new reading appears exactly once, in that snapshot')
    assert.equal(a.filter(text => text.includes('电费读数：')).length, 1, 'the first request carried exactly one reading')
  } finally {
    await stop(home)
  }
})

test('the reading is constant across every attempt of one turn', async () => {
  const home = freshHome()
  const model = await startModel({ inputTokens: 300 })
  const port = await boot(home, model)
  const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
  try {
    const sessionId = await newSession(port, admin.token)
    // A tool call makes the turn span several steps: each step is its own
    // model request and each step re-resolves the runtime context.
    const command = JSON.stringify({ tool: 'todo_write', args: { todos: [{ content: 'bill step', status: 'pending' }] }, callId: 'bill-step-1' })
    await turn(port, admin.token, sessionId, 'bill-multi', command)

    const turnRequests = model.requests.filter(body => body.messages.some(message =>
      textOf(message).includes('bill step')))
    assert.ok(turnRequests.length >= 2,
      `the turn must have made more than one request; made ${turnRequests.length} in ${model.requests.length} total requests`)
    const readings = new Set(turnRequests.map(body => billLineOf(body)))
    assert.equal(readings.size, 1, `every attempt renders the same bill text; got ${JSON.stringify([...readings])}`)
    const [reading] = [...readings]
    assert.ok(reading !== undefined, 'the turn carries a reading')
    // The per-attempt re-resolution is real: the snapshot message itself is
    // re-appended, so more than one snapshot exists. The bill line inside them
    // must nevertheless be identical, and the reading count must not grow per
    // attempt.
    const snapshots = turnRequests.at(-1).messages.map(textOf).filter(text => text.startsWith('Current runtime context.'))
    const billSnapshots = snapshots.filter(text => text.includes('电费读数：'))
    assert.ok(billSnapshots.length <= turnRequests.length,
      `at most one snapshot may be appended per attempt; ${billSnapshots.length} bill snapshots across ${turnRequests.length} requests`)
    for (const snapshot of billSnapshots) {
      assert.ok(snapshot.includes(reading), `every appended snapshot carries the pinned reading; got ${snapshot}`)
    }
  } finally {
    await stop(home)
  }
})

test('a first turn carries a reading that says there is no previous interaction', async () => {
  const home = freshHome()
  const model = await startModel({ inputTokens: 300 })
  const port = await boot(home, model)
  const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
  try {
    const sessionId = await newSession(port, admin.token)
    await turn(port, admin.token, sessionId, 'bill-first-turn', 'what is the bill')
    const reading = billLineOf(model.requests.at(-1))
    assert.ok(reading !== undefined, 'a first turn still carries a reading')
    assert.match(reading, /上一次互动 尚无已结算的互动/,
      `the first turn states that nothing has settled yet, rather than inventing a 0; got ${reading}`)
    assert.equal(/上一次互动[^；]*0 丁尼/.test(reading), false, `a first turn never renders 0 Denny; got ${reading}`)
  } finally {
    await stop(home)
  }
})

test('a maintenance or learning child session carries no reading', async () => {
  const home = freshHome()
  const model = await startModel({ inputTokens: 300 })
  const port = await boot(home, model, {
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '5', OURFAIRY_MEMORY_MAINTENANCE_DECAY_HOURS: '3',
  })
  const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
  try {
    // The memory maintenance child is spawned by the memory row at its own
    // threshold; driving 5 turns is the cheapest way to make one run.
    const alice = await registerUser(port, admin.token, 'bill-alice', PASSWORD)
    const sessionId = await newSession(port, alice.token)
    for (let index = 0; index < 5; index += 1) {
      await turn(port, alice.token, sessionId, `bill-maint-${index}`, `maintenance note ${index}`)
    }
    const child = await waitForChild(model)
    const childText = child.messages.map(textOf).join('\n')
    assert.equal(childText.includes('电费读数：'), false,
      `a maintenance child carries no bill reading; it carried ${JSON.stringify(billLineOf(child))}`)
    // The parent session still has one, so this is scoping rather than an
    // unimplemented reading.
    const parent = model.requests.find(body => JSON.stringify(body).includes('maintenance note 0')
      && JSON.stringify(body).includes('电费读数：'))
    assert.ok(parent !== undefined, 'the user session does carry a reading')
    assert.equal(JSON.stringify(child).includes(BILL_TOOL), false,
      'the maintenance child is not offered the bill tool either')
  } finally {
    await stop(home)
  }
})

/** The bill tool's registered name, kept in one place for both tool cases. */
const BILL_TOOL = 'electricity_bill'

/** Wait for the memory-maintenance child's request, recognized by its own tool set. */
async function waitForChild(model) {
  const memoryTools = ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch']
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const child = model.requests.find(body => {
      const names = Array.isArray(body.tools) ? body.tools.map(tool => tool.name) : []
      return names.length === memoryTools.length && memoryTools.every(name => names.includes(name))
    })
    if (child !== undefined) return child
    await delay(25)
  }
  assert.fail('the memory maintenance child never made a request')
}

test('the bill tool answers the monthly and historical question with the bill page\'s own snapshot', async () => {
  const home = freshHome()
  const model = await startModel({ inputTokens: 300 })
  const port = await boot(home, model)
  const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })
  try {
    const sessionId = await newSession(port, admin.token)
    await turn(port, admin.token, sessionId, 'bill-tool-1', 'warm the bill')
    const command = JSON.stringify({ tool: BILL_TOOL, args: {}, callId: 'bill-read-1' })
    await turn(port, admin.token, sessionId, 'bill-tool-2', command)

    // The harness's own `tool_result` block, as the model receives it — not the
    // double's echo of it, which would only prove the double works.
    const body = model.requests.at(-1)
    const result = body.messages.flatMap(blocksOf).findLast(block => block.type === 'tool_result')
    assert.ok(result !== undefined, `the ${BILL_TOOL} call produced a tool result; request tail was ${JSON.stringify(body.messages.slice(-3))}`)
    assert.notEqual(result.is_error, true, `the tool must succeed; got ${JSON.stringify(result)}`)
    const value = JSON.parse(toolResultBlocks(result).map(block => block.text ?? '').join(''))
    assert.deepEqual(Object.keys(value).sort(), [
      'allTime', 'contextReadingGranularityDenny', 'days', 'month', 'today',
    ], `the tool answers the three totals and the series; got ${JSON.stringify(Object.keys(value))}`)
    for (const key of ['today', 'month', 'allTime']) {
      // The tool quotes the one conversion the bill page uses, so its value is
      // rounded to a tenth of a Denny — not to the whole Dennies the throttled
      // context line speaks in.
      assert.equal(typeof value[key].denny, 'number', `${key} carries a Denny figure`)
      assert.equal(value[key].denny, Math.round(value[key].denny * 10) / 10,
        `${key}'s Denny is rounded to a tenth, the page's precision; got ${value[key].denny}`)
      assert.deepEqual(Object.keys(value[key].tokens).sort(),
        ['cacheReadTokens', 'cacheWriteTokens', 'inputTokens', 'outputTokens'], `${key} carries the raw buckets`)
    }
    assert.equal(value.days.length, 30, 'the series is the trailing 30 local days')
    // The warmed conversation really did spend tokens, so the tool reports a
    // measurement rather than a default.
    assert.ok(value.allTime.tokens.inputTokens > 0,
      `the warmed bill has spend; got ${JSON.stringify(value.allTime)}`)
    assert.ok(value.month.tokens.outputTokens > 0, 'the month total includes the conversation just run')

    // The reading and the tool cannot disagree: the tool is the exact number,
    // the reading is that number in the day bucket it states.
    const reading = billLineOf(body)
    const daySteps = Math.round(value.today.denny / value.contextReadingGranularityDenny)
    assert.ok(reading.includes(daySteps === 0 ? '不足 1 万丁尼' : `本日累计约 ${daySteps} 万丁尼`),
      `the reading must be this snapshot's own bucket; reading=${reading} today=${JSON.stringify(value.today)}`)
    // The tool reads the same fold the context reading does, so it prices only
    // *completed* turns: the turn this tool call belongs to is still open, and
    // its settled step-1 attempt is deliberately not billed yet. Turn 1 is, at
    // the double's 300 input / 5 output per request.
    assert.deepEqual(value.allTime.tokens,
      { inputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 },
      `all time counts the one completed turn and not the open one; got ${JSON.stringify(value.allTime)}`)
  } finally {
    await stop(home)
  }
})

test('the reading stays last even if the harness allocates a later context', async () => {
  // `BILL_CONTEXT_ORDER` is a literal above the harness's whole allocated range,
  // which is what makes the reading last by construction. That reasoning breaks
  // silently if a future dsh version allocates above it, so the assumption is
  // asserted against the harness the deployment actually runs, not against the
  // number this repository happened to read once.
  const { BILL_CONTEXT_ORDER } = await import('../backend/bill/dist/context.js')
  const dsh = repoPath(readCombo(repoRoot).combo, 'dsh', repoRoot)
  const source = readFileSync(join(dsh, 'packages', 'core', 'system-prompt', 'src', 'index.ts'), 'utf8')
  const block = /const CONTEXT_ORDERS = \{([\s\S]*?)\} as const/u.exec(source)
  assert.ok(block !== null, 'the harness must still declare its context order allocation')
  const allocated = [...(block[1] ?? '').matchAll(/:\s*(-?\d+)/gu)].map(match => Number(match[1]))
  assert.ok(allocated.length > 0, `the allocation must carry numbers; got ${JSON.stringify(block[1])}`)
  assert.ok(BILL_CONTEXT_ORDER > Math.max(...allocated),
    `the bill reading's order ${BILL_CONTEXT_ORDER} must exceed every order the harness allocates `
    + `(max ${Math.max(...allocated)}); a later allocation would otherwise overtake the reading`)
})
