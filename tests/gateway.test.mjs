/**
 * Ticket #43 acceptance: Phaethon's shared-configuration gateway over the real
 * backend.
 *
 * Every case drives the shipped launcher and speaks HTTP to the listener it
 * bound: the native profile settings row, the native credential seam and the
 * product chat runtime are the real ones. The external model is a loopback
 * Messages-protocol double selected through `OURFAIRY_MINIMAX_BASE_URL`, exactly as the
 * baseline probe suite does; that is a model double, not a claim about a real
 * provider.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, readReport, removeHome, repoRoot, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'

const PHAETHON_PASSWORD = 'gateway-password'
const combo = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(join(repoRoot, 'combo.json'), 'utf8')))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))
const dshRequire = createRequire(join(dshDir, 'apps', 'cli', 'package.json'))

/** Model fields the phone may edit; a previous entry's other fields are deployment-owned. */
const PHONE_MODEL_FIELDS = new Set(['id', 'name', 'contextWindow', 'maxTokens', 'input'])

const servers = []
const homes = []
after(async () => {
  for (const server of servers) await server.close()
  for (const home of homes) removeHome(home)
})

/** One isolated home per case: a saved route in one case must not decide another. */
function freshHome() {
  const home = makeHome('ourfairy-gateway-')
  homes.push(home)
  return home
}

/** Start one loopback Messages double and return it with the env that selects it. */
async function modelDouble(options = {}) {
  const server = await startMockLlmServer({ host: '127.0.0.1', port: 0, apiKey: 'mock-key', sequence: ['success'], ...options })
  servers.push(server)
  return { server, env: { OURFAIRY_MINIMAX_BASE_URL: `${server.baseURL}`, MINIMAX_CN_API_KEY: 'mock-key' } }
}

async function boot(home, env = {}, extra = {}) {
  const run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD, ...env, ...extra,
  })
  const port = startedPort(run)
  return { run, port, base: `http://127.0.0.1:${port}` }
}

async function stop(home) {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

async function signIn(port, name = 'phaethon', password = PHAETHON_PASSWORD) {
  return (await httpJson(port, '/identity/sign-in', { body: { name, password } })).token
}

async function inviteAndRegister(port, adminToken, name) {
  const invite = await httpJson(port, '/identity/invite', { token: adminToken })
  return httpJson(port, '/identity/register', { body: { inviteCode: invite.invite.code, name, password: `${name}-password` } })
}

/** Upload one small PNG through the product's own attachment routes. */
async function uploadImage(port, token, sessionId) {
  const { createHash } = await import('node:crypto')
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
  const { upload } = await httpJson(port, '/attachments/propose', { token, body: {
    sessionId, name: 'pixel.png', mime: 'image/png', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  } })
  const chunk = await fetch(`http://127.0.0.1:${port}/attachments/chunk`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream',
      'x-upload-id': upload.uploadId, 'x-upload-offset': '0' },
    body: bytes,
  })
  assert.equal(chunk.status, 200, await chunk.text())
  await httpJson(port, '/attachments/complete', { token, body: { uploadId: upload.uploadId } })
  return upload.uploadId
}

