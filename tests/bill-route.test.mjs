/**
 * Ticket #319: the bill's one reading address, over the real backend.
 *
 * The panel (#322) and the Fairy's own context reading (#320) both have to show
 * the same numbers, so the address is one read of the one aggregate — today,
 * this month, all time and the trailing 30 days from a single observation. The
 * assertions here are about what a caller sees: the JSON shape, the buckets the
 * provider reported, the fact that zero days are present at zero, that the
 * admission is a live credential and nothing more, and that a failure is
 * reported as a failure instead of as a zero bill.
 *
 * The expected totals are derived from the wire, not from the code under test: a
 * bespoke Messages double answers every conversation attempt with a fixed
 * provider usage (2000 input, 500 cache-read, 300 cache-write, 200 output =
 * 3000 tokens = exactly one Denny), so the bill after `n` settled attempts must
 * be `n` times that, by hand. Title requests are answered by the shared helper
 * and never counted: auxiliary calls carry no turn and therefore no bill.
 *
 * @covers backend/bill — the row's one address and the Denny presentation it
 * carries.
 * @covers backend/http — the shared sentinel fence and error envelope the
 * refusal cases drive.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chmodSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-bill-route-')
const password = 'bill-route-password'
const started = { port: undefined }

/**
 * What the double reports for every conversation attempt.
 *
 * One attempt is exactly 3000 tokens, which the spec's narrative rate (18亿
 * token ≈ 600000 Denny) renders as exactly one Denny — so a hand-computed
 * expectation can check both units without redoing the conversion in code.
 */
const USAGE = { input: 2000, cacheRead: 500, cacheWrite: 300, output: 200 }
const TOKENS_PER_ATTEMPT = USAGE.input + USAGE.cacheRead + USAGE.cacheWrite + USAGE.output

/** Conversation attempts the double actually answered, in arrival order. */
let answered = 0

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One request against the running backend, keeping the raw response. */
function request(path, options = {}) {
  return httpJson(started.port, path, { ...options, expect: false })
}

/** Sign one identity in and return its session credential. */
async function signIn(name, credential = password) {
  const response = await request('/identity/sign-in', { body: { name, password: credential } })
  assert.equal(response.status, 200, `sign-in for ${name} failed: ${response.text}`)
  return response.json
}

/** One fresh session of one identity. */
async function newSession(identity) {
  const response = await request('/sessions/create', { token: identity.token, body: {} })
  assert.equal(response.status, 200, `session creation failed: ${response.text}`)
  return response.json.session.id
}

/**
 * Send one message and wait until its own reply is published.
 *
 * The reply text is unique per attempt, so a previous turn's marker cannot
 * satisfy this wait: a stale match would let the test read the bill while the
 * turn it just started was still open, and an open turn is deliberately not
 * billed yet.
 */
async function send(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', { token: identity.token, body: { sessionId } }))
    .json.projection.messages.map(message => message.messageId))
  const sent = await request('/chat/send', {
    token: identity.token,
    body: { sessionId, requestId: `bill-route-${text}`, text },
  })
  assert.equal(sent.status, 200, `send failed: ${sent.text}`)
  const until = Date.now() + 20_000
  while (Date.now() < until) {
    const { projection } = (await request('/chat/read', { token: identity.token, body: { sessionId } })).json
    const fresh = projection.messages.find(message => message.messageId !== undefined
      && !seen.has(message.messageId) && typeof message.text === 'string'
      && message.text.startsWith('REPLY:'))
    if (fresh) return
    if (projection.error) assert.fail(`chat failed before the reply: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`the reply to ${text} never arrived in ${sessionId}`)
}

/** The bucket struct the bill must report for one settled attempt count. */
const expectedBuckets = attempts => ({
  inputTokens: USAGE.input * attempts,
  cacheReadTokens: USAGE.cacheRead * attempts,
  cacheWriteTokens: USAGE.cacheWrite * attempts,
  outputTokens: USAGE.output * attempts,
})

const ZERO = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

/** The local civil date in the deployment's zone, from the platform's tzdata. */
function shanghaiDay(time = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(time))
}

/** One bill read that must be admitted. */
async function billOf(token) {
  const response = await request('/bill', { token, method: 'GET' })
  assert.equal(response.status, 200, `the bill must be readable: ${response.text}`)
  assert.equal(response.json.ok, true, response.text)
  return response.json.bill
}

/**
 * Read the bill until it says what the wire says, then return it.
 *
 * A turn is billed when it closes, so the read right after a reply may still
 * observe the previous observation; the convergence is the claim, and a bill
 * that never reports the provider's numbers fails here with the last answer.
 */
async function billWhen(token, accept, label) {
  const until = Date.now() + 20_000
  let bill
  while (Date.now() < until) {
    bill = await billOf(token)
    if (accept(bill)) return bill
    await delay(25)
  }
  assert.fail(`${label}: the bill never reported it; last answer was ${JSON.stringify(bill)}`)
}

/** Start the shipped launcher against the double; the port is the test's. */
async function start(modelPort) {
  const run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-bill-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}`,
  })
  started.port = startedPort(run)
}

