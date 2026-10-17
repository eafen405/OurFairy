/** One-shot PCM WAV proxy; cancellation belongs to this request, not to an Agent. */
export class SpeechError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = `speech/${code}` }
}
const fail = () => new SpeechError(502, 'failed', '语音识别失败')
export function createSpeechHandler(config, authorize, sendJson) {
  for (const key of ['maxDurationMs', 'maxAudioBytes', 'timeoutMs', 'maxGlobalInFlight', 'maxUserInFlight']) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(`invalid speech ${key}`)
  }
  const active = new Map()
  let closed = false
  const available = () => !closed && Boolean(process.env.VOICE_API_KEY?.trim())
  return {
    async handle(req, res, transcribe) {
      const user = authorize(req)
      if (!transcribe) {
        if (req.method !== 'GET') throw new SpeechError(405, 'method-not-allowed', 'use GET')
        sendJson(res, 200, { ok: true, available: available(), maxDurationMs: config.maxDurationMs, maxAudioBytes: config.maxAudioBytes })
        return
      }
      if (req.method !== 'POST') throw new SpeechError(405, 'method-not-allowed', 'use POST')
      if (!available()) throw new SpeechError(503, 'unavailable', '语音输入不可用')
      const own = [...active.values()].filter(id => id === user.shortId).length
      if (own >= config.maxUserInFlight || active.size >= config.maxGlobalInFlight) throw new SpeechError(429, 'busy', '语音输入正忙')
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'audio/wav') throw new SpeechError(415, 'invalid-audio', '请发送 PCM WAV 录音')
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
        const response = await fetch(config.endpoint, { method: 'POST', headers: { authorization: `Bearer ${process.env.VOICE_API_KEY.trim()}` }, body: form, redirect: 'error', signal: controller.signal })
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
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
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
function readAudio(req, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', error); signal.removeEventListener('abort', abort) }
    const failed = reason => { cleanup(); req.resume(); reject(reason) }
    const data = chunk => { size += chunk.length; if (size > maxBytes) failed(new SpeechError(413, 'too-large', '录音过大')); else chunks.push(chunk) }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)) }
    const error = () => failed(new Error('request failed'))
    const abort = () => failed(new Error('aborted'))
    if (signal.aborted) return abort()
    req.on('data', data); req.once('end', end); req.once('error', error); signal.addEventListener('abort', abort, { once: true })
  })
}
function validateWav(audio, maxDurationMs) {
  const invalid = () => { throw new SpeechError(400, 'invalid-audio', '录音格式无效') }
  if (audio.length < 46 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
      audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 ||
      audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 16000 || audio.readUInt32LE(28) !== 32000 ||
      audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 || audio.toString('ascii', 36, 40) !== 'data') invalid()
  const size = audio.readUInt32LE(40)
  if (size === 0 || size % 2 !== 0 || size !== audio.length - 44 || size > maxDurationMs * 32) invalid()
}