/** One route draft in the shape the phone sends. */
function minimaxRoute(baseURL, extra = {}) {
  return {
    provider: 'minimax-cn',
    displayName: 'MiniMax（中国站）',
    api: 'anthropic-messages',
    baseURL,
    apiKeyEnv: 'MINIMAX_API_KEY',
    models: [{ id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', contextWindow: 200000, input: ['text', 'image'] }],
    ...extra,
  }
}

/**
 * The `llm-pi-ai` route dictionary the phone's last save persisted.
 *
 * Read from the profile's user layer with dsh's own patch loader, so the
 * assertion sees the document that survives a restart rather than a value the
 * gateway happened to echo. Parsing the YAML here would be a second reader of
 * the same file and could agree with the writer while disagreeing with a boot.
 * @param {string} home - the isolated OURFAIRY_HOME the launcher booted with.
 * @returns {Record<string, any>} the saved providers dictionary.
 */
function savedProviders(home) {
  const patchPath = join(home, 'dsh-home', 'profiles', 'ourfairy', 'cordis.patch.yml')
  const boot = dshRequire('@deepseek-ai/dsh-app-boot')
  const row = boot.loadOverlayPatches('dsh', patchPath).find(entry => entry.id === 'llm-pi-ai')
  assert.ok(row?.config?.providers !== undefined, `${patchPath} must carry the saved llm-pi-ai providers row`)
  return row.config.providers
}

/**
 * One model entry of the deployment bundle exactly as the native schema
 * resolves it — the "previous entry" a phone save starts from. Resolving the
 * declaration instead of reading the live gateway means the expectation comes
 * from the deployment layer, not from the value under test.
 * @param {string} provider - route key in the bundle's `llm-pi-ai` row.
 * @param {string} id - model id to return.
 * @returns {Record<string, any>} the resolved model entry.
 */
function declaredModel(provider, id) {
  const boot = dshRequire('@deepseek-ai/dsh-app-boot')
  const bundle = join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml')
  const row = boot.loadOverlayPatches('dsh', bundle).flatMap(entry => entry.insert ?? []).find(entry => entry.id === 'llm-pi-ai')
  const declared = row.config.providers[provider].models.find(model => model.id === id)
  const resolved = dshRequire('@deepseek-ai/dsh-llm-pi-ai').Config({ providers: { [provider]: { models: [declared] } } })
  return resolved.providers.get()[provider].models[0]
}

/** One valid 16 kHz mono PCM WAV the speech route accepts. */
function wav() {
  const buffer = Buffer.alloc(364)
  buffer.write('RIFF'); buffer.writeUInt32LE(356, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(320, 40)
  return buffer
}

/** Wait until the session reports a running reply; that is the fact the guard reads. */
async function waitForRunning(port, token, sessionId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { projection } = await httpJson(port, '/chat/read', { token, body: { sessionId } })
    if (projection.replyStatus === 1) return projection
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`session ${sessionId} never reported a running reply`)
}

/** Wait until the session's projection reports the reply finished, and return it. */
async function settle(port, token, sessionId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { projection } = await httpJson(port, '/chat/read', { token, body: { sessionId } })
    if (projection.replyStatus === 0) return projection
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`session ${sessionId} did not settle within ${timeoutMs}ms`)
}

test('the gateway reads the shared configuration, refuses an ordinary agent, and survives a restart', async () => {
  const home = freshHome()
  const first = await modelDouble()
  const { port } = await boot(home, first.env)
  try {
    const admin = await signIn(port)
    const agent = await inviteAndRegister(port, admin, 'agent-one')

    for (const path of ['/gateway/read', '/gateway/selection', '/gateway/route', '/gateway/route/delete', '/gateway/asr']) {
      const anonymous = await httpJson(port, path, { body: {}, expect: false })
      assert.equal(anonymous.status, 401, `${path} must refuse an anonymous caller`)
      assert.equal(anonymous.json.error.code, 'gateway/unauthorized')
      const refused = await httpJson(port, path, { token: agent.token, body: {}, expect: false })
      assert.equal(refused.status, 403, `${path} must refuse an ordinary agent`)
      assert.equal(refused.json.error.code, 'gateway/forbidden')
    }

    const initial = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(initial.selection, { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash', reasoningEffort: 'max' })
    assert.equal(initial.selectionApplies, 'next-turn')
    assert.deepEqual(initial.saved, { selection: false, routes: false, asr: false })
    assert.deepEqual(initial.editable, { selection: true, routes: true, asr: true })
    assert.deepEqual(initial.routes.map(route => route.provider), ['deepseek-official', 'minimax-cn'])
    const official = initial.routes.find(route => route.provider === 'deepseek-official')
    assert.equal(official.editable, false, 'the official DeepSeek route is not the gateway\'s to redefine')
    assert.equal(official.credential.ref, 'DEEPSEEK_API_KEY')
    const deployment = initial.routes.find(route => route.provider === 'minimax-cn')
    assert.equal(deployment.editable, true, 'the deployment MiniMax route is editable')
    assert.equal(deployment.credential.ref, 'MINIMAX_CN_API_KEY')
    assert.equal(deployment.credential.configured, true, 'the launching environment supplies the reference')
    assert.equal(deployment.models[0].id, 'MiniMax-M3.1-Flash')
    assert.equal(initial.asr.credential.ref, 'VOICE_API_KEY')

    const saved = await httpJson(port, '/gateway/route', { token: admin, body: minimaxRoute('https://api.minimax.cn/anthropic') })
    assert.equal(saved.route.provider, 'minimax-cn')
    assert.equal(saved.route.declared, true)
    assert.equal(saved.route.credential.ref, 'MINIMAX_API_KEY')
    assert.equal(saved.route.credential.configured, false, 'an unset reference reports unconfigured instead of inventing a key')
    assert.deepEqual(saved.route.models.map(model => model.id), ['MiniMax-M3.1-Flash'])
    assert.deepEqual(saved.route.models[0].input, ['text', 'image'])
    assert.equal(saved.route.api, 'anthropic-messages')
    assert.equal(saved.route.baseURL, 'https://api.minimax.cn/anthropic')

    // Omitting the effort clears the profile override, which reveals the
    // composition's own `max` default; the echo reports the effective value.
    const selected = await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' } })
    assert.deepEqual(selected.selection, { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash', reasoningEffort: 'max' })
    assert.equal(selected.applies, 'next-turn')
    const lowered = await httpJson(port, '/gateway/selection', { token: admin,
      body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash', reasoningEffort: 'low' } })
    assert.equal(lowered.selection.reasoningEffort, 'low', 'an explicit effort is saved as given')
    const restored = await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' } })
    assert.equal(restored.selection.reasoningEffort, 'max', 'clearing the override falls back to the composition default')
    // Persist a non-default effort so the restart assertion proves the saved
    // row survives, rather than the composition default being re-read.
    await httpJson(port, '/gateway/selection', { token: admin,
      body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash', reasoningEffort: 'low' } })

    const selectedRoute = await httpJson(port, '/gateway/route/delete', { token: admin, body: { provider: 'minimax-cn' }, expect: false })
    assert.equal(selectedRoute.status, 409)
    assert.equal(selectedRoute.json.error.code, 'gateway/route-selected')

    const asr = await httpJson(port, '/gateway/asr', { token: admin, body: {
      model: 'FunAudioLLM/SenseVoiceSmall', endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions', maxDurationMs: 30000,
    } })
    assert.equal(asr.asr.maxDurationMs, 30000)
    assert.equal(asr.asr.timeoutMs, 45000, 'fields the write did not name keep their configured value')
  } finally {
    await stop(home)
  }

  const second = await modelDouble()
  const restarted = await boot(home, second.env)
  try {
    const admin = await signIn(restarted.port)
    const after = (await httpJson(restarted.port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(after.selection, { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash', reasoningEffort: 'low' },
      'the saved selection survives a restart')
    assert.deepEqual(after.saved, { selection: true, routes: true, asr: true })
    assert.ok(after.routes.some(route => route.provider === 'minimax-cn'), 'the saved route survives a restart')
    assert.equal(after.asr.maxDurationMs, 30000)
  } finally {
    await stop(home)
  }
})

test('an invalid configuration is refused with the reason, and nothing is persisted', async () => {
  const home = freshHome()
  const double = await modelDouble()
  const { port } = await boot(home, double.env)
  try {
    const admin = await signIn(port)
    const cases = [
      ['/gateway/selection', { provider: 'no-such-route', model: 'x' }, 'gateway/invalid-selection'],
      ['/gateway/selection', { provider: 'minimax-cn', model: 'no-such-model' }, 'gateway/invalid-selection'],
      ['/gateway/route', { provider: 'Not A Route', api: 'openai-completions', models: [{ id: 'm' }] }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', baseURL: 'not-a-url', api: 'openai-completions', models: [{ id: 'm' }] }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', api: 'openai-completions', models: [] }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', api: 'openai-completions', models: [{ id: 'm', input: ['audio'] }] }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', api: 'openai-completions', models: [{ id: 'm' }], unknownField: true }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'deepseek-official', api: 'openai-completions', models: [{ id: 'm' }] }, 'gateway/invalid-route'],
      ['/gateway/route/delete', { provider: 'missing-route' }, 'gateway/unknown-route'],
      ['/gateway/asr', { model: 'm', endpoint: 'not-a-url' }, 'gateway/invalid-asr'],
      ['/gateway/asr', { model: 'm', endpoint: 'https://asr.example/v1', maxAudioBytes: 0 }, 'gateway/invalid-asr'],
    ]
    for (const [path, body, code] of cases) {
      const response = await httpJson(port, path, { token: admin, body, expect: false })
      assert.ok(response.status >= 400 && response.status < 500, `${path} ${JSON.stringify(body)} answered ${response.status}`)
      assert.equal(response.json.error.code, code, `${path} ${JSON.stringify(body)}: ${response.text}`)
    }
    const state = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(state.saved, { selection: false, routes: false, asr: false }, 'a refused write persists nothing')
    assert.deepEqual(state.routes.map(route => route.provider), ['deepseek-official', 'minimax-cn'],
      'a refused write leaves the deployment route in place')
  } finally {
    await stop(home)
  }
})

test('the shared selection applies from the next turn, and a running reply keeps its original model', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['tool_call_success', 'success', 'success'],
    toolName: 'todo_write', toolArguments: '{"todos":[{"content":"pause","status":"in_progress"}]}' })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    // The MiniMax route points at the same double so the switch is observable:
    // the request body names the model each step actually selected.
    await httpJson(port, '/gateway/route', { token: admin, body: minimaxRoute(`${double.server.baseURL}/v1`) })
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })

    // The bash tool is the "tool pause": its result returns to the same turn.
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'turn-one',
      text: 'first request' } })
    await waitForRunning(port, admin, session.id)

    const switched = await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' } })
    assert.equal(switched.applies, 'next-turn')

    const projection = await settle(port, admin, session.id)
    assert.ok(projection.messages.some(message => message.role === 2), 'the reply completes after the tool step')
    assert.ok(double.server.requests.length >= 2, `the tool-continuation step must make another model request; requests: ${double.server.requests.length}`)
    // Every request of that turn named the route it started on, including the
    // continuation after the tool pause; the durable header records the same.
    const models = double.server.requests.map(request => request.body?.model)
    assert.ok(models.length >= 2, `each model step names its model; got ${JSON.stringify(models)}`)
    assert.deepEqual([...new Set(models)], ['MiniMax-M3.1-Flash'],
      `a turn that began before the switch keeps its original model, including after the tool pause; got ${JSON.stringify(models)}`)

    const inUse = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.deepEqual(inUse.inUse, [], 'no reply is running after the turn settles')

    // The next turn reads the saved selection. The tool double's next scripted
    // behavior is a plain success, so this turn makes exactly one request.
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'turn-two', text: 'second request' } })
    await settle(port, admin, session.id)
    assert.equal(double.server.requests.at(-1).body?.model, 'MiniMax-M3.1-Flash',
      `the next turn must adopt the saved selection; got ${JSON.stringify(double.server.requests.map(request => request.body?.model))}`)

    // A second session and a session that only exists on disk (never resumed in
    // this process) must adopt the same saved selection on their next turn.
    const { session: second } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: second.id, requestId: 'second-session', text: 'another session' } })
    await settle(port, admin, second.id)
    assert.equal(double.server.requests.at(-1).body?.model, 'MiniMax-M3.1-Flash',
      'a session opened after the switch adopts the saved selection')

    // Queued input: accepted while a reply runs, executed by a later turn, which
    // re-reads the selection at its own turn start.
    await stop(home)
    const cold = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
    try {
      const adminAgain = await signIn(cold.port)
      await httpJson(cold.port, '/chat/send', { token: adminAgain, body: { sessionId: second.id, requestId: 'cold-turn', text: 'after restart' } })
      await settle(cold.port, adminAgain, second.id)
      assert.equal(double.server.requests.at(-1).body?.model, 'MiniMax-M3.1-Flash',
        'a session recovered from disk after a restart adopts the saved selection')
    } finally {
      await stop(home)
    }
  } finally {
    await stop(home)
  }
})

