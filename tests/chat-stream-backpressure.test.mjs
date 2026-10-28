import assert from 'node:assert/strict'
import http from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { createGunzip } from 'node:zlib'
import { httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { startTitleAwareModel } from './helpers/title-aware.mjs'

test('a backpressured SSE observer catches up without replaying superseded reply snapshots', async () => {
  const historyTurns = 40
  const reply = 'A fixed streaming reply. '.repeat(100).slice(0, 2048)
  const fragmentCount = reply.length / 8
  const home = makeHome('ourfairy-stream-pressure-')
  const model = await startTitleAwareModel({ host: '127.0.0.1', port: 0, apiKey: 'mock-key',
    sequence: [...Array(historyTurns).fill('success'), 'slow_success'],
    // Exceed the shared 32 ms publication window so cadence cannot mask transport backlog.
    successText: reply, chunkSize: 8, chunkDelayMs: 40 })
  // Forty history turns stay below the maintenance threshold; this file tests
  // the transport, so no maintenance child may consume the scripted model
  // sequence.
  const env = { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: 'pressure-password',
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: model.baseURL,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50' }
  let call
  async function until(read, predicate) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const value = await read()
      if (predicate(value)) return value
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('stream did not settle')
  }
  try {
    const port = startedPort(await runBackendAsync(startArgs(), env))
    const admin = await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: 'pressure-password' } })
    const { token } = await registerUser(port, admin.token, 'pressure-reader')
    const { session } = await httpJson(port, '/sessions/create', { token })
    const read = () => httpJson(port, '/chat/read', { token, body: { sessionId: session.id } })
    for (let index = 0; index < historyTurns; index++) {
      const { receipt } = await httpJson(port, '/chat/send', { token,
        body: { sessionId: session.id, requestId: `history-${index}`, text: `history ${index}` } })
      await until(read, value => value.projection.replyStatus === 0
        && value.projection.messages.some(message => message.role === 2 && message.seq > receipt.acceptedSeq))
    }
    const body = JSON.stringify({ sessionId: session.id })
    const response = await new Promise((resolve, reject) => {
      call = http.request({ host: '127.0.0.1', port, path: '/chat/observe', method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'content-length': Buffer.byteLength(body) } }, resolve)
      call.on('error', reject)
      call.end(body)
    })
    assert.equal(response.statusCode, 200)
    // Pausing the real TCP reader fills the transport buffers while generation continues.
    response.pause()
    response.setEncoding('utf8')
    const { receipt } = await httpJson(port, '/chat/send', { token,
      body: { sessionId: session.id, requestId: 'stream', text: 'stream while the reader is paused' } })
    await until(read, value => value.projection.replyStatus === 0
      && value.projection.messages.some(message => message.role === 2 && message.seq > receipt.acceptedSeq))

    let advancingFrames = 0
    const terminal = await new Promise((resolve, reject) => {
      let pending = ''
      const timer = setTimeout(() => reject(new Error('observer did not catch up')), 30_000)
      response.on('error', error => { clearTimeout(timer); reject(error) })
      response.on('data', chunk => {
        pending += chunk
        let split
        while ((split = pending.indexOf('\n\n')) >= 0) {
          const event = pending.slice(0, split)
          pending = pending.slice(split + 2)
          const data = event.split('\n').find(line => line.startsWith('data: '))
          if (!data) continue
          const projection = JSON.parse(data.slice(6))
          if (projection.attempt?.text.length) advancingFrames++
          if (projection.replyStatus === 0 && projection.cursor > receipt.acceptedSeq) {
            clearTimeout(timer)
            resolve(projection)
          }
        }
      })
      response.resume()
    })
    const final = terminal.messages.find(message => message.role === 2 && message.seq > receipt.acceptedSeq)
    assert.equal(final.text, reply)
    assert.equal(final.status, 2)
    assert.equal(terminal.attempt, null)
    console.log(`SSE_BACKPRESSURE fragments=${fragmentCount} advancingFrames=${advancingFrames}`)
    assert.ok(advancingFrames < fragmentCount / 2,
      `a stalled reader replayed ${advancingFrames} text frames from ${fragmentCount} fragments`)

    for (const encoding of ['gzip', 'gzip;q=0, identity']) {
      const opening = await new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, path: '/chat/observe', method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`,
            'content-length': Buffer.byteLength(body), 'accept-encoding': encoding } }, incoming => {
          try {
            assert.equal(incoming.headers['content-encoding'], encoding === 'gzip' ? 'gzip' : undefined)
          } catch (error) {
            incoming.destroy()
            reject(error)
            return
          }
          const reader = encoding === 'gzip' ? incoming.pipe(createGunzip()) : incoming
          reader.setEncoding('utf8')
          const timer = setTimeout(() => { request.destroy(); reject(new Error('opening frame was not flushed')) }, 5000)
          let pending = ''
          reader.on('error', error => { clearTimeout(timer); reject(error) })
          reader.on('data', chunk => {
            pending += chunk
            const split = pending.indexOf('\n\n')
            if (split < 0) return
            clearTimeout(timer)
            const data = pending.slice(0, split).split('\n').find(line => line.startsWith('data: '))
            request.destroy()
            resolve(JSON.parse(data.slice(6)))
          })
        })
        request.on('error', reject)
        request.end(body)
      })
      assert.equal(opening.messages.at(-1).text, reply)
      assert.equal(opening.replyStatus, 0)
    }
  } finally {
    call?.destroy()
    await runBackendAsync(['stop', '--json'], env)
    await model.close()
    removeHome(home)
  }
})
