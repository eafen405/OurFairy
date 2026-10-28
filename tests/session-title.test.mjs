/**
 * Ticket #251 acceptance: session titles — the deterministic fallback, the
 * model-generated replacement, source distinction, legacy compatibility, and
 * the rule that a title never reaches the model.
 *
 * Every case drives the shipped launcher and speaks HTTP to the listener it
 * bound. The model is a loopback Messages double selected through
 * `OURFAIRY_MINIMAX_BASE_URL`; it answers title requests and chat requests
 * differently, so the two paths are observed separately. That is a model
 * double, not a claim about a real provider.
 *
 * A historical session is seeded the only way the product can produce one: the
 * title rows are disabled for one boot, a message is sent, and the backend is
 * restarted with them mounted again. The log then carries a human message and
 * a reply but no `session/title` event.
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { describeRun, dshDir, httpJson, makeHome, removeHome, repoRoot, runBackendAsync, startArgs, startedPort, writeOverlay } from './helpers/backend.mjs'

// The product module's own wire codes and snapshot mapping, read from the build
// the backend runs. The three source numbers are the interface contract the
// Android client mirrors.
const { FALLBACK_MAX_BYTES, FALLBACK_MAX_WORDS, MAX_TITLE_BYTES, TITLE_SOURCE, titleFactOf } =
  await import('../backend/sessions/dist/events.js')

const PHAETHON_PASSWORD = 'title-password'
const MODEL_TITLE = '模型生成的标题'
const MESSAGE = '请帮我修一下这个登录问题'
// 11 CJK characters = 33 UTF-8 bytes: under fallbackMaxBytes 40, one word.
const MESSAGE_FALLBACK = MESSAGE
// 30 CJK characters = 90 bytes; the 40-byte fallback keeps 13 (39 bytes).
const LONG_MESSAGE = '一'.repeat(30)
const LONG_MESSAGE_FALLBACK = '一'.repeat(13)
// 40 CJK characters = 120 bytes; the 80-byte title keeps 26 (78 bytes).
const LONG_MODEL_TITLE = '标'.repeat(40)
const TRUNCATED_MODEL_TITLE = '标'.repeat(26)
// Normalizes to the empty string, so the provider must not store it.
const EMPTY_MODEL_TITLE = '\u0000\u0001'

const home = makeHome('ourfairy-session-title-')
let double
let port
let titleGate = Promise.resolve()
let releaseTitle = () => {}
let titlePlans = []
let titleRequests = 0
let messageSerial = 0

/** The test double: one Anthropic Messages server that knows title requests. */
async function startDouble() {
  const requests = []
  const server = http.createServer(async (request, response) => {
    let data = ''
    for await (const chunk of request) data += chunk
    const body = JSON.parse(data)
    const system = typeof body.system === 'string'
      ? body.system
      : Array.isArray(body.system)
        ? body.system.map(block => typeof block?.text === 'string' ? block.text : '').join('')
        : ''
    // The native provider's system prompt and its framed user input are the two
    // markers that tell a title request from a conversation request.
    const titleRequest = system.includes('Create a concise title')
      || JSON.stringify(body.messages ?? []).includes('Generate the session title from this JSON array')
    requests.push({ body, titleRequest })
    let text = '好的'
    if (titleRequest) {
      titleRequests += 1
      // Held requests let a test observe the fallback before the model title.
      await titleGate
      const plan = titlePlans.shift() ?? { kind: 'text', text: MODEL_TITLE }
      if (plan.kind === 'empty') text = EMPTY_MODEL_TITLE
      else text = plan.text
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({
      type: 'message_start',
      message: {
        id: `double-${requests.length}`, type: 'message', role: 'assistant', model: 'MiniMax-M3.1-Flash',
        content: [], usage: { input_tokens: 1000, output_tokens: 0 },
      },
    })
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: Array.from(text).length },
    })
    emit({ type: 'message_stop' })
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
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
}

/** Hold every title request until {@link releaseTitles} is called. */
function holdTitles() {
  titleGate = new Promise(resolve => { releaseTitle = resolve })
}

/** Let held title requests answer. */
function releaseTitles() {
  releaseTitle()
  titleGate = Promise.resolve()
}

/** Boot the real backend on an ephemeral port and remember the one it bound. */
async function startBackend(overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    ...double.env,
  })
  port = startedPort(run)
}

/** Stop the running backend, asserting it left nothing behind. */
async function stopBackend() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  assert.match(run.stdout, /"leakedProcesses": \[\]|leaked processes: 0/u,
    `stopping the backend must not leave a process behind:\n${run.stdout}`)
}