test('the attachment capability check follows the selection the next turn will execute', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['tool_call_success', 'success', 'success'], repeatLast: true,
    toolName: 'bash', toolArguments: '{"command":"sleep 2","description":"hold the turn open"}' })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    const textOnly = { provider: 'text-only', displayName: 'Text only', api: 'anthropic-messages',
      baseURL: `${double.server.baseURL}/v1`, apiKeyEnv: 'MINIMAX_API_KEY', models: [{ id: 'text-1', name: 'Text One', input: ['text'] }] }
    await httpJson(port, '/gateway/route', { token: admin, body: textOnly })
    await httpJson(port, '/gateway/route', { token: admin, body: minimaxRoute(`${double.server.baseURL}/v1`) })

    // 1. The next turn's selection decides: text-only refuses an image at send.
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'text-only', model: 'text-1' } })
    const refusedUpload = await uploadImage(port, admin, session.id)
    const refused = await httpJson(port, '/chat/send', { token: admin, expect: false,
      body: { sessionId: session.id, requestId: 'text-image', text: '', uploadIds: [refusedUpload] } })
    assert.equal(refused.status, 400, refused.text)
    assert.equal(refused.json.error.code, 'attachments/image-unsupported')

    // 2. An image accepted under an image-capable selection, but queued past a
    // switch to text-only, must fail its turn loudly rather than be silently
    // projected to text by the native adapter.
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' } })
    const queuedUpload = await uploadImage(port, admin, session.id)
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'running', text: 'hold' } })
    await waitForRunning(port, admin, session.id)
    const queued = await httpJson(port, '/chat/send', { token: admin, expect: false,
      body: { sessionId: session.id, requestId: 'queued-image', text: '', uploadIds: [queuedUpload] } })
    assert.equal(queued.status, 200, queued.text)
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'text-only', model: 'text-1' } })

    const deadline = Date.now() + 60000
    let projection
    while (Date.now() < deadline) {
      projection = (await httpJson(port, '/chat/read', { token: admin, body: { sessionId: session.id } })).projection
      if (projection.replyStatus === 0 && projection.error) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.match(projection.error ?? '', /不接受图片输入/, `the queued image must be refused loudly; got ${JSON.stringify(projection.error)}`)
  } finally {
    await stop(home)
  }
})

