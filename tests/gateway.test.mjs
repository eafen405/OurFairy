/**
 * Ticket #43 acceptance: Phaethon's shared-configuration gateway over the real
 * backend.
 *
 * Every case drives the shipped launcher and speaks HTTP to the listener it
 * bound: the native profile settings row, the native credential seam and the
 * product chat runtime are the real ones. The external model is a loopback
 * Messages-protocol double selected through `DEEPSEEK_BASE_URL`, exactly as the
 * baseline probe suite does; that is a model double, not a claim about a real
 * provider.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, readReport, removeHome, repoRoot, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'

const PHAETHON_PASSWORD = 'gateway-password'
const combo = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(join(repoRoot, 'combo.json'), 'utf8')))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))

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
  return { server, env: { DEEPSEEK_BASE_URL: `${server.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key' } }
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

/** One route save with a valid, template-shaped profile. */
function minimaxProfile(baseURL, extra = {}) {
  return {
    provider: 'minimax-cn',
    profile: {
      displayName: 'MiniMax（中国站）',
      api: 'anthropic-messages',
      baseURL,
      apiKeyEnv: 'MINIMAX_API_KEY',
      models: [{ id: 'MiniMax-M3.1-Flash-Preview', name: 'MiniMax M3.1 Flash Preview', contextWindow: 200000, input: ['text', 'image'] }],
      ...extra,
    },
  }
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

    const initial = await httpJson(port, '/gateway/read', { token: admin, body: {} })
    assert.deepEqual(initial.selection, { provider: 'deepseek-official', model: 'deepseek-flash' })
    assert.equal(initial.selectionApplies, 'next-turn')
    assert.deepEqual(initial.saved, { selection: false, routes: false, asr: false })
    assert.deepEqual(initial.editable, { selection: true, routes: true, asr: true, reason: null })
    assert.deepEqual(initial.routes.map(route => route.provider), ['deepseek-official'])
    const official = initial.routes[0]
    assert.equal(official.editable, false, 'the official DeepSeek route is not the gateway\'s to redefine')
    assert.equal(official.credential.ref, 'DEEPSEEK_API_KEY')
    assert.equal(official.credential.configured, true, 'the launching environment supplies the reference')
    assert.ok(initial.templates.some(template => template.provider === 'minimax-cn'), 'the MiniMax path is offered as an editable draft')
    assert.equal(initial.asr.credential.ref, 'VOICE_API_KEY')

    const saved = await httpJson(port, '/gateway/route', { token: admin, body: minimaxProfile('https://api.minimax.cn/anthropic') })
    assert.equal(saved.route.provider, 'minimax-cn')
    assert.equal(saved.route.declared, true)
    assert.equal(saved.route.credential.ref, 'MINIMAX_API_KEY')
    assert.equal(saved.route.credential.configured, false, 'an unset reference reports unconfigured instead of inventing a key')
    assert.deepEqual(saved.route.models.map(model => model.id), ['MiniMax-M3.1-Flash-Preview'])

    const selected = await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' } })
    assert.deepEqual(selected.selection, { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' })
    assert.equal(selected.applies, 'next-turn')

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
    const after = await httpJson(restarted.port, '/gateway/read', { token: admin, body: {} })
    assert.deepEqual(after.selection, { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' }, 'the saved selection survives a restart')
    assert.deepEqual(after.saved, { selection: true, routes: true, asr: true })
    assert.ok(after.routes.some(route => route.provider === 'minimax-cn'), 'the saved route survives a restart')
    assert.equal(after.asr.maxDurationMs, 30000)
    assert.deepEqual(after.templates, [], 'a route that is already configured is no longer offered as a draft')
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
      ['/gateway/selection', { provider: 'deepseek-official', model: 'no-such-model' }, 'gateway/invalid-selection'],
      ['/gateway/route', { provider: 'Not A Route', profile: {} }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', profile: { baseURL: 'not-a-url', api: 'openai-completions', models: [{ id: 'm' }] } }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', profile: { api: 'openai-completions', models: [] } }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', profile: { api: 'openai-completions', models: [{ id: 'm', input: ['audio'] }] } }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'acme', profile: { api: 'openai-completions', models: [{ id: 'm' }], unknownField: true } }, 'gateway/invalid-route'],
      ['/gateway/route', { provider: 'deepseek-official', profile: { api: 'openai-completions', models: [{ id: 'm' }] } }, 'gateway/invalid-route'],
      ['/gateway/route/delete', { provider: 'missing-route' }, 'gateway/unknown-route'],
      ['/gateway/asr', { model: 'm', endpoint: 'not-a-url' }, 'gateway/invalid-asr'],
      ['/gateway/asr', { model: 'm', endpoint: 'https://asr.example/v1', maxAudioBytes: 0 }, 'gateway/invalid-asr'],
    ]
    for (const [path, body, code] of cases) {
      const response = await httpJson(port, path, { token: admin, body, expect: false })
      assert.ok(response.status >= 400 && response.status < 500, `${path} ${JSON.stringify(body)} answered ${response.status}`)
      assert.equal(response.json.error.code, code, `${path} ${JSON.stringify(body)}: ${response.text}`)
    }
    const state = await httpJson(port, '/gateway/read', { token: admin, body: {} })
    assert.deepEqual(state.saved, { selection: false, routes: false, asr: false }, 'a refused write persists nothing')
    assert.deepEqual(state.routes.map(route => route.provider), ['deepseek-official'])
  } finally {
    await stop(home)
  }
})

test('the shared selection applies from the next turn, and a running reply keeps its original model', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['tool_call_success', 'success', 'success'] })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    // The MiniMax route points at the same double so the switch is observable:
    // the request body names the model each step actually selected.
    await httpJson(port, '/gateway/route', { token: admin, body: minimaxProfile(`${double.server.baseURL}/v1`) })
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })

    // The bash tool is the "tool pause": its result returns to the same turn.
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'turn-one',
      text: 'first request' } })
    await waitForRunning(port, admin, session.id)

    const switched = await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' } })
    assert.equal(switched.applies, 'next-turn')

    const projection = await settle(port, admin, session.id)
    assert.ok(projection.messages.some(message => message.role === 2), 'the reply completes after the tool step')
    assert.ok(double.server.requests.length >= 2, `the tool-continuation step must make another model request; requests: ${double.server.requests.length}`)
    // Every request of that turn named the route it started on, including the
    // continuation after the tool pause; the durable header records the same.
    const models = double.server.requests.map(request => request.body?.model)
    assert.ok(models.length >= 2, `each model step names its model; got ${JSON.stringify(models)}`)
    assert.deepEqual([...new Set(models)], ['deepseek-flash'],
      `a turn that began before the switch keeps its original model, including after the tool pause; got ${JSON.stringify(models)}`)

    const inUse = await httpJson(port, '/gateway/read', { token: admin, body: {} })
    assert.deepEqual(inUse.inUse, [], 'no reply is running after the turn settles')

    // The next turn reads the saved selection. The tool double's next scripted
    // behavior is a plain success, so this turn makes exactly one request.
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'turn-two', text: 'second request' } })
    await settle(port, admin, session.id)
    assert.equal(double.server.requests.at(-1).body?.model, 'MiniMax-M3.1-Flash-Preview',
      `the next turn must adopt the saved selection; got ${JSON.stringify(double.server.requests.map(request => request.body?.model))}`)
  } finally {
    await stop(home)
  }
})