/** Poll one asynchronous condition until it answers a value. */
async function until(check, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`condition not reached: ${label}`)
}

async function signIn() {
  return (await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PHAETHON_PASSWORD } })).token
}

async function register(adminToken, name) {
  const invite = await httpJson(port, '/identity/invite', { token: adminToken })
  return httpJson(port, '/identity/register', { body: { inviteCode: invite.invite.code, name, password: `${name}-password` } })
}

/** Create one session and return its id. */
async function create(token) {
  const created = await httpJson(port, '/sessions/create', { token })
  return created.session.id
}

/** Send one message and wait until its reply settles. */
async function say(token, sessionId, text) {
  const sent = await httpJson(port, '/chat/send', { token, body: { sessionId, requestId: `title-${++messageSerial}`, text } })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  return until(async () => {
    const read = await httpJson(port, '/chat/read', { token, body: { sessionId } })
    const projection = read.projection
    return projection.replyStatus === 0 && projection.messages.some(message => message.role === 2) ? projection : undefined
  }, `reply for ${sessionId}`)
}

/** One session row from the list, by id. */
async function listed(token, sessionId) {
  const list = await httpJson(port, '/sessions/list', { token })
  return list.sessions.find(session => session.id === sessionId)
}

/** Wait until one listed session satisfies the predicate. */
function waitListed(token, sessionId, predicate, label) {
  return until(async () => {
    const session = await listed(token, sessionId)
    return predicate(session) ? session : undefined
  }, label)
}

/** Every durable session-log artifact under the isolated home, hashed. */
function durableArtifacts() {
  const root = join(home, 'dsh-home', 'sessions')
  const artifacts = {}
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.jsonl(\.zstd)?$/u.test(entry.name)) {
        artifacts[relative(root, path)] = {
          sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
          mtimeNs: String(statSync(path, { bigint: true }).mtimeNs),
        }
      }
    }
  }
  walk(root)
  return artifacts
}

before(async () => {
  double = await startDouble()
  await startBackend()
})

after(async () => {
  await stopBackend()
  removeHome(home)
  await double?.close()
})