test('a route a running reply uses refuses the change, and the retry succeeds once it ends', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['tool_call_success', 'success'],
    toolName: 'todo_write', toolArguments: '{"todos":[{"content":"pause","status":"in_progress"}]}' })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    await httpJson(port, '/gateway/route', { token: admin, body: minimaxRoute(`${double.server.baseURL}/v1`) })
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' } })
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'running', text: 'first request' } })
    await waitForRunning(port, admin, session.id)

    const refused = await httpJson(port, '/gateway/route', { token: admin, expect: false,
      body: minimaxRoute('https://api.minimax.cn/other') })
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.json.error.code, 'chat/route-in-use')
    assert.match(refused.json.error.message, /minimax-cn/)

    const deleting = await httpJson(port, '/gateway/route/delete', { token: admin, body: { provider: 'minimax-cn' }, expect: false })
    assert.equal(deleting.status, 409)
    assert.equal(deleting.json.error.code, 'gateway/route-selected')

    await settle(port, admin, session.id)
    const retried = await httpJson(port, '/gateway/route', { token: admin, body: minimaxRoute('https://api.minimax.cn/other') })
    assert.equal(retried.route.baseURL, 'https://api.minimax.cn/other')
  } finally {
    await stop(home)
  }
})

test('a route saved from the phone keeps the deployment retry policy the draft does not own', async () => {
  const home = freshHome()
  // The double answers one rate limit then succeeds: only a route that still
  // carries the deployment's `retryPolicy` recovers within the turn. The
  // sequence covers the two boots of this case, so no replay option is needed.
  const double = await modelDouble({ sequence: ['rate_limit', 'success', 'rate_limit', 'success'], successText: 'recovered after the save' })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    const saved = await httpJson(port, '/gateway/route', { token: admin, body: minimaxRoute(`${double.server.baseURL}/v1`) })
    assert.equal(saved.route.provider, 'minimax-cn')
    assert.equal(saved.route.baseURL, `${double.server.baseURL}/v1`)

    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'after-save', text: 'retry after the save' } })
    const projection = await settle(port, admin, session.id)
    assert.deepEqual(double.server.requests.map(request => request.behavior), ['rate_limit', 'success'],
      'the saved route still executes the deployment retry policy; without it the turn ends on the 429')
    assert.equal(projection.error, null)
    assert.deepEqual(projection.messages.filter(message => message.role === 2 && message.status === 2).map(message => message.text),
      ['recovered after the save'])
    assert.equal(projection.events.filter(event => event.type === 'llm/retry').length, 1,
      'the retry went through the native row, not a second policy the gateway invented')
  } finally {
    await stop(home)
  }

  // The saved route is persisted, not just held live: after a restart the same
  // double answers the saved base URL, and the policy still comes from the
  // deployment layer the draft never writes.
  const restarted = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(restarted.port)
    const { session } = await httpJson(restarted.port, '/sessions/create', { token: admin, body: {} })
    await httpJson(restarted.port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'after-save-cold', text: 'retry after the restart' } })
    const projection = await settle(restarted.port, admin, session.id)
    assert.deepEqual(double.server.requests.map(request => request.behavior).slice(-2), ['rate_limit', 'success'],
      'the saved route keeps the deployment retry policy across a restart')
    assert.equal(projection.error, null)
  } finally {
    await stop(home)
  }
})

