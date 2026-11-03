/** One-shot PCM WAV proxy; cancellation belongs to this request, not to an Agent. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isPositiveInteger, SPEECH_ENDPOINT_PATTERN, SPEECH_ENV_NAME_PATTERN, SPEECH_LIMIT_FIELDS } from './policy.js'

/** The signed-in caller one speech request speaks for. */
export interface SpeechCaller {
  readonly shortId: number
}

/** The resolved ASR connection settings, as the speech row declares them. */
export interface SpeechSettings {
  readonly model: string
  readonly endpoint: string
  readonly apiKeyEnv: string
  readonly maxDurationMs: number
  readonly maxAudioBytes: number
  readonly timeoutMs: number
  readonly maxGlobalInFlight: number
  readonly maxUserInFlight: number
}

export class SpeechError extends Error {
  declare readonly status: number
  declare readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = `speech/${code}`
  }
}
const fail = () => new SpeechError(502, 'failed', '语音识别失败')

/**
 * Validate the live ASR connection settings; called at load and again per
 * request, because the speech row is editable through the gateway.
 * @param config - resolved model, endpoint and limits.
 * @returns the validated snapshot.
 */
export function resolveSpeechSettings(config: Record<string, unknown>): SpeechSettings {
  // The field names and legality rules are the speech policy's (`./policy.ts`);
  // this is the runtime proof that the live row still holds them.
  for (const key of SPEECH_LIMIT_FIELDS) {
    if (!isPositiveInteger(config[key])) throw new Error(`invalid speech ${key}`)
  }
  if (typeof config.model !== 'string' || config.model === '') throw new Error('invalid speech model')
  if (typeof config.endpoint !== 'string' || !SPEECH_ENDPOINT_PATTERN.test(config.endpoint)) throw new Error('invalid speech endpoint')
  if (typeof config.apiKeyEnv !== 'string' || !SPEECH_ENV_NAME_PATTERN.test(config.apiKeyEnv)) throw new Error('invalid speech apiKeyEnv')
  // The row's schema is the authority on the fields' types; the checks above
  // are the runtime proof that the live row still holds the policy's rules.
  return config as unknown as SpeechSettings
}

/**
 * @param settings - reads the live, validated connection settings.
 * @param authorize - the signed-in caller.
 * @param sendJson - the shared JSON writer.
 * @param voiceKey - resolves the configured credential reference per request.
 */
export function createSpeechHandler(settings: () => Record<string, unknown>, authorize: (request: IncomingMessage) => SpeechCaller, sendJson: (response: ServerResponse, status: number, payload: unknown) => void, voiceKey: () => Promise<string | undefined>) {
  resolveSpeechSettings(settings())
  const active = new Map<AbortController, number>()
  let closed = false
  const available = async () => !closed && (await voiceKey()) !== undefined
  return {
    async handle(req: IncomingMessage, res: ServerResponse, transcribe: boolean) {
      const user = authorize(req)
      // The row is editable through the gateway, so the request validates the
      // configuration it is about to use rather than trusting the load check.
      const config = resolveSpeechSettings(settings())
      if (!transcribe) {
        if (req.method !== 'GET') throw new SpeechError(405, 'method-not-allowed', 'use GET')
        // Availability and the recording budget are the whole client contract;
        // the connection's model, endpoint and credential reference are the
        // gateway's to show, not every signed-in agent's.
        sendJson(res, 200, { ok: true, available: await available(), maxDurationMs: config.maxDurationMs, maxAudioBytes: config.maxAudioBytes })
        return
      }
      if (req.method !== 'POST') throw new SpeechError(405, 'method-not-allowed', 'use POST')
      const key = await voiceKey()
      if (key === undefined) throw new SpeechError(503, 'unavailable', '语音输入不可用')
      const own = [...active.values()].filter(id => id === user.shortId).length
      if (own >= config.maxUserInFlight || active.size >= config.maxGlobalInFlight) throw new SpeechError(429, 'busy', '语音输入正忙')
      // `split` always returns at least one element, so the first part is a
      // string; the assertion is type-level only and the missing header still
      // short-circuits the whole chain, as before.
      if (req.headers['content-type']?.split(';')[0]!.trim().toLowerCase() !== 'audio/wav') throw new SpeechError(415, 'invalid-audio', '请发送 PCM WAV 录音')
      if (Number(req.headers['content-length']) > config.maxAudioBytes) throw new SpeechError(413, 'too-large', '录音过大')
      const controller = new AbortController()
      active.set(controller, user.shortId)
      let disconnected = false, timedOut = false
      const disconnect = () => { disconnected = true; controller.abort() }
      const requestClose = () => { if (!req.complete) disconnect() }
      const responseClose = () => { if (!res.writableFinished) disconnect() }
      req.on('close', requestClose); res.on('close', responseClose)
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, config.timeoutMs)
      try {
        const audio = await readAudio(req, controller.signal, config.maxAudioBytes)
        validateWav(audio, config.maxDurationMs)
        const form = new FormData()
        form.set('model', config.model)
        form.set('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav')
        const response = await fetch(config.endpoint, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, redirect: 'error', signal: controller.signal })
        if (!response.ok) {
          await response.body?.cancel()
          if (response.status === 429) throw new SpeechError(429, 'busy', '语音服务正忙')
          throw fail()
        }
        const chunks = []; let size = 0
        for await (const chunk of response.body ?? []) {
          size += chunk.length
          if (size > 64 * 1024) throw fail()
          chunks.push(chunk)
        }
        // The ASR answer is JSON; the row's own field is read off it, and a
        // value that is not an object fails on the property read, as before.
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        if (typeof parsed.text !== 'string') throw fail()
        if (!parsed.text.trim()) throw new SpeechError(422, 'no-match', '未识别到文字')
        if (!disconnected) sendJson(res, 200, { ok: true, text: parsed.text })
      } catch (error) {
        if (disconnected) return
        if (closed) throw new SpeechError(503, 'unavailable', '语音输入不可用')
        if (timedOut) throw new SpeechError(504, 'timeout', '语音识别超时')
        if (error instanceof SpeechError) throw error
        throw fail()
      } finally {
        clearTimeout(timer); req.off('close', requestClose); res.off('close', responseClose); active.delete(controller)
      }
    },
    close() { closed = true; for (const controller of active.keys()) controller.abort() },
  }
}
function readAudio(req: IncomingMessage, signal: AbortSignal, maxBytes: number): Promise<Buffer<ArrayBuffer>> {
  return new Promise<Buffer<ArrayBuffer>>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); signal.removeEventListener('abort', abort) }
    const failed = (reason: unknown) => { cleanup(); req.resume(); reject(reason) }
    const data = (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) failed(new SpeechError(413, 'too-large', '录音过大')); else chunks.push(chunk) }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)) }
    const error = () => failed(new Error('request failed'))
    const abort = () => failed(new Error('aborted'))
    if (signal.aborted) return abort()
    req.on('data', data); req.once('end', end); req.once('error', error); signal.addEventListener('abort', abort, { once: true })
  })
}
function validateWav(audio: Buffer, maxDurationMs: number) {
  const invalid = () => { throw new SpeechError(400, 'invalid-audio', '录音格式无效') }
  if (audio.length < 46 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 ||
      audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 16000 || audio.readUInt32LE(28) !== 32000 ||
      audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 || audio.toString('ascii', 36, 40) !== 'data') invalid()
  const size = audio.readUInt32LE(40)
  if (size === 0 || size % 2 !== 0 || size !== audio.length - 44 || size > maxDurationMs * 32) invalid()
}
