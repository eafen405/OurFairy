/**
 * The deployment's model route also answers session-title requests.
 *
 * Mounting the native title rows gives every conversation one auxiliary model
 * request: `session-title-first-prompt-llm` asks the same route the conversation
 * uses for a short title after the first human message. Test doubles script
 * conversation turns by arrival order, so an unfiltered title request shifts
 * every later scripted behaviour and pollutes the recorded request list — the
 * failure then names the title prompt instead of the behaviour under test.
 *
 * This helper is the one place that knows the difference. A double built with
 * {@link startTitleAwareModel} answers title requests itself with a fixed title
 * and forwards everything else to the scripted server, so `requests` describes
 * conversation turns only. A bespoke double (one that emits tool calls or
 * images) calls {@link isTitleRequest} / {@link answerTitle} at the top of its
 * handler instead.
 *
 * A title request is recognized by its own system prompt, which is the native
 * provider's and is never part of a conversation turn.
 *
 * @module tests/helpers/title-aware
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { once } from 'node:events'
import { join } from 'node:path'
import { dshDir } from './backend.mjs'

/** The native provider's system-prompt opening, the marker a title request carries. */
const TITLE_PROMPT = 'Create a concise title for an AI coding-assistant session'

/** The title this helper answers with; tests that assert titles build their own double. */
export const DOUBLE_TITLE = '测试标题'

/**
 * Whether one decoded Messages request is the title provider's.
 *
 * @param body - the parsed JSON request body, or undefined when it did not parse.
 * @returns true when the system prompt is the native title prompt.
 */
export function isTitleRequest(body) {
  const system = body?.system
  const text = typeof system === 'string'
    ? system
    : Array.isArray(system)
      ? system.map(block => typeof block?.text === 'string' ? block.text : '').join('')
      : ''
  return text.includes(TITLE_PROMPT)
}

/**
 * Answer one title request with a minimal streaming Messages response.
 *
 * @param response - the server response to complete.
 * @param title - the title text to return.
 */
export function answerTitle(response, title = DOUBLE_TITLE) {  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({
    type: 'message_start',
    message: { id: 'title-double', type: 'message', role: 'assistant', model: 'title-double', content: [], usage: { input_tokens: 1, output_tokens: 0 } },
  })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: title } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: Array.from(title).length } })
  emit({ type: 'message_stop' })
  response.end()
}

/**
 * Start dsh's scriptable Messages double behind a title-answering proxy.
 *
 * @param options - the same options `startMockLlmServer` takes.
 * @returns the proxy's base URL, the conversation-only request records, the
 *   title request records, and one idempotent close.
 */
export async function startTitleAwareModel(options) {
  const { startMockLlmServer } = await import(join(dshDir, 'packages/test-support/llm-mock-server/lib/index.js'))
  const inner = await startMockLlmServer(options)
  const titleRequests = []
  const upstream = new URL(inner.baseURL)
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { body = undefined }
    if (isTitleRequest(body)) {
      titleRequests.push(body)
      answerTitle(response)
      return
    }
    // Everything else is a conversation turn: forward it byte for byte so the
    // scripted server sees exactly what the product sent, and stream the answer
    // back unchanged (the SSE cases assert on framing and timing).
    const forwarded = await fetch(new URL(request.url, upstream), {
      method: request.method,
      headers: { 'content-type': request.headers['content-type'] ?? 'application/json', ...(request.headers['x-api-key'] ? { 'x-api-key': request.headers['x-api-key'] } : {}) },
      body: raw,
    })
    const headers = {}
    forwarded.headers.forEach((value, name) => { headers[name] = value })
    response.writeHead(forwarded.status, headers)
    if (forwarded.body === null) { response.end(); return }
    try {
      await new Promise((resolve, reject) => {
        Readable.fromWeb(forwarded.body).on('error', reject).pipe(response).on('finish', resolve).on('error', reject)
      })
    } catch (error) {
      // A scripted disconnect is a legitimate behaviour: the product must see a
      // broken stream, not a clean end. Destroying the response is that signal.
      response.destroy()
      if (!(error instanceof Error)) throw error
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let closed = false
  return {
    /** The proxy's base URL without `/v1`. */
    get baseURL() { return `http://127.0.0.1:${server.address().port}` },
    /** The conversation requests the scripted server accepted, in arrival order. */
    get requests() { return inner.requests },
    /** The title requests this proxy answered, in arrival order. */
    get titleRequests() { return titleRequests },
    /** Stop both servers; idempotent. */
    async close() {
      if (closed) return
      closed = true
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
      await inner.close()
    },
  }
}

/**
 * Answer a raw request body when it is a title request.
 *
 * A bespoke double (one that emits tool calls, images or held replies) calls
 * this before it interprets the body, so an auxiliary title request neither
 * crashes it nor enters its recorded conversation turns.
 *
 * @param raw - the request body as read from the socket.
 * @param response - the server response to complete.
 * @param title - the title text to return.
 * @returns true when the request was a title request and has been answered.
 */
export function answerIfTitle(raw, response, title = DOUBLE_TITLE) {
  let body
  try { body = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) } catch { return false }
  if (!isTitleRequest(body)) return false
  answerTitle(response, title)
  return true
}