describe('OurFairy session titles over real HTTP', () => {
  test('the mounted title rows declare the product title limits', () => {
    const dshRequire = createRequire(join(dshDir, 'apps', 'cli', 'package.json'))
    const boot = dshRequire('@deepseek-ai/dsh-app-boot')
    const composed = boot.composeEntries([
      boot.loadOverlayPatches('dsh', join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml')),
    ])
    const flatten = entries => entries.flatMap(entry => Array.isArray(entry.config) ? flatten(entry.config) : [entry])
    const byId = new Map(flatten(composed).map(row => [row.id, row]))
    const service = byId.get('session-title')
    assert.ok(service, `the composition must mount the session-title row; got ${JSON.stringify([...byId.keys()])}`)
    assert.deepEqual(service.config, {
      fallbackMaxWords: FALLBACK_MAX_WORDS,
      fallbackMaxBytes: FALLBACK_MAX_BYTES,
      maxTitleBytes: MAX_TITLE_BYTES,
    }, 'the mounted limits must equal the constants the read path derives with')
    const provider = byId.get('session-title-llm')
    assert.ok(provider, 'the composition must mount the first-prompt provider row')
    assert.deepEqual(
      { provider: provider.config.provider, model: provider.config.model },
      { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' },
      'a historical session without a request/header needs the configured route',
    )
  })

  test('the first human message yields a fallback title, then the model title replaces it in list and read', async () => {
    releaseTitles()
    titlePlans = []
    const admin = await signIn()
    const agent = await register(admin, 'agent-title-first')
    const token = agent.token
    const sessionId = await create(token)

    holdTitles()
    await say(token, sessionId, MESSAGE)
    const fallback = await waitListed(token, sessionId, session => session.title !== '', 'fallback title')
    assert.equal(fallback.title, MESSAGE_FALLBACK,
      'the fallback is derived from the first human message with the configured word and byte limits')
    assert.equal(fallback.titleSource, TITLE_SOURCE.fallback,
      'a fallback title is distinguishable from a model title')

    releaseTitles()
    const titled = await waitListed(token, sessionId, session => session.titleSource === TITLE_SOURCE.provider, 'model title')
    assert.equal(titled.title, MODEL_TITLE)
    const read = await httpJson(port, '/sessions/read', { token, body: { sessionId } })
    assert.equal(read.session.title, MODEL_TITLE, 'the session title bar reads the same folded title')
    assert.equal(read.session.titleSource, TITLE_SOURCE.provider)

    // The three source codes are the interface contract; the user code is
    // mapped from a snapshot the rename ticket (#252) will write.
    assert.deepEqual(TITLE_SOURCE, { fallback: 0, provider: 1, user: 2 })
    assert.equal(titleFactOf({ title: 'x', source: { kind: 'fallback' } }).source, TITLE_SOURCE.fallback)
    assert.equal(titleFactOf({ title: 'x', source: { kind: 'provider', provider: 'p' } }).source, TITLE_SOURCE.provider)
    assert.equal(titleFactOf({ title: 'x', source: { kind: 'user' } }).source, TITLE_SOURCE.user)
  })

  test('over-long fallback and model titles are truncated at a UTF-8 boundary; an empty title is not stored', async () => {
    releaseTitles()
    titlePlans = []
    const admin = await signIn()
    const agent = await register(admin, 'agent-title-limits')
    const token = agent.token

    const long = await create(token)
    holdTitles()
    titlePlans = [{ kind: 'text', text: LONG_MODEL_TITLE }]
    await say(token, long, LONG_MESSAGE)
    const fallback = await waitListed(token, long, session => session.title !== '', 'long fallback')
    assert.equal(fallback.title, LONG_MESSAGE_FALLBACK,
      'the 40-byte fallback keeps whole UTF-8 characters only')
    assert.ok(Buffer.byteLength(fallback.title, 'utf8') <= 40)
    releaseTitles()
    const titled = await waitListed(token, long, session => session.titleSource === TITLE_SOURCE.provider, 'truncated model title')
    assert.equal(titled.title, TRUNCATED_MODEL_TITLE,
      'the 80-byte model title keeps whole UTF-8 characters only')
    assert.ok(Buffer.byteLength(titled.title, 'utf8') <= 80)
    assert.ok(!titled.title.includes('\uFFFD'), 'truncation must not split a character')

    const empty = await create(token)
    titlePlans = [{ kind: 'empty' }]
    await say(token, empty, MESSAGE)
    const emptyTitle = await listed(token, empty)
    assert.equal(emptyTitle.title, MESSAGE_FALLBACK,
      'a model title that normalizes to empty leaves the existing fallback in place')
    assert.equal(emptyTitle.titleSource, TITLE_SOURCE.fallback)
  })

  test('the title text never reaches the model-visible conversation', async () => {
    releaseTitles()
    titlePlans = []
    const admin = await signIn()
    const agent = await register(admin, 'agent-title-invisible')
    const token = agent.token
    const sessionId = await create(token)

    titlePlans = [{ kind: 'text', text: MODEL_TITLE }]
    await say(token, sessionId, MESSAGE)
    await waitListed(token, sessionId, session => session.titleSource === TITLE_SOURCE.provider, 'model title before the follow-up')
    // One more turn after the title is durable: every request now exists.
    const projection = await say(token, sessionId, '继续')
    const titlesInMessages = projection.messages
      .filter(message => (message.text ?? '').includes(MODEL_TITLE))
    assert.deepEqual(titlesInMessages, [], 'the title is not a chat message')
    const leaked = double.requests.filter(record => JSON.stringify(record.body).includes(MODEL_TITLE))
    assert.deepEqual(leaked, [], 'no model request carries the accepted title text')
  })

  test('a legacy session lists a derived name with no model call and no log write; its first open backfills once', async () => {
    releaseTitles()
    titlePlans = []
    const admin = await signIn()
    const agent = await register(admin, 'agent-title-legacy')
    const token = agent.token

    // Seed two historical sessions with the title rows absent: their logs carry
    // a human message and a reply, but no `session/title` event.
    await stopBackend()
    const noTitles = writeOverlay(home, [
      { id: 'session-title', disabled: true },
      { id: 'session-title-llm', disabled: true },
    ], 'no-title-rows.patch.yml')
    await startBackend([noTitles])
    const legacyOne = await create(token)
    await say(token, legacyOne, MESSAGE)
    const legacyTwo = await create(token)
    await say(token, legacyTwo, '第二个历史会话')
    await stopBackend()

    await startBackend()
    const beforeList = { artifacts: durableArtifacts(), titleRequests }
    const first = await listed(token, legacyOne)
    assert.equal(first.title, MESSAGE_FALLBACK,
      'a legacy session lists the fallback derived from its first human message')
    assert.equal(first.titleSource, TITLE_SOURCE.fallback)
    assert.equal((await listed(token, legacyTwo)).title, '第二个历史会话')
    assert.equal(titleRequests, beforeList.titleRequests,
      'the list path must not call the model')
    assert.deepEqual(durableArtifacts(), beforeList.artifacts,
      'the list path must not write the session log')

    // First open: the backfill appends the fallback and asks the model once.
    holdTitles()
    const opening = httpJson(port, '/chat/read', { token, body: { sessionId: legacyOne } })
    await opening
    const fallback = await waitListed(token, legacyOne, session => session.title !== '', 'legacy fallback before model')
    assert.equal(fallback.titleSource, TITLE_SOURCE.fallback)
    assert.equal(titleRequests, beforeList.titleRequests + 1, 'the first open asks the model once')
    releaseTitles()
    await waitListed(token, legacyOne, session => session.titleSource === TITLE_SOURCE.provider, 'legacy model title')

    // Second open in the same process: no second model request.
    await httpJson(port, '/chat/read', { token, body: { sessionId: legacyOne } })
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(titleRequests, beforeList.titleRequests + 1,
      'a second open of a titled session must not ask the model again')
  })

  test('a provider failure keeps the fallback, does not block the reply, and is not retried by a later process', async () => {
    releaseTitles()
    titlePlans = []
    const admin = await signIn()
    const agent = await register(admin, 'agent-title-failure')
    const token = agent.token

    // The legacy session this test uses was seeded by the previous case only if
    // it ran first; seed one here so the case stands alone.
    await stopBackend()
    const noTitles = writeOverlay(home, [
      { id: 'session-title', disabled: true },
      { id: 'session-title-llm', disabled: true },
    ], 'no-title-rows-failure.patch.yml')
    await startBackend([noTitles])
    const legacy = await create(token)
    await say(token, legacy, '失败场景的历史会话')
    await stopBackend()

    await startBackend()
    titlePlans = [{ kind: 'empty' }]
    const before = titleRequests
    // Opening and sending immediately is the race the fallback guard must survive.
    await httpJson(port, '/chat/read', { token, body: { sessionId: legacy } })
    const projection = await say(token, legacy, '打开后马上说话')
    assert.equal(projection.replyStatus, 0, 'a title failure must not block or fail the reply')
    await until(() => titleRequests > before ? true : undefined, 'the failed title attempt')
    const failed = await waitListed(token, legacy, session => session.title !== '', 'fallback after failure')
    assert.equal(failed.titleSource, TITLE_SOURCE.fallback,
      'a failed model title keeps the existing fallback')
    assert.equal(failed.title, '失败场景的历史会话')
    const list = await httpJson(port, '/sessions/list', { token })
    assert.equal(list.ok, true, 'a title failure does not make the list unavailable')

    // The durable title-request fact makes the failed attempt visible to a new
    // process: opening the session again must not spend another model request.
    await stopBackend()
    await startBackend()
    titlePlans = [{ kind: 'text', text: MODEL_TITLE }]
    await httpJson(port, '/chat/read', { token, body: { sessionId: legacy } })
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(titleRequests, before + 1, 'a failed title must not be retried after a restart')
    const afterRestart = await listed(token, legacy)
    assert.equal(afterRestart.title, '失败场景的历史会话')
    assert.equal(afterRestart.titleSource, TITLE_SOURCE.fallback)
  })

  test('a message sent while the first-open backfill is in flight still ends with a provider title', async () => {
    releaseTitles()
    titlePlans = []
    const admin = await signIn()
    const agent = await register(admin, 'agent-title-race')
    const token = agent.token

    await stopBackend()
    const noTitles = writeOverlay(home, [
      { id: 'session-title', disabled: true },
      { id: 'session-title-llm', disabled: true },
    ], 'no-title-rows-race.patch.yml')
    await startBackend([noTitles])
    const legacy = await create(token)
    await say(token, legacy, '竞态场景的历史会话')
    await stopBackend()

    await startBackend()
    releaseTitles()
    titlePlans = [{ kind: 'text', text: MODEL_TITLE }]
    holdTitles()
    // The open starts the backfill; the message lands while the title request
    // is held. The fallback it writes must not stop the model title.
    await httpJson(port, '/chat/read', { token, body: { sessionId: legacy } })
    const projection = await say(token, legacy, '打开之后立刻说一句')
    assert.equal(projection.replyStatus, 0)
    releaseTitles()
    const titled = await waitListed(token, legacy, session => session.titleSource === TITLE_SOURCE.provider,
      'the model title wins over the fallback written during the race')
    assert.equal(titled.title, MODEL_TITLE)
  })
})
