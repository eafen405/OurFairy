import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDownloadResponder } from '../backend/attachments/dist/download.js'

// Exercise the shipped download responder factory itself against real HTTP: the
// abort path is observable at its byte-stream boundary through the exported
// factory, so the test never reads the product's source text.

test('disconnecting an original download during backpressure settles its handler and closes its file source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ourfairy-download-abort-')), path = join(dir, 'original.bin')
  const file = await open(path, 'w'); await file.truncate(32 * 1024 * 1024); await file.close()
  let stream, sourceClosed = false, handlerSettled = false, responseClosed = false
  let sourceDone, handlerDone
  const sourceFinished = new Promise(resolve => { sourceDone = resolve })
  const handlerFinished = new Promise(resolve => { handlerDone = resolve })
  const respond = createDownloadResponder({ attachments: { async *readFileStream(_ref, signal) {
    stream = createReadStream(path, { highWaterMark: 65536, signal })
    stream.once('close', () => { sourceClosed = true; sourceDone() })
    try { for await (const chunk of stream) yield chunk }
    finally { stream.destroy() }
  } } })
  const server = createServer((_req, response) => {
    response.once('close', () => { responseClosed = true })
    respond(response, { original: { bytes: 32 * 1024 * 1024 }, mime: 'application/octet-stream', name: 'original.bin' })
      .then(() => { handlerSettled = true; handlerDone() }, error => { handlerDone(); throw error })
  })
  let timeout
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    await new Promise((resolve, reject) => {
      const call = request({ host: '127.0.0.1', port: server.address().port, method: 'POST' }, response => {
        response.once('data', () => { response.destroy(); resolve() })
        response.on('error', () => {})
      })
      call.on('error', reject); call.end()
    })
    await Promise.race([
      Promise.all([sourceFinished, handlerFinished]),
      new Promise(resolve => { timeout = setTimeout(resolve, 1500) }),
    ])
    assert.equal(responseClosed, true)
    assert.equal(handlerSettled, true, 'the responder must leave its drain wait after client close')
    assert.equal(sourceClosed, true, 'the original file descriptor must be released')
  } finally {
    clearTimeout(timeout)
    stream?.destroy()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
