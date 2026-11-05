/**
 * @covers backend/speech — this suite drives the speech route through the
 * launcher rather than importing the package.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { describeRun, httpJson, makeHome, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'

test('authenticated speech availability stays unavailable without the separate voice key', async () => {
  const home = makeHome('ourfairy-speech-keyless-')
  try {
    const started = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: 'speech-password', VOICE_API_KEY: undefined })
    const base = `http://127.0.0.1:${startedPort(started)}`
    const anonymous = await fetch(base + '/speech')
    assert.equal(anonymous.status, 401)
    const signed = await fetch(base + '/identity/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'phaethon', password: 'speech-password' }) }).then(r => r.json())
    const response = await fetch(base + '/speech', { headers: { authorization: `Bearer ${signed.token}` } })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).available, false)
    const refused = await fetch(base + '/speech/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${signed.token}`, 'content-type': 'audio/wav' }, body: wav() })
    assert.equal(refused.status, 503)
    assert.equal((await refused.json()).error.code, 'speech/unavailable')
  } finally {
    const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
    assert.equal(stopped.code, 0, describeRun('stop', stopped))
    removeHome(home)
  }
})

function wav() {
  const b = Buffer.alloc(364)
  b.write('RIFF'); b.writeUInt32LE(356, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16,16)
  b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28)
  b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(320,40)
  return b
}
test('speech proxy uses configured provider, returns editable text, and reports actual failures', async () => {
  const calls = []; let mode = 'ok'
  const provider = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c)
    calls.push({ auth: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
    if (mode === 'hold') { provider.emit('held', res); return }
    res.writeHead(mode === 'busy' ? 429 : mode === 'failed' ? 503 : 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ text: mode === 'empty' ? '' : '可编辑转写' }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const home = makeHome('ourfairy-speech-provider-')
  try {
    const started = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: 'speech-password', VOICE_API_KEY: 'voice-only-test', OURFAIRY_ASR_MODEL: 'configured-test-model', OURFAIRY_ASR_ENDPOINT: `http://127.0.0.1:${provider.address().port}/transcribe`, OURFAIRY_ASR_TIMEOUT_MS: '30000', OURFAIRY_ASR_MAX_AUDIO_BYTES: '500' })
    const base = `http://127.0.0.1:${startedPort(started)}`
    const signed = await fetch(base + '/identity/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'phaethon', password: 'speech-password' }) }).then(r => r.json())
    const headers = { authorization: `Bearer ${signed.token}`, 'content-type': 'audio/wav' }
    assert.equal((await fetch(base + '/speech/transcriptions', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav() })).status, 401)
    const available = await fetch(base + '/speech', { headers }).then(response => response.json())
    assert.equal(available.available, true)
    assert.equal(available.maxAudioBytes, 500)
    const transcribe = (body = wav(), signal) => fetch(base + '/speech/transcriptions', { method: 'POST', headers, body, signal })
    assert.deepEqual(await (await transcribe()).json(), { ok: true, text: '可编辑转写' })
    assert.equal(calls[0].auth, 'Bearer voice-only-test'); assert.match(calls[0].body, /configured-test-model/)
    assert.equal((await transcribe(Buffer.from('bad wav'))).status, 400)
    assert.equal((await transcribe(Buffer.alloc(501))).status, 413)
    for (const [value, status, code] of [['empty',422,'no-match'],['busy',429,'busy'],['failed',502,'failed']]) {
      mode = value; const result = await transcribe(); assert.equal(result.status, status)
      assert.equal((await result.json()).error.code, 'speech/' + code)
    }
    mode = 'hold'
    const received = once(provider, 'held', { signal: AbortSignal.timeout(10_000) })
    const controller = new AbortController()
    const pending = transcribe(wav(), controller.signal)
    const cancelled = assert.rejects(pending, { name: 'AbortError' })
    try {
      const [upstream] = await received
      const disconnected = once(upstream, 'close', { signal: AbortSignal.timeout(10_000) })
      assert.equal((await transcribe()).status, 429, 'a received request holds the one-shot budget')
      controller.abort()
      await cancelled
      await disconnected
    } finally {
      controller.abort()
      await cancelled
    }
    // The upstream disconnect and the backend's finally block run in different
    // processes. Retry only the observable busy response until that release.
    mode = 'ok'
    const deadline = Date.now() + 5_000
    let status = 429
    while (status === 429 && Date.now() < deadline) {
      status = (await transcribe()).status
      if (status === 429) await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(status, 200, 'cancel releases this one-shot ASR budget')

    // Only this case uses a short deadline. The provider never answers, so no
    // provider timer can win against the timeout being tested.
    await httpJson(startedPort(started), '/gateway/asr', { token: signed.token, body: {
      model: 'configured-test-model', endpoint: `http://127.0.0.1:${provider.address().port}/transcribe`, timeoutMs: 150,
    } })
    mode = 'hold'
    const timedOut = await transcribe()
    assert.equal(timedOut.status, 504)
    assert.equal((await timedOut.json()).error.code, 'speech/timeout')
  } finally {
    await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home }); removeHome(home)
    provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve))
  }
})
