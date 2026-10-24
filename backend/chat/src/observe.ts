import type { ServerResponse } from 'node:http'
import { constants as zlibConstants, createGzip } from 'node:zlib'
import type { ChatObserver } from './service.js'
import type { ChatProjection } from './runtime.js'

/** Own one observer's transport buffers, compression and cleanup. */
export function respondToChatObserver(response: ServerResponse, subscribe: ChatObserver) {
  const acceptsGzip = response.req.headers['accept-encoding']?.split(',').some(offer => {
    const [encoding, ...parameters] = offer.trim().toLowerCase().split(';')
    return encoding === 'gzip' && parameters.every(parameter => {
      const value = parameter.trim()
      return !value.startsWith('q=') || Number(value.slice(2)) > 0
    })
  })
  const compression = acceptsGzip ? createGzip({ flush: zlibConstants.Z_SYNC_FLUSH }) : null
  const output = compression ?? response
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
    'x-accel-buffering': 'no', vary: 'accept-encoding', ...(compression ? { 'content-encoding': 'gzip' } : {}) })
  response.flushHeaders()
  compression?.on('error', error => response.destroy(error))
  compression?.pipe(response)

  let writable = true
  let pending: ChatProjection | undefined
  const flush = () => {
    if (!writable || pending === undefined) return
    const latest = pending
    pending = undefined
    writable = output.write(`event: projection\ndata: ${JSON.stringify(latest)}\n\n`)
  }
  output.on('drain', () => { writable = true; flush() })
  const unsubscribe = subscribe((projection, error) => {
    if (error) { response.destroy(error); return }
    pending = projection
    flush()
  })
  const heartbeat = setInterval(() => {
    if (writable && pending === undefined) writable = output.write(': keepalive\n\n')
  }, 15000)
  response.once('close', () => {
    pending = undefined
    clearInterval(heartbeat)
    unsubscribe()
    compression?.destroy()
  })
}