/** Stop the shipped launcher and hold it to the launcher's own leak check. */
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

let model

before(async () => {
  model = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    // The deployment route also answers session-title requests; an auxiliary
    // call has no turn and therefore no bill, so it is answered elsewhere and
    // never counted as an attempt.
    if (answerIfTitle(raw, res)) return
    answered += 1
    const reply = `REPLY:${answered}`
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    emit({
      type: 'message_start',
      message: {
        id: `bill-message-${answered}`,
        type: 'message',
        role: 'assistant',
        model: 'bill-double',
        content: [],
        usage: {
          input_tokens: USAGE.input,
          output_tokens: 0,
          cache_read_input_tokens: USAGE.cacheRead,
          cache_creation_input_tokens: USAGE.cacheWrite,
        },
      },
    })
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: USAGE.output } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  await start(model.address().port)
})

after(async () => {
  await stop()
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

describe('OurFairy bill over real HTTP', () => {
  test('an untouched deployment bills zero and a full series instead of failing', async () => {
    const admin = await signIn('phaethon')
    // Read once, with no polling: an empty deployment must answer immediately.
    const bill = await billOf(admin.token)

    assert.deepEqual(Object.keys(bill).sort(), ['allTime', 'days', 'month', 'today'],
      'one observation carries the three totals and the series')
    for (const total of ['today', 'month', 'allTime']) {
      assert.deepEqual(Object.keys(bill[total]).sort(), ['denny', 'tokens'],
        `${total} must carry both units the spec asks for`)
      assert.deepEqual(Object.keys(bill[total].tokens).sort(),
        ['cacheReadTokens', 'cacheWriteTokens', 'inputTokens', 'outputTokens'],
        `${total}.tokens keeps the provider's four disjoint buckets`)
      assert.deepEqual(bill[total].tokens, ZERO, `${total} of an untouched deployment is zero`)
      assert.equal(bill[total].denny, 0, `${total} of an untouched deployment is zero Denny`)
    }

    assert.equal(bill.days.length, 30, 'the series is exactly 30 entries')
    assert.equal(bill.days.at(-1).day, shanghaiDay(), 'the series ends today in Asia/Shanghai')
    assert.equal(new Set(bill.days.map(entry => entry.day)).size, 30, 'the series is 30 distinct days')
    // A zero day is present at zero, never missing: a gap would read as lost data.
    for (const entry of bill.days) {
      assert.deepEqual(Object.keys(entry).sort(), ['day', 'denny', 'tokens'], 'each day carries both units too')
      assert.deepEqual(entry.tokens, ZERO, `${entry.day} is present at zero`)
      assert.equal(entry.denny, 0, `${entry.day} is zero Denny`)
    }
  })

  test('an ordinary agent may read the bill, and sees the whole deployment in it', async () => {
    const admin = await signIn('phaethon')
    const agent = await registerUser(started.port, admin.token, 'bill-route-agent', password)
    assert.equal(agent.user.isAdmin, false, 'the reader below must be an ordinary agent')

    // The agent's own session is part of the Fairy's bill, like the admin's: the
    // sum is public and no session or identity is subtracted from it.
    const sessionId = await newSession(agent)
    const before = answered
    await send(agent, sessionId, 'agent message')

    const bill = await billWhen(agent.token, observed => observed.allTime.tokens.inputTokens === USAGE.input * (before + 1),
      'the agent\'s own attempt reaches the public total')

    assert.deepEqual(bill.today.tokens, expectedBuckets(before + 1))
    assert.deepEqual(bill.month.tokens, bill.today.tokens, 'this month contains today')
    assert.deepEqual(bill.allTime.tokens, bill.today.tokens, 'all time contains today')

    // The administrator reads the same public total; the credential names the
    // reader, never the rows counted.
    const adminView = await billWhen(admin.token, observed => observed.allTime.tokens.inputTokens === bill.allTime.tokens.inputTokens,
      'the administrator reads the same total')
    assert.deepEqual(adminView, bill, 'the bill is one public total, not a per-reader view')
  })

  test('each settled attempt is billed once, in the provider\'s own buckets and Dennies', async () => {
    const admin = await signIn('phaethon')
    const sessionId = await newSession(admin)
    await send(admin, sessionId, 'second attempt')
    const attempts = answered
    assert.ok(attempts >= 2, `the double must have answered more than one attempt; answered ${attempts}`)

    const bill = await billWhen(admin.token, observed => observed.allTime.tokens.inputTokens === USAGE.input * attempts,
      'every attempt is counted')

    assert.deepEqual(bill.allTime.tokens, expectedBuckets(attempts), 'the buckets are the provider\'s, summed')
    assert.equal(bill.allTime.denny, attempts, `one attempt is exactly ${TOKENS_PER_ATTEMPT} tokens, so ${attempts} Denny`)

    assert.deepEqual(bill.days.at(-1).tokens, bill.allTime.tokens, 'today carries the same buckets')
    assert.equal(bill.days.at(-1).denny, bill.allTime.denny)
    for (const entry of bill.days.slice(0, -1)) {
      assert.deepEqual(entry.tokens, ZERO, `${entry.day} had no spend and is present at zero`)
    }
  })

  test('an anonymous caller is refused and is handed no part of the bill', async () => {
    const refused = await request('/bill', { method: 'GET' })
    assert.equal(refused.status, 401, `an anonymous read must be refused: ${refused.text}`)
    assert.equal(refused.json.error.code, 'bill/unauthorized')
    assert.equal(refused.json.bill, undefined, 'a refusal must not carry numbers')

    const forged = await request('/bill', { method: 'GET', token: 'not-a-real-session-token' })
    assert.equal(forged.status, 401, `a forged credential must be refused: ${forged.text}`)
    assert.equal(forged.json.error.code, 'bill/unauthorized')
    assert.equal(forged.json.bill, undefined)
  })

  test('an untrusted Host is fenced off before the credential is read', async () => {
    const admin = await signIn('phaethon')
    // A valid credential on an untrusted authority still earns the fence's 403,
    // which is only reachable when the fence runs before authentication.
    const refused = await request('/bill', { method: 'GET', token: admin.token, host: 'attacker.invalid' })
    assert.equal(refused.status, 403, `an untrusted Host must be fenced: ${refused.text}`)
    assert.equal(refused.json.error.code, 'bill/forbidden-authority')
    assert.equal(refused.json.bill, undefined)
  })

  test('a failed aggregation is reported with the module prefix, never as a zero bill', async () => {
    const admin = await signIn('phaethon')
    const before = await billWhen(admin.token, bill => bill.allTime.tokens.inputTokens > 0, 'a bill worth protecting')
    const logs = readdirSync(join(home, 'dsh-home', 'sessions'), { recursive: true })
      .filter(name => /\.jsonl(\.zstd)?$/u.test(String(name)))
    assert.ok(logs.length > 0, 'the deployment must have a durable log for this case to break')
    // Restart, so the session is read from storage rather than from the live
    // snapshot the aggregate answers a running session with.
    await stop()
    await start(model.address().port)
    const restored = await billOf(admin.token)
    assert.deepEqual(restored.allTime.tokens, before.allTime.tokens,
      'a cold read of the same logs must report the same bill')

    // A log the process may not read is a real aggregation failure: the durable
    // listing validates every artifact, so the read cannot be answered at all.
    const paths = logs.map(name => join(home, 'dsh-home', 'sessions', String(name)))
    for (const path of paths) chmodSync(path, 0o000)
    try {
      const failed = await request('/bill', { method: 'GET', token: admin.token })
      assert.equal(failed.status, 500, `an unreadable corpus must fail loudly: ${failed.text}`)
      assert.equal(failed.json.error.code, 'bill/internal', failed.text)
      assert.equal(failed.json.bill, undefined,
        'a failure must not answer a zero bill: zero spend and "cannot compute" are different answers')

      // The refusal is the failure being reported, not a broken address: the
      // same backend answers the same credential once the corpus is readable.
      for (const path of paths) chmodSync(path, 0o600)
      const recovered = await billOf(admin.token)
      assert.deepEqual(recovered.allTime.tokens, before.allTime.tokens, 'the recovered bill is unchanged')
    } finally {
      for (const path of paths) chmodSync(path, 0o600)
    }

    // Admission still runs before the aggregation: an anonymous caller is
    // refused for the missing credential, not for the unreadable corpus.
    for (const path of paths) chmodSync(path, 0o000)
    try {
      const anonymous = await request('/bill', { method: 'GET' })
      assert.equal(anonymous.status, 401, `the credential gate runs first: ${anonymous.text}`)
      assert.equal(anonymous.json.error.code, 'bill/unauthorized')
    } finally {
      for (const path of paths) chmodSync(path, 0o600)
    }
  })
})
