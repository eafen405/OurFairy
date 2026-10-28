/**
 * Ticket #252 acceptance: a user renames a session, the title is pinned, the
 * list and the per-session read answer with it, and a rename never pays for the
 * historical title backfill.
 *
 * Every case drives the shipped launcher and speaks HTTP to the listener it
 * bound; the model is dsh's loopback Messages double behind the title-aware
 * proxy (`tests/helpers/title-aware.mjs`), so a title request is answered by the
 * proxy and never enters the conversation scripts. That is a model double, not
 * a claim about a real provider: what it proves is that the product path holds
 * the title service's own rules, not that a model names titles well.
 *
 * A historical session is seeded the only way the product can produce one: the
 * title rows are disabled for one boot, a message is sent, and the backend is
 * restarted with them mounted again. Its log then carries a human message and a
 * reply but no `session/title` event, which is exactly the state in which the
 * first open schedules the model backfill — the request a rename must not spend.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import {
  describeRun, dshDir, httpJson, makeHome, removeHome, runBackendAsync, startArgs, startedPort, writeOverlay,
} from './helpers/backend.mjs'
import { startTitleAwareModel } from './helpers/title-aware.mjs'

// The product module's own wire codes and the one session address chat serves,
// read from the build the backend runs.
const { MAX_TITLE_BYTES, TITLE_SOURCE } = await import('../backend/sessions/dist/events.js')
const { SESSION_RENAME_PATH } = await import('../backend/sessions/dist/http.js')

const PHAETHON_PASSWORD = 'rename-password'
const MESSAGE = '请帮我修一下这个登录问题'
// 40 CJK characters = 120 UTF-8 bytes; the 80-byte cap keeps 26 (78 bytes).
const LONG_TITLE = '标'.repeat(40)
const TRUNCATED_LONG_TITLE = '标'.repeat(26)
// 79 ASCII bytes + a 4-byte emoji: the cap lands inside the emoji, so a
// code-point-safe truncation keeps the 79 bytes and never splits the emoji.
const EMOJI_TITLE = `${'x'.repeat(79)}😀😀`
const TRUNCATED_EMOJI_TITLE = 'x'.repeat(79)
// Normalizes away: whitespace is collapsed and the control characters removed,
// which leaves nothing to accept.
const INVISIBLE_TITLE = ' \u0000\u200B\t  '

const home = makeHome('ourfairy-session-rename-')
let model
let port
let messageSerial = 0

/** Boot the real backend on an ephemeral port and remember the one it bound. */
async function startBackend(overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    MINIMAX_CN_API_KEY: 'mock-key',
    OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}`,
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

/** One HTTP request against the running backend, raw response kept. */
function request(path, options = {}) {
  return httpJson(port, path, { ...options, expect: false })
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

async function signIn(name = 'phaethon', password = PHAETHON_PASSWORD) {
  const response = await request('/identity/sign-in', { body: { name, password } })
  assert.equal(response.status, 200, `sign-in for ${name} failed: ${response.text}`)
  return response.json.token
}

async function register(adminToken, name) {
  const invite = await request('/identity/invite', { token: adminToken })
  assert.equal(invite.status, 200, `invite creation failed: ${invite.text}`)
  const registered = await request('/identity/register', {
    body: { inviteCode: invite.json.invite.code, name, password: `${name}-password` },
  })
  assert.equal(registered.status, 200, `registering ${name} failed: ${registered.text}`)
  return registered.json
}

/** Create one session and return its id. */
async function create(token) {
  const created = await request('/sessions/create', { token })
  assert.equal(created.status, 200, `creating a session failed: ${created.text}`)
  return created.json.session.id
}

/** Send one message and wait until its reply settles. */
async function say(token, sessionId, text = MESSAGE) {
  const sent = await request('/chat/send', { token, body: { sessionId, requestId: `rename-${++messageSerial}`, text } })
  assert.equal(sent.status, 200, `sending a message failed: ${sent.text}`)
  return until(async () => {
    const read = await request('/chat/read', { token, body: { sessionId } })
    const projection = read.json?.projection
    return projection?.replyStatus === 0 && projection.messages.some(message => message.role === 2)
      ? projection : undefined
  }, `reply for ${sessionId}`)
}

/** The rename route's answer, raw. */
function rename(token, sessionId, title) {
  return request(SESSION_RENAME_PATH, { token, body: { sessionId, title } })
}

/** One session row from the list, by id. */
async function listed(token, sessionId) {
  const list = await request('/sessions/list', { token })
  assert.equal(list.status, 200, `listing failed: ${list.text}`)
  return list.json.sessions.find(session => session.id === sessionId)
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
  model = await startTitleAwareModel({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'OK' })
  await startBackend()
})

after(async () => {
  await stopBackend()
  removeHome(home)
  await model?.close()
})

describe('OurFairy session rename over real HTTP', () => {
  test('a user rename pins the title, the list and the read agree, and a restart keeps it', async () => {
    const admin = await signIn()
    const agent = await register(admin, 'agent-rename-pin')
    const token = agent.token
    const sessionId = await create(token)

    // The session carries an automatic title first, so the rename is provably a
    // replacement of one source by another rather than the first title it had.
    await say(token, sessionId, MESSAGE)
    const automatic = await waitListed(token, sessionId, session => session.titleSource === TITLE_SOURCE.provider,
      'the automatic title before the rename')
    assert.notEqual(automatic.title, '', 'the session must have an automatic title to replace')

    const renamed = await rename(token, sessionId, '  我的   会话  ')
    assert.equal(renamed.status, 200, `a rename of an owned session must succeed: ${renamed.text}`)
    assert.equal(renamed.json.ok, true)
    // The service's own normalization: runs of whitespace collapse to one space
    // and the result is trimmed. The answer already carries it.
    assert.equal(renamed.json.session.title, '我的 会话', 'the answer carries the normalized title')
    assert.equal(renamed.json.session.titleSource, TITLE_SOURCE.user, 'a rename records the user source')
    assert.equal(renamed.json.session.id, sessionId)

    // The list is the other reader of the same title; the two must not disagree.
    assert.deepEqual(await listed(token, sessionId), renamed.json.session,
      'the list must return exactly the row the rename answered with')
    const read = await request('/sessions/read', { token, body: { sessionId } })
    assert.equal(read.status, 200, read.text)
    assert.deepEqual(read.json.session, renamed.json.session, 'the session read must agree with the list')

    await stopBackend()
    await startBackend()
    const restarted = await listed(token, sessionId)
    assert.equal(restarted.title, '我的 会话', 'a restart must keep the title the user wrote')
    assert.equal(restarted.titleSource, TITLE_SOURCE.user)

    // An automatic title may not overwrite a pinned one: a new human message in
    // the session schedules no generation, and the historical backfill (which
    // the restart makes eligible again) skips a user source too.
    const titleRequestsBefore = model.titleRequests.length
    await request('/chat/read', { token, body: { sessionId } })
    await say(token, sessionId, '继续')
    await waitListed(token, sessionId, session => session.title === '我的 会话', 'the pinned title after new input')
    assert.equal(model.titleRequests.length, titleRequestsBefore,
      'a pinned title must not spend another model title request')
  })

  test('a session the caller never opened is renamed without paying for the title backfill', async () => {
    const admin = await signIn()
    const agent = await register(admin, 'agent-rename-legacy')
    const token = agent.token

    // Seed one historical session: written while the title rows are absent, so
    // its log has a human message and a reply but no title event. Reopening it
    // with the rows mounted would schedule exactly one model title request.
    await stopBackend()
    const noTitles = writeOverlay(home, [
      { id: 'session-title', disabled: true },
      { id: 'session-title-llm', disabled: true },
    ], 'no-title-rows.patch.yml')
    await startBackend([noTitles])
    const legacy = await create(token)
    await say(token, legacy, '历史会话的第一句')
    await stopBackend()

    await startBackend()
    const historical = await listed(token, legacy)
    assert.equal(historical.title, '历史会话的第一句', 'the historical session lists its derived fallback')
    assert.equal(historical.titleSource, TITLE_SOURCE.fallback,
      'a log without a title event has no title event to read')

    // Rename without any read or open of the session: the drawer row is enough.
    const titleRequestsBefore = model.titleRequests.length
    const renamed = await rename(token, legacy, '用户命名的历史会话')
    assert.equal(renamed.status, 200, renamed.text)
    assert.equal(renamed.json.session.title, '用户命名的历史会话')
    assert.equal(renamed.json.session.titleSource, TITLE_SOURCE.user)
    assert.equal(model.titleRequests.length, titleRequestsBefore,
      'a rename must not spend the historical title backfill on the same open')

    // Opening it afterwards still spends nothing: the user title is not a
    // fallback, so the backfill has nothing to retry.
    await request('/chat/read', { token, body: { sessionId: legacy } })
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(model.titleRequests.length, titleRequestsBefore,
      'a later open of a user-named session must not regenerate its title')
    assert.equal((await listed(token, legacy)).title, '用户命名的历史会话')
  })

  test('a title with no visible characters is refused under its own code and writes nothing', async () => {
    const admin = await signIn()
    const agent = await register(admin, 'agent-rename-empty')
    const token = agent.token
    const sessionId = await create(token)
    await say(token, sessionId)
    await waitListed(token, sessionId, session => session.title !== '', 'an automatic title to keep')

    const before = { artifacts: durableArtifacts(), session: await listed(token, sessionId) }
    const refused = await rename(token, sessionId, INVISIBLE_TITLE)
    assert.equal(refused.status, 400, `a title with no visible text must be refused: ${refused.text}`)
    assert.equal(refused.json.error.code, 'sessions/empty-title',
      'the refusal is distinguishable from every other failure of the same route')
    assert.equal(refused.json.session, undefined, 'a refused rename must not answer with a session')

    assert.deepEqual(await listed(token, sessionId), before.session,
      'a refused rename must leave the title as it was')
    assert.deepEqual(durableArtifacts(), before.artifacts,
      'a refused rename must not append anything to the session log')

    const malformed = await rename(token, sessionId, 42)
    assert.equal(malformed.status, 400, malformed.text)
    assert.equal(malformed.json.error.code, 'sessions/invalid-request',
      'a title that is not text is a malformed request, not an empty title')
  })

  test('an over-long title is truncated on a UTF-8 boundary instead of cutting a code point', async () => {
    const admin = await signIn()
    const agent = await register(admin, 'agent-rename-limits')
    const token = agent.token
    const sessionId = await create(token)
    await say(token, sessionId)

    const long = await rename(token, sessionId, LONG_TITLE)
    assert.equal(long.status, 200, long.text)
    assert.equal(long.json.session.title, TRUNCATED_LONG_TITLE,
      `the title keeps ${MAX_TITLE_BYTES} UTF-8 bytes of whole characters`)
    assert.ok(Buffer.byteLength(long.json.session.title, 'utf8') <= MAX_TITLE_BYTES)
    assert.equal((await listed(token, sessionId)).title, TRUNCATED_LONG_TITLE,
      'the list returns the same truncated title the rename answered with')

    const emoji = await rename(token, sessionId, EMOJI_TITLE)
    assert.equal(emoji.status, 200, emoji.text)
    assert.equal(emoji.json.session.title, TRUNCATED_EMOJI_TITLE,
      'a four-byte character that would cross the cap is dropped whole, not split')
    assert.ok(!emoji.json.session.title.includes('\uFFFD'), 'truncation must not leave a replacement character')
    assert.equal(Buffer.byteLength(emoji.json.session.title, 'utf8'), 79)
  })

  test('unknown, ownerless and other owners\' sessions are refused and write nothing', async () => {
    const admin = await signIn()
    const owner = await register(admin, 'agent-rename-owner')
    const caller = await register(admin, 'agent-rename-caller')
    const owned = await create(owner.token)
    await say(owner.token, owned)
    const named = await rename(owner.token, owned, '主人的标题')
    assert.equal(named.status, 200, named.text)

    // A cold fixture row seeds the two sessions no product route can create: one
    // owned by somebody else and one carrying no ownership record at all.
    const ownerlessId = `ourfairy-user-${caller.user.shortId}-primary`
    const foreignId = 'rename-foreign-session'
    const fixturePlugin = fileURLToPath(new URL('../backend/sessions/test-support/persist-fixtures.ts', import.meta.url))
    await stopBackend()
    const overlay = writeOverlay(home, [{ insert: [{
      id: 'cold-session-fixtures', name: fixturePlugin,
      config: { fixtures: [{ id: ownerlessId }, { id: foreignId, owner: `user:${owner.user.shortId}` }] },
    }] }], 'rename-cold-fixtures.patch.yml')
    await startBackend([overlay])
    await stopBackend()
    await startBackend() // the fixture row is gone; both ids stay cold logs.

    const before = durableArtifacts()
    for (const [sessionId, status, code] of [
      [foreignId, 404, 'sessions/unknown-session'],
      [ownerlessId, 403, 'sessions/unowned-session'],
      ['not-a-session', 404, 'sessions/unknown-session'],
    ]) {
      const refused = await rename(caller.token, sessionId, '偷来的标题')
      assert.equal(refused.status, status, `${sessionId}: ${refused.text}`)
      assert.equal(refused.json.error.code, code, `${sessionId}: the refusal keeps the session routes' own code`)
      assert.equal(refused.json.session, undefined)
      // The same route family must agree about that session, refusal for refusal.
      const read = await request('/sessions/read', { token: caller.token, body: { sessionId } })
      assert.equal(read.status, status, `reading ${sessionId} must answer as renaming it does`)
      assert.equal(read.json.error.code, code)
    }

    // The owner's own title is untouched by the caller's attempts.
    assert.equal((await listed(owner.token, owned)).title, '主人的标题')
    assert.deepEqual(durableArtifacts(), before, 'a refused rename must not write any durable artifact')

    // No credential names no caller, and the route says so instead of picking one.
    const anonymous = await rename('', owned, '匿名标题')
    assert.equal(anonymous.status, 401, anonymous.text)
    assert.equal(anonymous.json.error.code, 'sessions/unauthorized')
  })
})