test('a route saved from the phone keeps model fields the draft does not edit', async () => {
  const home = freshHome()
  const double = await modelDouble()
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    // The deployment's own entry is the "previous entry" the save starts from.
    // Its fields outside the phone's editable set are the expectation; when the
    // deployment (or upstream) adds another one, this list grows by itself.
    const previous = declaredModel('minimax-cn', 'MiniMax-M3.1-Flash')
    const unedited = Object.entries(previous).filter(([field]) => !PHONE_MODEL_FIELDS.has(field))
    assert.ok(unedited.length >= 2, `the deployment model must declare fields the phone cannot edit; got ${JSON.stringify(previous)}`)

    // The draft supplies `maxTokens` and omits the deployment's `contextWindow`:
    // supplied fields overwrite, omitted ones are cleared rather than inherited.
    const first = minimaxRoute(`${double.server.baseURL}/v1`)
    first.models = [{ id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', maxTokens: 8192, input: ['text', 'image'] }]
    await httpJson(port, '/gateway/route', { token: admin, body: first })

    const saved = savedProviders(home)['minimax-cn']
    assert.equal(saved.retryPolicy, undefined,
      'the route-level deployment retry policy stays in the deployment layer; a save must not copy it into the user layer')
    const [savedModel] = saved.models
    assert.equal(savedModel.contextWindow, undefined, 'an editable field the draft omits is cleared, not inherited from the previous entry')
    assert.equal(savedModel.maxTokens, 8192, 'an editable field the draft supplies overwrites the previous entry')
    for (const [field, value] of unedited) {
      assert.deepEqual(savedModel[field], value,
        `model field "${field}" the draft does not edit must survive the save unchanged`)
    }

    // A second save: `maxTokens` is now omitted too, so the previous user-layer
    // value must be cleared as well, and a brand-new model id has no previous
    // entry to inherit deployment fields from.
    const second = minimaxRoute(`${double.server.baseURL}/v1`)
    second.models = [
      { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', input: ['text', 'image'] },
      { id: 'MiniMax-other', name: 'Other', input: ['text'] },
    ]
    await httpJson(port, '/gateway/route', { token: admin, body: second })

    const resaved = savedProviders(home)['minimax-cn']
    const [resavedModel, addedModel] = resaved.models
    assert.equal(resavedModel.maxTokens, undefined, 'a field the previous user-layer entry declared is cleared when the draft omits it')
    for (const [field, value] of unedited) {
      assert.deepEqual(resavedModel[field], value,
        `model field "${field}" the draft does not edit must survive a later save unchanged`)
    }
    assert.deepEqual(addedModel, { id: 'MiniMax-other', name: 'Other', input: ['text'] },
      'a new model id is stored exactly as the draft declares it, with no deployment fields borrowed from a sibling')
  } finally {
    await stop(home)
  }
})

test('a model-scoped edit is refused only while a reply still uses that model', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['tool_call_success', 'success'],
    toolName: 'todo_write', toolArguments: '{"todos":[{"content":"pause","status":"in_progress"}]}' })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    const twoModels = minimaxRoute(`${double.server.baseURL}/v1`)
    twoModels.models = [...twoModels.models, { id: 'MiniMax-other', name: 'Other', input: ['text'] }]
    await httpJson(port, '/gateway/route', { token: admin, body: twoModels })
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' } })
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'scoped', text: 'first request' } })
    await waitForRunning(port, admin, session.id)

    // A different model on the same route is not what the running reply uses.
    const unrelated = minimaxRoute(`${double.server.baseURL}/v1`)
    unrelated.models = [...unrelated.models, { id: 'MiniMax-other', name: 'Other renamed', input: ['text'] }]
    const allowed = await httpJson(port, '/gateway/route', { token: admin, expect: false, body: unrelated })
    assert.equal(allowed.status, 200, allowed.text)

    // The running reply's own model is still protected.
    const used = minimaxRoute(`${double.server.baseURL}/v1`)
    used.models = [{ ...used.models[0], contextWindow: 128000 }, { id: 'MiniMax-other', name: 'Other renamed', input: ['text'] }]
    const refused = await httpJson(port, '/gateway/route', { token: admin, expect: false, body: used })
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.json.error.code, 'chat/route-in-use')
    await settle(port, admin, session.id)
  } finally {
    await stop(home)
  }
})