test('the attachment capability check follows the selection the next turn will execute', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['success', 'success'] })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    const textOnly = { provider: 'text-only', profile: { displayName: 'Text only', api: 'anthropic-messages',
      baseURL: `${double.server.baseURL}/v1`, apiKeyEnv: 'MINIMAX_API_KEY', models: [{ id: 'text-1', name: 'Text One', input: ['text'] }] } }
    await httpJson(port, '/gateway/route', { token: admin, body: textOnly })
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'text-only', model: 'text-1' } })

    const refusedUpload = await uploadImage(port, admin, session.id)
    const refused = await httpJson(port, '/chat/send', { token: admin, expect: false,
      body: { sessionId: session.id, requestId: 'text-image', text: '', uploadIds: [refusedUpload] } })
    assert.equal(refused.status, 400, refused.text)
    assert.equal(refused.json.error.code, 'attachments/image-unsupported')

    await httpJson(port, '/gateway/route', { token: admin, body: minimaxProfile(`${double.server.baseURL}/v1`) })
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' } })
    const acceptedUpload = await uploadImage(port, admin, session.id)
    const accepted = await httpJson(port, '/chat/send', { token: admin, expect: false,
      body: { sessionId: session.id, requestId: 'vision-image', text: '', uploadIds: [acceptedUpload] } })
    assert.equal(accepted.status, 200, accepted.text)
    await settle(port, admin, session.id)
  } finally {
    await stop(home)
  }
})

test('a route a running reply uses refuses the change, and the retry succeeds once it ends', async () => {
  const home = freshHome()
  const double = await modelDouble({ sequence: ['tool_call_success', 'success'] })
  const { port } = await boot(home, { ...double.env, MINIMAX_API_KEY: 'mock-key' })
  try {
    const admin = await signIn(port)
    await httpJson(port, '/gateway/route', { token: admin, body: minimaxProfile(`${double.server.baseURL}/v1`) })
    await httpJson(port, '/gateway/selection', { token: admin, body: { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash-Preview' } })
    const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
    await httpJson(port, '/chat/send', { token: admin, body: { sessionId: session.id, requestId: 'running', text: 'first request' } })
    await waitForRunning(port, admin, session.id)

    const refused = await httpJson(port, '/gateway/route', { token: admin, expect: false,
      body: minimaxProfile('https://api.minimax.cn/other') })
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.json.error.code, 'chat/route-in-use')
    assert.match(refused.json.error.message, /minimax-cn/)

    const deleting = await httpJson(port, '/gateway/route/delete', { token: admin, body: { provider: 'minimax-cn' }, expect: false })
    assert.equal(deleting.status, 409)
    assert.equal(deleting.json.error.code, 'gateway/route-selected')

    await settle(port, admin, session.id)
    const retried = await httpJson(port, '/gateway/route', { token: admin, body: minimaxProfile('https://api.minimax.cn/other') })
    assert.equal(retried.route.profile.baseURL, 'https://api.minimax.cn/other')
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
    assert.equal(available.json.model, 'FunAudioLLM/SenseVoiceSmall')
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
