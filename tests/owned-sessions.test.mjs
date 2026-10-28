/**
 * Ticket #27 acceptance: owned sessions, the fixed primary session, and restart
 * recovery, over the real backend.
 *
 * These drive the shipped launcher (`scripts/ourfairy-backend.ts start`), which
 * boots the real dsh CLI with the OurFairy profile, and then speak HTTP to the
 * listener it bound — no plugin is assembled by hand and no request is faked.
 * Requests go through `node:http`, not `fetch`, so they cannot be routed
 * through an ambient proxy the way `NODE_USE_ENV_PROXY` does for global fetch.
 *
 * The product's own session paths live outside dsh's admitted `/api` prefix, for
 * the same reason the identity paths do: the caller is derived from the
 * presented credential, never from a user field in the request body. A session
 * with no ownership record is therefore refused rather than adopted, and an
 * anonymous request is refused rather than served as some implicit user.
 *
 * The shared helper derives `--allow-drift` for an explicit `OURFAIRY_DSH_DIR`
 * override (a ticket worktree of the harness) and mounts each test fixture with
 * `--patch`; without the override the launcher checks out the pinned
 * combination, which is what a normal run must do.
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, removeHome, runBackend, startArgs, startedPort, writeOverlay } from './helpers/backend.mjs'

import { startTitleAwareModel } from './helpers/title-aware.mjs'

const PHAETHON_PASSWORD = 'test-phaethon-password'
const home = makeHome('ourfairy-owned-sessions-')
const backend = { port: undefined }
let model
let messageSerial = 0

/** Boot the real backend on an ephemeral port and remember the one it bound. */
function startBackend(overlays = []) {
  const run = runBackend(startArgs(overlays), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    MINIMAX_CN_API_KEY: 'mock-key',
    OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}`,
  })
  backend.port = startedPort(run)
}

/** Stop the running backend, asserting it left nothing behind. */
function stopBackend() {
  const run = runBackend(['stop'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  assert.match(run.stdout, /"leakedProcesses": \[\]|leaked processes: 0/u,
    `stopping the backend must not leave a process behind:\n${run.stdout}`)
}

before(async () => {
  model = await startTitleAwareModel({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'OK' })
  startBackend()
})

after(async () => {
  stopBackend()
  removeHome(home)
  await model?.close()
})

/** One HTTP request against the running backend, with the raw response kept. */
function request(path, options = {}) {
  return httpJson(backend.port, path, { ...options, expect: false })
}

/**
 * Send one chat message and wait until its reply settles, so the session's log
 * is durably non-empty before the next `create` reads it.
 */
async function say(token, sessionId, text = 'owned-session content') {
  const sent = await request('/chat/send', { token, body: { sessionId, requestId: `owned-message-${++messageSerial}`, text } })
  assert.equal(sent.status, 200, `sending a message must succeed: ${sent.text}`)
  const until = Date.now() + 15000
  let projection
  do {
    const read = await request('/chat/read', { token, body: { sessionId } })
    assert.equal(read.status, 200, `reading the sent session must succeed: ${read.text}`)
    projection = read.json.projection
    if (projection.replyStatus === 0 && projection.messages.some(message => message.role === 2)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < until)
  assert.fail(`the sent message did not settle: ${JSON.stringify(projection)}`)
}

/** Sign one identity in and return its session credential. */
async function signIn(name, password) {
  const response = await request('/identity/sign-in', { body: { name, password } })
  assert.equal(response.status, 200, `sign-in for ${name} failed: ${response.text}`)
  return response.json
}

/** Mint one invite as the given administrator. */
async function createInvite(token) {
  const response = await request('/identity/invite', { token })
  assert.equal(response.status, 200, `invite creation failed: ${response.text}`)
  return response.json.invite.code
}

/** Register one invited identity. */
function register(inviteCode, name, password = `${name}-password`) {
  return request('/identity/register', { body: { inviteCode, name, password } })
}

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

describe('OurFairy owned sessions over real HTTP', () => {
  test('a failed durable create can be retried in the same backend process', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-write-retry')
    assert.equal(agent.status, 200, agent.text)
    // A file where JSONL needs a project directory produces a real write error.
    // Metadata listing ignores this non-directory; creation reaches durability.
    const project = join(home, 'dsh-home', 'sessions', '_no-cwd')
    mkdirSync(join(home, 'dsh-home', 'sessions'), { recursive: true })
    writeFileSync(project, 'write obstruction')
    try {
      const failed = await request('/sessions/create', { token: agent.json.token })
      assert.equal(failed.status, 500, failed.text)
    } finally {
      rmSync(project, { force: true })
    }
    const retried = await request('/sessions/create', { token: agent.json.token })
    assert.equal(retried.status, 200, `retry must not leave a duplicate live entry: ${retried.text}`)
    assert.equal(retried.json.session.primary, true)
    const read = await request('/sessions/read', {
      token: agent.json.token, body: { sessionId: retried.json.session.id },
    })
    assert.equal(read.status, 200, read.text)
  })
  test('a session created by a signed-in identity keeps its owner and its primary binding across a restart', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-owner-one')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)
    const token = agent.json.token
    const owner = `user:${agent.json.user.shortId}`

    const first = await request('/sessions/create', { token })
    assert.equal(first.status, 200, `creating a session must succeed: ${first.text}`)
    assert.equal(first.json.ok, true)
    assert.equal(first.json.session.owner, owner,
      'the session must belong to the identity the credential names')
    assert.equal(first.json.session.primary, true,
      'the first session a user creates is their fixed primary session')
    assert.equal(typeof first.json.session.id, 'string')
    assert.ok(first.json.session.id.length > 0, 'a created session needs a real identifier')

    // Only an empty session is reused. Content makes the next create a new
    // ordinary session, which belongs to the same owner and must not displace
    // the primary.
    await say(token, first.json.session.id)
    const second = await request('/sessions/create', { token })
    assert.equal(second.status, 200, `creating a second session must succeed: ${second.text}`)
    assert.notEqual(second.json.session.id, first.json.session.id)
    assert.equal(second.json.session.owner, owner)
    assert.equal(second.json.session.primary, false,
      'creating another session must not change which session is primary')

    const listed = await request('/sessions/list', { token })
    assert.equal(listed.status, 200, `listing must succeed: ${listed.text}`)
    assert.deepEqual(listed.json.sessions.map(session => session.id).sort(),
      [first.json.session.id, second.json.session.id].sort())
    assert.equal(listed.json.primarySessionId, first.json.session.id,
      'creating another session must not move the primary binding')
    assert.equal(listed.json.sessions.filter(session => session.primary).length, 1,
      'exactly one session is primary')

    // Selecting another session switches the current one without moving the primary.
    const selected = await request('/sessions/select', { token, body: { sessionId: second.json.session.id } })
    assert.equal(selected.status, 200, `selecting an owned session must succeed: ${selected.text}`)
    assert.equal(selected.json.session.id, second.json.session.id)

    const stillPrimary = await request('/sessions/list', { token })
    assert.equal(stillPrimary.json.primarySessionId, first.json.session.id,
      'selecting another session must not move the primary binding')

    // Restart the real backend: ownership and the primary binding are durable.
    stopBackend()
    startBackend()

    const afterRestart = await request('/sessions/list', { token })
    assert.equal(afterRestart.status, 200, `the credential must still work after a restart: ${afterRestart.text}`)
    assert.deepEqual(afterRestart.json.sessions.map(session => session.id).sort(),
      [first.json.session.id, second.json.session.id].sort(),
      'a restart must restore exactly the sessions this owner created')
    for (const session of afterRestart.json.sessions) {
      assert.equal(session.owner, owner, 'every restored session must keep its owner')
    }
    assert.equal(afterRestart.json.primarySessionId, first.json.session.id,
      'the primary session must survive a restart')

    const returned = await request('/sessions/primary', { token })
    assert.equal(returned.status, 200, `returning to the primary session must succeed: ${returned.text}`)
    assert.equal(returned.json.session.id, first.json.session.id)

    const read = await request('/sessions/read', { token, body: { sessionId: first.json.session.id } })
    assert.equal(read.status, 200, `reading an owned session must succeed: ${read.text}`)
    assert.equal(read.json.session.owner, owner)
    assert.equal(read.json.session.id, first.json.session.id)
  })

  test('create reuses the empty primary session, even when the log was never opened', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-empty-reuse')
    assert.equal(agent.status, 200, agent.text)
    const token = agent.json.token

    const first = await request('/sessions/create', { token })
    assert.equal(first.status, 200, first.text)
    assert.equal(first.json.session.primary, true)

    const second = await request('/sessions/create', { token })
    assert.equal(second.status, 200, second.text)
    assert.equal(second.json.session.id, first.json.session.id,
      'an empty primary session is entered again instead of creating a new session')

    const listed = await request('/sessions/list', { token })
    assert.deepEqual(listed.json.sessions.map(session => session.id), [first.json.session.id],
      're-entering the empty session must not add a session')
    const returned = await request('/sessions/primary', { token })
    assert.equal(returned.json.session.id, first.json.session.id)

    // The session was created and never opened by chat, so only its header is
    // on disk. A restart must read that header-only log as empty and reuse it.
    stopBackend()
    startBackend()
    const afterRestart = await request('/sessions/create', { token })
    assert.equal(afterRestart.status, 200, afterRestart.text)
    assert.equal(afterRestart.json.session.id, first.json.session.id,
      'a header-only session is empty after a restart and is reused')
    const relisted = await request('/sessions/list', { token })
    assert.deepEqual(relisted.json.sessions.map(session => session.id), [first.json.session.id])
  })

  test('create makes a new session once the reusable one has content', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-content-boundary')
    assert.equal(agent.status, 200, agent.text)
    const token = agent.json.token

    const primary = await request('/sessions/create', { token })
    await say(token, primary.json.session.id)
    const ordinary = await request('/sessions/create', { token })
    assert.equal(ordinary.status, 200, ordinary.text)
    assert.notEqual(ordinary.json.session.id, primary.json.session.id,
      'a session with a message is not reused')
    assert.equal(ordinary.json.session.primary, false)

    const again = await request('/sessions/create', { token })
    assert.equal(again.json.session.id, ordinary.json.session.id,
      'the empty ordinary session is reused instead of creating another')
    const listed = await request('/sessions/list', { token })
    assert.deepEqual(listed.json.sessions.map(session => session.id).sort(),
      [primary.json.session.id, ordinary.json.session.id].sort())
    assert.equal(listed.json.primarySessionId, primary.json.session.id)

    await say(token, ordinary.json.session.id)
    const third = await request('/sessions/create', { token })
    assert.notEqual(third.json.session.id, ordinary.json.session.id,
      'content in the ordinary session makes the next create a new session')
    assert.notEqual(third.json.session.id, primary.json.session.id)
    assert.equal(third.json.session.primary, false)
    const settled = await request('/sessions/primary', { token })
    assert.equal(settled.json.session.id, primary.json.session.id,
      'creating a session must never move the primary binding')
  })

  test('concurrent creates leave one empty ordinary session', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-concurrent-empty')
    assert.equal(agent.status, 200, agent.text)
    const token = agent.json.token

    const primary = await request('/sessions/create', { token })
    await say(token, primary.json.session.id)
    const created = await Promise.all(Array.from({ length: 3 }, () => request('/sessions/create', { token })))
    for (const response of created) assert.equal(response.status, 200, response.text)
    const ids = new Set(created.map(response => response.json.session.id))
    assert.equal(ids.size, 1, 'concurrent creates must answer the same empty ordinary session')
    assert.notEqual([...ids][0], primary.json.session.id)

    const listed = await request('/sessions/list', { token })
    assert.equal(listed.json.sessions.length, 2,
      'the racing creates must leave exactly the primary and one ordinary session')
    assert.equal(listed.json.sessions.filter(session => session.primary).length, 1)
    assert.equal(listed.json.primarySessionId, primary.json.session.id)

    const again = await request('/sessions/create', { token })
    assert.equal(again.json.session.id, [...ids][0],
      'the empty ordinary session stays the reusable one after the race')
  })

  test('a missing or foreign session is refused, and no request is ever served as an implicit user', async () => {
    // Anonymous requests are refused outright: a caller that presented no
    // credential is never served as some implicit user, and the product never
    // falls back to "user 1" (the administrator) for it.
    for (const path of ['/sessions/create', '/sessions/list', '/sessions/primary']) {
      const anonymous = await request(path)
      assert.equal(anonymous.status, 401, `${path} must refuse an anonymous caller: ${anonymous.text}`)
      assert.equal(anonymous.json.error.code, 'sessions/unauthorized')
      assert.equal(anonymous.json.sessions, undefined, 'a refused request must not disclose any session')
      assert.equal(anonymous.json.session, undefined, 'a refused request must not disclose any session')
    }

    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const owner = await register(await createInvite(phaethon.token), 'agent-owner-two')
    const stranger = await register(await createInvite(phaethon.token), 'agent-owner-three')
    assert.equal(owner.status, 200, `the owner must exist: ${owner.text}`)
    assert.equal(stranger.status, 200, `the stranger must exist: ${stranger.text}`)

    const owned = await request('/sessions/create', { token: owner.json.token })
    assert.equal(owned.status, 200, `the owner's session must be created: ${owned.text}`)

    // A different signed-in identity does not see it, and knowing the identifier
    // does not widen access to it.
    const strangerList = await request('/sessions/list', { token: stranger.json.token })
    assert.equal(strangerList.status, 200, `the stranger's listing must succeed: ${strangerList.text}`)
    assert.deepEqual(strangerList.json.sessions, [], 'a new identity starts with no sessions')
    assert.equal(strangerList.json.primarySessionId, null, 'a user with no session has no primary session')

    for (const path of ['/sessions/read', '/sessions/select']) {
      const refused = await request(path, { token: stranger.json.token, body: { sessionId: owned.json.session.id } })
      assert.equal(refused.status, 404, `${path} must refuse a session the caller does not own: ${refused.text}`)
      assert.equal(refused.json.error.code, 'sessions/unknown-session')
      assert.equal(refused.json.session, undefined, 'a refused request must not disclose the session')
    }

    // Nonexistent identifiers are refused; persisted ownerless data is covered
    // separately by the cold fixture test.
    for (const sessionId of ['session-1', 'not-a-session']) {
      const refused = await request('/sessions/read', { token: owner.json.token, body: { sessionId } })
      assert.equal(refused.status, 404, `an unowned identifier must be refused: ${refused.text}`)
      assert.equal(refused.json.error.code, 'sessions/unknown-session')
    }

    // A request that names no session at all is a malformed request, not a
    // licence to pick one.
    const nameless = await request('/sessions/read', { token: owner.json.token })
    assert.equal(nameless.status, 400, `a request naming no session must be refused: ${nameless.text}`)
    assert.equal(nameless.json.error.code, 'sessions/invalid-request')

    // The administrator is an identity too, not a key to everyone's content.
    const adminList = await request('/sessions/list', { token: phaethon.token })
    assert.equal(adminList.status, 200, `the administrator's listing must succeed: ${adminList.text}`)
    assert.deepEqual(adminList.json.sessions, [],
      'the administrator identity must not see sessions it does not own')
  })

  test('select answers exactly as read does, because switching moves no persistent binding', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-read-select-equivalent')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)
    const token = agent.json.token

    const primary = await request('/sessions/create', { token })
    await say(token, primary.json.session.id)
    const ordinary = await request('/sessions/create', { token })
    const before = await request('/sessions/list', { token })
    const artifactsBefore = durableArtifacts()

    for (const sessionId of [primary.json.session.id, ordinary.json.session.id]) {
      const read = await request('/sessions/read', { token, body: { sessionId } })
      const select = await request('/sessions/select', { token, body: { sessionId } })
      assert.equal(read.status, 200, `reading an owned session must succeed: ${read.text}`)
      assert.equal(select.status, 200, `selecting an owned session must succeed: ${select.text}`)
      assert.deepEqual(select.json, read.json,
        'select must answer exactly what read answers: it only names the current session client-side')
    }

    const after = await request('/sessions/list', { token })
    assert.deepEqual(after.json, before.json,
      'selecting must leave the listings, the primary binding, and the session set untouched')
    assert.deepEqual(durableArtifacts(), artifactsBefore,
      'select must move no persistent binding: reading and selecting write no durable artifact')
  })

  test('a primary request racing a create still resolves the fixed primary session', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-owner-four')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)
    const token = agent.json.token

    // Both requests are in flight together for an identity that owns nothing.
    // Answering the create's response from the primary path (or the other way
    // round) would hand one caller a session that is not the fixed main, so each
    // response is checked for being the primary it was asked for.
    const [created, returned] = await Promise.all([
      request('/sessions/create', { token }),
      request('/sessions/primary', { token }),
    ])

    assert.equal(created.status, 200, `the racing create must succeed: ${created.text}`)
    assert.equal(returned.status, 200, `the racing primary must succeed: ${returned.text}`)
    assert.equal(returned.json.session.primary, true,
      `the primary request must answer with the fixed primary session, not ${returned.json.session.id}`)
    assert.equal(created.json.session.owner, `user:${agent.json.user.shortId}`)

    // The fixed primary is deterministic: asking again resolves the same session,
    // and exactly one of this identity's sessions is primary.
    const again = await request('/sessions/primary', { token })
    assert.equal(again.json.session.id, returned.json.session.id,
      'the fixed primary must be stable, not minted per request')

    const listed = await request('/sessions/list', { token })
    assert.equal(listed.json.primarySessionId, returned.json.session.id,
      'the primary binding must be the session the primary request returned')
    assert.equal(listed.json.sessions.filter(session => session.primary).length, 1,
      'exactly one session is primary')

    // The primary now has content, so the next creates are ordinary. They race
    // each other, and both must enter the same single empty ordinary session.
    await say(token, returned.json.session.id)
    const [extra, other] = await Promise.all([
      request('/sessions/create', { token }),
      request('/sessions/create', { token }),
    ])
    assert.equal(extra.status, 200, `the first extra create must succeed: ${extra.text}`)
    assert.equal(other.status, 200, `the second extra create must succeed: ${other.text}`)
    assert.equal(extra.json.session.id, other.json.session.id,
      'two concurrent creates must reuse the same empty ordinary session')
    for (const created of [extra, other]) {
      assert.equal(created.json.session.primary, false,
        'a racing ordinary create must never answer with the primary session')
    }

    const settled = await request('/sessions/list', { token })
    assert.equal(settled.json.primarySessionId, returned.json.session.id,
      'concurrent creates must not move the primary binding')
    assert.equal(settled.json.sessions.length, 2,
      'the racing creates must leave exactly the primary and one ordinary session')
  })

  test('cold ownerless and foreign sessions are refused without changing durable artifacts', async t => {
    const admin = await signIn('phaethon', PHAETHON_PASSWORD)
    const caller = await register(await createInvite(admin.token), 'agent-cold-caller')
    const owner = await register(await createInvite(admin.token), 'agent-cold-owner')
    const collision = await register(await createInvite(admin.token), 'agent-cold-collision')
    for (const registered of [caller, owner, collision]) assert.equal(registered.status, 200, registered.text)
    const ownerlessId = `ourfairy-user-${caller.json.user.shortId}-primary`
    const takenId = `ourfairy-user-${collision.json.user.shortId}-primary`
    const foreignId = 'cold-foreign-session'
    const fixtures = [
      { id: ownerlessId },
      { id: foreignId, owner: `user:${owner.json.user.shortId}` },
      { id: takenId, owner: `user:${owner.json.user.shortId}` },
    ]
    const fixturePlugin = fileURLToPath(new URL('../backend/sessions/test-support/persist-fixtures.ts', import.meta.url))
    stopBackend()
    const overlay = writeOverlay(home, [{ insert: [{
      id: 'cold-session-fixtures', name: fixturePlugin, config: { fixtures },
    }] }], 'cold-session-fixtures.patch.yml')
    startBackend([overlay])
    stopBackend()
    const before = durableArtifacts()
    for (const { id } of fixtures) {
      assert.equal(Object.keys(before).filter(path => path.split('/').includes(id)).length, 1,
        `fixture ${id} must have one real persisted artifact before the product restart`)
    }
    startBackend() // fixture plugin absent; no fixture session was entered live.
    for (const token of [caller.json.token, admin.token]) {
      for (const path of ['/sessions/read', '/sessions/select']) {
        for (const [sessionId, status, code] of [
          [ownerlessId, 403, 'sessions/unowned-session'],
          [foreignId, 404, 'sessions/unknown-session'],
        ]) {
          const refused = await request(path, { token, body: { sessionId } })
          assert.equal(refused.status, status, refused.text)
          assert.equal(refused.json.error.code, code)
          assert.equal(refused.json.session, undefined)
        }
      }
      const listed = await request('/sessions/list', { token })
      assert.equal(listed.status, 200, listed.text)
      assert.ok(listed.json.sessions.every(session => !fixtures.some(fixture => fixture.id === session.id)))
      // All installed product paths above check ownership. Shared/future paths
      // must stay unregistered even with an admitted token and a known other id.
      for (const path of ['/api/sessions/read', '/api/sessions/select', '/api/sessions/subscribe',
        '/api/sessions/control', '/sessions/subscribe', '/sessions/control']) {
        // dsh answers 400 for a body that is not an RPC envelope, so an admitted
        // request to an unmounted method only reads as "not found" when it carries
        // a well-formed envelope; without one the assertion would pass or fail on
        // envelope validation instead of on the route being unregistered.
        const absent = await request(path, {
          token,
          body: {
            type: 'client-request',
            rpcId: 'probe-1',
            method: path.replace(/^\/api\//u, ''),
            payload: { sessionId: foreignId },
          },
        })
        assert.equal(absent.status, 404, `${path}: ${absent.text}`)
      }
    }
    for (const [token, code] of [
      [caller.json.token, 'sessions/unowned-primary'],
      [collision.json.token, 'sessions/primary-taken'],
    ]) {
      for (const path of ['/sessions/create', '/sessions/primary']) {
        const refused = await request(path, { token })
        assert.equal(refused.status, 409, refused.text)
        assert.equal(refused.json.error.code, code)
      }
    }
    for (const path of ['/sessions/read', '/sessions/select']) {
      const anonymous = await request(path, { body: { sessionId: foreignId } })
      assert.equal(anonymous.status, 401, anonymous.text)
      const ownRead = await request(path, { token: owner.json.token, body: { sessionId: foreignId } })
      assert.equal(ownRead.status, 200, ownRead.text)
      assert.equal(ownRead.json.session.owner, `user:${owner.json.user.shortId}`)
    }
    const after = durableArtifacts()
    assert.deepEqual(after, before, 'cold refusal/read/list must not repair or write any durable artifact')
    t.diagnostic(JSON.stringify({ coldFixtures: fixtures, durableArtifacts: after }))
  })

  test('an empty owned session can be resumed by the existing agent factory', async t => {
    const admin = await signIn('phaethon', PHAETHON_PASSWORD)
    const owner = await register(await createInvite(admin.token), 'agent-resume-empty')
    assert.equal(owner.status, 200, owner.text)
    const reportPath = join(home, 'empty-resume-report.json')
    const plugin = fileURLToPath(new URL('../backend/sessions/test-support/resume-empty.ts', import.meta.url))
    stopBackend()
    const overlay = writeOverlay(home, [{ insert: [{
      id: 'resume-empty-owned-session', name: plugin,
      config: { shortId: owner.json.user.shortId, reportPath },
    }] }], 'resume-empty.patch.yml')
    startBackend([overlay])
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    assert.equal(report.error, undefined, report.error)
    assert.equal(report.persistedEventCount, 0, 'the product-created session must be durably empty before resume')
    assert.equal(report.created.owner, `user:${owner.json.user.shortId}`)
    assert.deepEqual(report.resumed, report.created, 'resume must retain the same session identity and owner')
    assert.equal(report.ownerAfterDispose, report.created.owner)
    const read = await request('/sessions/read', {
      token: owner.json.token, body: { sessionId: report.created.id },
    })
    assert.equal(read.status, 200, read.text)
    assert.equal(read.json.session.owner, report.created.owner)
    t.diagnostic(JSON.stringify({ emptyResume: report }))
  })
})