test('the shared ASR connection is edited through the gateway and the next recording uses it', async () => {
  const home = freshHome()
  const provider = (await import('node:http')).createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ text: '编辑后的转写' }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const { port } = await boot(home, { VOICE_API_KEY: 'voice-only-test' })
  try {
    const admin = await signIn(port)
    const saved = await httpJson(port, '/gateway/asr', { token: admin, body: {
      model: 'FunAudioLLM/SenseVoiceSmall',
      endpoint: `http://127.0.0.1:${provider.address().port}/transcribe`,
      maxAudioBytes: 500,
    } })
    assert.equal(saved.asr.endpoint, `http://127.0.0.1:${provider.address().port}/transcribe`)
    assert.equal(saved.asr.available, true)
    // The launching environment wins over the writable store, so this reference
    // is configured and read-only: an edit would appear to save and then resolve
    // the inherited value anyway.
    assert.deepEqual(saved.asr.credential, { ref: 'VOICE_API_KEY', configured: true, writable: false, source: 'env' })

    const available = await httpJson(port, '/speech', { method: 'GET', token: admin, expect: false })
    assert.equal(available.status, 200, available.text)
    assert.equal(available.json.maxAudioBytes, 500, 'the transcription route reads the edited row, not the boot value')
    assert.equal(available.json.model, undefined, 'the recording route exposes availability and budget only; the connection itself belongs to the gateway')
    const gateway = (await httpJson(port, '/gateway/read', { token: admin, body: {} })).gateway
    assert.equal(gateway.asr.model, 'FunAudioLLM/SenseVoiceSmall', 'the gateway is where the connection is shown')

    const transcription = await fetch(`http://127.0.0.1:${port}/speech/transcriptions`, {
      method: 'POST', headers: { authorization: `Bearer ${admin}`, 'content-type': 'audio/wav' }, body: wav(),
    })
    const body = await transcription.text()
    assert.equal(transcription.status, 200, body)
    assert.deepEqual(JSON.parse(body), { ok: true, text: '编辑后的转写' },
      'the next recording reaches the edited endpoint')
  } finally {
    await stop(home)
    provider.closeAllConnections()
    await new Promise(resolve => provider.close(resolve))
  }
})

test('the probe reports the gateway services as live in the shipped composition', async () => {
  const home = freshHome()
  const double = await modelDouble()
  const reportPath = join(home, 'gateway-probe-report.json')
  const run = await runBackendAsync(['probe', '--report', reportPath], {
    OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD, ...double.env,
  })
  assert.equal(run.code, 0, describeRun('probe', run))
  const report = readReport(reportPath)
  assert.deepEqual(report.failures, [])
  const rows = new Set(report.rows.map(row => row.id))
  for (const row of ['settings', 'config-editor', 'llm-pi-ai', 'gateway']) assert.ok(rows.has(row), `row ${row} must be composed`)
  for (const service of ['settings', 'configEditor', 'agentDefaultModel', 'ourfairyChat', 'ourfairyGateway']) {
    assert.equal(report.services[service]?.live, true, `service ${service} must be live`)
  }
})
