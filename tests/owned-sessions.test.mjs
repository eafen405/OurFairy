/**
 * Ticket #27 acceptance: owned sessions, the fixed primary session, and restart
 * recovery, over the real backend.
 *
 * These drive the shipped launcher (`scripts/ourfairy-backend.mjs start`), which
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
 * An explicit `OURFAIRY_DSH_DIR` override (a ticket worktree of the harness) is
 * passed through with `--allow-drift`; without it the launcher checks out the
 * pinned combination, which is what a normal run must do.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { describeRun, makeHome, removeHome, runBackend } from './helpers/backend.mjs'

const PHAETHON_PASSWORD = 'test-phaethon-password'
const home = makeHome('ourfairy-owned-sessions-')
const backend = { port: undefined }

/** Launcher arguments for one start, mirroring the identity suite. */
function startArgs() {
  const args = ['start', '--json']
  if (process.env.OURFAIRY_DSH_DIR !== undefined && process.env.OURFAIRY_DSH_DIR !== '') args.push('--allow-drift')
  return args
}

/** Boot the real backend on an ephemeral port and remember the one it bound. */
function startBackend() {
  const run = runBackend(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    DEEPSEEK_API_KEY: undefined,
    DEEPSEEK_BASE_URL: undefined,
  })
  assert.equal(run.code, 0, describeRun('start', run))
  const summary = JSON.parse(run.stdout)
  assert.ok(Array.isArray(summary.listeningPorts) && summary.listeningPorts.length > 0,
    `started backend reported no listening port: ${run.stdout}`)
  backend.port = summary.listeningPorts[0]
}

/** Stop the running backend, asserting it left nothing behind. */
function stopBackend() {
  const run = runBackend(['stop'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  assert.match(run.stdout, /"leakedProcesses": \[\]|leaked processes: 0/u,
    `stopping the backend must not leave a process behind:\n${run.stdout}`)
}

before(() => { startBackend() })

after(() => {
  stopBackend()
  removeHome(home)
})

/** One HTTP request against the running backend. */
function request(path, { method = 'POST', token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const headers = { host: `127.0.0.1:${backend.port}` }
    if (token !== undefined) headers.authorization = `Bearer ${token}`
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(payload.byteLength)
    }
    const call = http.request({ host: '127.0.0.1', port: backend.port, path, method, headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try { json = JSON.parse(text) } catch { json = undefined }
        resolve({ status: response.statusCode, headers: response.headers, text, json })
      })
    })
    call.on('error', reject)
    if (payload !== undefined) call.write(payload)
    call.end()
  })
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

    // A second session belongs to the same owner and must not displace the primary.
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

    // Two concurrent creates may each mint their own ordinary session, but
    // neither can displace the main or bind it to anything else.
    const [extra, other] = await Promise.all([
      request('/sessions/create', { token }),
      request('/sessions/create', { token }),
    ])
    assert.equal(extra.status, 200, `the first extra create must succeed: ${extra.text}`)
    assert.equal(other.status, 200, `the second extra create must succeed: ${other.text}`)
    assert.notEqual(extra.json.session.id, other.json.session.id,
      'two concurrent creates must each get their own ordinary session')
    for (const created of [extra, other]) {
      assert.equal(created.json.session.primary, false,
        'a racing ordinary create must never answer with the primary session')
    }

    const settled = await request('/sessions/list', { token })
    assert.equal(settled.json.primarySessionId, returned.json.session.id,
      'concurrent creates must not move the primary binding')
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
    const profileLayer = join(home, 'dsh-home', 'profiles', 'ourfairy', 'cordis.patch.yml')
    const fixturePlugin = fileURLToPath(new URL('../backend/sessions/test-support/persist-fixtures.mjs', import.meta.url))
    stopBackend()
    writeFileSync(profileLayer, JSON.stringify([{ insert: [{
      id: 'cold-session-fixtures', name: fixturePlugin, config: { fixtures },
    }] }]))
    try {
      startBackend()
      stopBackend()
    } finally {
      writeFileSync(profileLayer, '[]\n')
    }
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
        const absent = await request(path, { token, body: { sessionId: foreignId } })
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
})
