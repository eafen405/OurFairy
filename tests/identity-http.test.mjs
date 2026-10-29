/**
 * Ticket #26 acceptance: invite registration, sign-in, and session credentials
 * over the real backend. Ticket #219 adds the agent roster: one credential-only
 * read of every live agent's short number and name.
 *
 * These drive the shipped launcher (`scripts/ourfairy-backend.ts start`), which
 * boots the real dsh CLI with the OurFairy profile, and then speak HTTP to the
 * listener it bound — no plugin is assembled by hand and no request is faked.
 * Requests go through the shared helper's `node:http` client, not `fetch`, so
 * they cannot be routed through an ambient proxy the way `NODE_USE_ENV_PROXY`
 * does for global fetch.
 *
 * The helper's `startArgs` derives `--allow-drift` for an explicit
 * `OURFAIRY_DSH_DIR` override (a ticket worktree of the harness); without it the
 * launcher checks out the pinned combination, which is what a normal run must do.
 *
 * @covers backend/identity — this is the credential suite's own subject: the
 * invitation, registration, session read, agent roster and sign-out routes, and
 * the refusal each one answers.
 * @covers backend/gateway — the host fence case names `/gateway/read` as that
 * row's entry point, so a route that stopped being registered fails here.
 * @covers backend/attachments — the same case names `/attachments/propose`.
 * @covers backend/speech — the same case names `/speech`.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, removeHome, runBackend, startArgs, startedPort } from './helpers/backend.mjs'

const PHAETHON_PASSWORD = 'test-phaethon-password'
const home = makeHome('ourfairy-identity-')
const started = { port: undefined, stop: () => {} }

before(() => {
  const run = runBackend(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    MINIMAX_CN_API_KEY: undefined,
    OURFAIRY_MINIMAX_BASE_URL: undefined,
  })
  started.port = startedPort(run)
  started.stop = () => { started.stopped = runBackend(['stop'], { OURFAIRY_HOME: home }) }
})

after(() => {
  const stop = runBackend(['stop'], { OURFAIRY_HOME: home })
  assert.equal(stop.code, 0, describeRun('stop', stop))
  assert.match(stop.stdout, /"leakedProcesses": \[\]|leaked processes: 0/u,
    `stopping the backend must not leave a process behind:\n${stop.stdout}`)
  removeHome(home)
})

/** One HTTP request against the running backend, with the raw response kept. */
function request(path, options = {}) {
  return httpJson(started.port, path, { ...options, expect: false })
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

describe('OurFairy identity over real HTTP', () => {
  test('the provisioned Phaethon signs in as short number 1', async () => {
    const signedIn = await signIn('phaethon', PHAETHON_PASSWORD)
    assert.equal(signedIn.user.shortId, 1, 'Phaethon must be short number 1')
    assert.equal(signedIn.user.isAdmin, true, 'Phaethon must be the administrator')
    assert.equal(typeof signedIn.token, 'string')
    assert.ok(signedIn.token.length >= 32, 'the session credential must be a real secret, not a guessable value')
    const sessions = await request('/identity/session', { token: signedIn.token })
    assert.equal(sessions.status, 200, `the fresh credential must verify: ${sessions.text}`)
    assert.equal(sessions.json.user.shortId, 1)
  })

  test('invited agents take the next short numbers in registration order', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const first = await register(await createInvite(phaethon.token), 'agent-one')
    assert.equal(first.status, 200, `the first invited agent must register: ${first.text}`)
    assert.equal(first.json.user.shortId, 2, 'the first invited agent must be short number 2')
    assert.equal(first.json.user.isAdmin, false)
    const second = await register(await createInvite(phaethon.token), 'agent-two')
    assert.equal(second.status, 200, `the second invited agent must register: ${second.text}`)
    assert.equal(second.json.user.shortId, 3, 'the second invited agent must be short number 3')
  })

  test('refused registrations leave no identity and consume no short number', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const spent = await createInvite(phaethon.token)
    const created = await register(spent, 'agent-refusal-probe')
    assert.equal(created.status, 200, `the probe identity must register: ${created.text}`)
    const allocated = created.json.user.shortId

    const unknown = await register('ZZZZZZZZZZZZ', 'agent-unknown-invite')
    assert.equal(unknown.status, 403, `an unissued invite code must be refused: ${unknown.text}`)
    assert.equal(unknown.json.error.code, 'identity/unknown-invite')

    const reused = await register(spent, 'agent-reused-invite')
    assert.equal(reused.status, 409, `a spent invite code must be refused: ${reused.text}`)
    assert.equal(reused.json.error.code, 'identity/invite-used')

    const duplicateName = await register(await createInvite(phaethon.token), 'agent-refusal-probe')
    assert.equal(duplicateName.status, 409, `a name already in use must be refused: ${duplicateName.text}`)
    assert.equal(duplicateName.json.error.code, 'identity/name-taken')

    // The next successful registration proves none of the three refusals
    // allocated an identity or burned a number.
    const next = await register(await createInvite(phaethon.token), 'agent-after-refusals')
    assert.equal(next.status, 200, `the following registration must succeed: ${next.text}`)
    assert.equal(next.json.user.shortId, allocated + 1,
      'a refused registration must not consume a short number')
  })

  test('an ordinary agent is refused the administrator invite operation', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-no-admin')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)

    const refused = await request('/identity/invite', { token: agent.json.token })
    assert.equal(refused.status, 403, `an agent must not mint invites: ${refused.text}`)
    assert.equal(refused.json.error.code, 'identity/forbidden')

    // Refused for real, not just hidden: no invite code came back.
    assert.equal(refused.json.invite, undefined)
    const anonymous = await request('/identity/invite')
    assert.equal(anonymous.status, 401, `an anonymous caller must be refused: ${anonymous.text}`)
  })

  test('the credential names its own holder with no user field in the request', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-self')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)

    const seen = await request('/identity/session', { token: agent.json.token })
    assert.equal(seen.status, 200, `the agent credential must verify: ${seen.text}`)
    assert.equal(seen.json.user.shortId, agent.json.user.shortId)
    assert.equal(seen.json.user.isAdmin, false)

    // The administrator's own credential still speaks for the administrator:
    // presenting it never turns the request into the agent's identity or back.
    const admin = await request('/identity/session', { token: phaethon.token })
    assert.equal(admin.json.user.shortId, 1)
    assert.equal(admin.json.user.isAdmin, true)

    const forged = await request('/identity/session', { token: 'not-a-real-session-token' })
    assert.equal(forged.status, 401, `a forged credential must be refused: ${forged.text}`)
  })

  test('an agent reads every live agent, itself included, as only a number and a name', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const caller = await register(await createInvite(phaethon.token), 'agent-roster-caller')
    assert.equal(caller.status, 200, `the caller must exist: ${caller.text}`)
    const peer = await register(await createInvite(phaethon.token), 'agent-roster-peer')
    assert.equal(peer.status, 200, `the peer must exist: ${peer.text}`)

    const roster = await request('/identity/agents', { token: caller.json.token })
    assert.equal(roster.status, 200, `a live credential must read the roster: ${roster.text}`)
    assert.equal(roster.json.ok, true)
    const agents = roster.json.agents
    assert.ok(Array.isArray(agents), `the roster must be a list: ${roster.text}`)

    // Order is the short number, and an entry carries existence only: no
    // administrator flag and no creation time may travel with it.
    assert.deepEqual(agents.map(agent => agent.shortId),
      [...agents.map(agent => agent.shortId)].sort((left, right) => left - right),
      'the roster must be ordered by short number')
    for (const agent of agents) {
      assert.deepEqual(Object.keys(agent).sort(), ['name', 'shortId'],
        `a roster entry must name only the short number and the name: ${JSON.stringify(agent)}`)
    }

    const names = new Map(agents.map(agent => [agent.shortId, agent.name]))
    assert.equal(names.get(caller.json.user.shortId), 'agent-roster-caller',
      'the caller must see itself in the roster')
    assert.equal(names.get(peer.json.user.shortId), 'agent-roster-peer',
      'the caller must see the other agents')
    assert.equal(names.get(1), 'phaethon', 'the administrator appears as an ordinary agent')
  })

  test('the roster stays unreachable without a live credential', async () => {
    const anonymous = await request('/identity/agents')
    assert.equal(anonymous.status, 401, `an anonymous caller must be refused: ${anonymous.text}`)
    assert.equal(anonymous.json.error.code, 'identity/unauthorized')
    assert.equal(anonymous.json.agents, undefined, 'a refusal must not carry part of the roster')

    const forged = await request('/identity/agents', { token: 'not-a-real-session-token' })
    assert.equal(forged.status, 401, `a forged credential must be refused: ${forged.text}`)
    assert.equal(forged.json.error.code, 'identity/unauthorized')
    assert.equal(forged.json.agents, undefined, 'a forged credential must not be handed the roster')
  })

  test('signing out ends the credential it was presented with', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-signout')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)
    const token = agent.json.token

    const signedOut = await request('/identity/sign-out', { token })
    assert.equal(signedOut.status, 200, `sign-out must succeed: ${signedOut.text}`)
    assert.equal(signedOut.json.revoked, true)

    const afterSignOut = await request('/identity/session', { token })
    assert.equal(afterSignOut.status, 401, `a revoked credential must stop working: ${afterSignOut.text}`)

    // Signing in again mints a working credential, so sign-out ended the
    // session and not the identity.
    const again = await signIn('agent-signout', 'agent-signout-password')
    const restored = await request('/identity/session', { token: again.token })
    assert.equal(restored.status, 200, `a fresh credential must work: ${restored.text}`)
  })

  test('a request for an untrusted Host is refused by the same fence the /api route uses', async () => {
    // The boundary doc records that every product route runs the native fence
    // before it reads a body or a credential. A rebound browser sends the
    // attacker's domain in Host, so an unconfigured authority must be refused
    // at the door — while the same sign-in succeeds on the loopback authority.
    const refused = await request('/identity/sign-in', {
      host: 'attacker.invalid',
      body: { name: 'phaethon', password: PHAETHON_PASSWORD },
    })
    assert.equal(refused.status, 403, `an untrusted Host must be fenced off: ${refused.text}`)
    assert.equal(refused.json?.error?.code, 'identity/forbidden-authority', refused.text)

    const admitted = await signIn('phaethon', PHAETHON_PASSWORD)
    assert.equal(typeof admitted.token, 'string', 'the loopback authority must still sign in')
  })

  test('every product module entry point rejects an untrusted Host before parsing the body or reading the credential', async () => {
    // One representative entry point per product module. No credential and no
    // body: the 403 with a forbidden-authority code is only reachable through
    // the fence, because each module's own authorization/body handling would
    // answer 401 or 400 after a missing credential. `/speech` reports the bare
    // code; the other modules prefix it with their own name.
    const paths = [
      '/identity/sign-in',
      '/sessions/list',
      '/chat/read',
      '/gateway/read',
      '/attachments/propose',
      '/speech',
    ]
    for (const path of paths) {
      const refused = await request(path, { host: 'attacker.invalid', body: {} })
      assert.equal(refused.status, 403, `${path} must be fenced off: ${refused.text}`)
      assert.match(refused.json?.error?.code ?? '', /forbidden-authority$/u,
        `${path} must report a forbidden-authority code: ${refused.text}`)
    }
    // A malformed body pins the order: a fence that ran after JSON parsing would
    // answer 400 before judging the authority. 403 with the forbidden-authority
    // code is reachable only when the fence runs before the body is parsed.
    for (const path of paths) {
      const refused = await request(path, { host: 'attacker.invalid', rawBody: '{' })
      assert.equal(refused.status, 403,
        `${path} must be fenced off before its malformed body is parsed: ${refused.text}`)
      assert.match(refused.json?.error?.code ?? '', /forbidden-authority$/u,
        `${path} must report a forbidden-authority code for a malformed body: ${refused.text}`)
    }
    // The backend still answers the loopback authority after all refusals.
    const admitted = await signIn('phaethon', PHAETHON_PASSWORD)
    assert.equal(typeof admitted.token, 'string')
  })

  test('a session credential admits dsh /api while an anonymous request is refused at the door', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const agent = await register(await createInvite(phaethon.token), 'agent-api-admission')
    assert.equal(agent.status, 200, `the agent must exist: ${agent.text}`)

    // No endpoint is mounted on dsh's shared channel yet (that is ticket #28),
    // so admission is observable as the difference between the carrier's door
    // and the bridge's own "not found": 401 means the request never entered.
    const anonymous = await request('/api/session.list', { method: 'GET' })
    assert.equal(anonymous.status, 401, `an anonymous /api request must be refused: ${anonymous.text}`)
    assert.match(anonymous.text, /unauthorized/u)

    // The pinned dsh validates the RPC envelope before it looks for an endpoint,
    // so a bare body answers 400. A well-formed envelope for a method the shared
    // channel does not mount keeps the observation on "admitted, then not found".
    const admitted = await request('/api/session.list', {
      token: agent.json.token,
      body: { type: 'client-request', rpcId: 'probe-1', method: 'session.list', payload: {} },
    })
    assert.equal(admitted.status, 404,
      `the session credential must pass admission and then miss the endpoint: ${admitted.text}`)
  })

  test('concurrent registrations never share a short number and never half-succeed', async () => {
    const phaethon = await signIn('phaethon', PHAETHON_PASSWORD)
    const codes = []
    for (let index = 0; index < 5; index += 1) codes.push(await createInvite(phaethon.token))

    const results = await Promise.all(codes.map((code, index) => register(code, `agent-parallel-${index}`)))
    const shortIds = results.map(result => result.json.user.shortId)
    assert.deepEqual(results.map(result => result.status), [200, 200, 200, 200, 200],
      `every distinct invite must register exactly once: ${results.map(r => r.text).join(' | ')}`)
    assert.equal(new Set(shortIds).size, shortIds.length, `short numbers must be unique, got ${shortIds.join(', ')}`)
    // Which of five simultaneous registrations commits first is genuinely
    // nondeterministic, so the assertion is on the arithmetic rather than on
    // the arrival order of the responses: five successes take five consecutive
    // numbers, with no duplicate and no gap left by a failure.
    const ordered = [...shortIds].sort((left, right) => left - right)
    const first = ordered[0]
    assert.deepEqual(ordered, [first, first + 1, first + 2, first + 3, first + 4],
      `five concurrent registrations must take five consecutive short numbers: ${shortIds.join(', ')}`)
    assert.deepEqual(results.map(result => result.json.user.name),
      ['agent-parallel-0', 'agent-parallel-1', 'agent-parallel-2', 'agent-parallel-3', 'agent-parallel-4'],
      'each concurrent registration must create exactly its own identity')

    // Five simultaneous submissions of ONE invite code: exactly one identity.
    const shared = await createInvite(phaethon.token)
    const repeated = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) => register(shared, `agent-duplicate-${index}`)),
    )
    const accepted = repeated.filter(result => result.status === 200)
    const refused = repeated.filter(result => result.status !== 200)
    assert.equal(accepted.length, 1,
      `exactly one submission of a single-use invite may succeed: ${repeated.map(r => r.text).join(' | ')}`)
    assert.equal(refused.length, 4)
    for (const result of refused) assert.equal(result.status, 409, `a duplicate submission is refused: ${result.text}`)

    // The single winner is a real, usable identity, and the four losers left
    // nothing behind: the next registration takes the very next number.
    const winner = accepted[0].json
    const verified = await request('/identity/session', { token: winner.token })
    assert.equal(verified.status, 200, `the winning identity must be usable: ${verified.text}`)
    assert.equal(verified.json.user.shortId, winner.user.shortId)

    const trailing = await register(await createInvite(phaethon.token), 'agent-after-duplicates')
    assert.equal(trailing.status, 200, `the trailing registration must succeed: ${trailing.text}`)
    assert.equal(trailing.json.user.shortId, winner.user.shortId + 1,
      'a refused duplicate submission must not consume a short number')
  })
})
