/**
 * The OurFairy speech module: one authenticated, bounded PCM WAV proxy to the
 * deployment's SiliconFlow ASR account.
 *
 * The connection settings (model, endpoint, limits, credential reference) are
 * the `speech` profile row, so Phaethon edits them through the gateway and the
 * next recording uses them. The credential itself never enters this module:
 * the reference resolves per request through the native credential seam.
 *
 * @module @ourfairy/dsh-speech
 */
import z from '@deepseek-ai/schemastery'
import { sendJson } from '@ourfairy/dsh-http/http'
import { createSpeechHandler, resolveSpeechSettings, SpeechError } from './service.mjs'

export const name = 'ourfairy-speech'
export const inject = ['webServer', 'connection', 'identity']

/** Every field is live: the gateway edits the row, the next recording reads it. */
export const Config = z.object({
  model: z.string().required().volatile(),
  endpoint: z.string().required().volatile(),
  apiKeyEnv: z.string().default('VOICE_API_KEY').volatile(),
  maxDurationMs: z.natural().required().volatile(),
  maxAudioBytes: z.natural().required().volatile(),
  timeoutMs: z.natural().required().volatile(),
  maxGlobalInFlight: z.natural().required().volatile(),
  maxUserInFlight: z.natural().required().volatile(),
})

const FIELDS = ['model', 'endpoint', 'apiKeyEnv', 'maxDurationMs', 'maxAudioBytes', 'timeoutMs', 'maxGlobalInFlight', 'maxUserInFlight']

export function apply(ctx, config) {
  /** Read the live row: volatile fields are refs, plain fields are values. */
  const values = () => Object.fromEntries(FIELDS.map(field => {
    const value = config[field]
    return [field, value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value]
  }))
  resolveSpeechSettings(values())
  /** Resolve the configured reference through the native seam; an unset one is unavailable. */
  const voiceKey = async () => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    const hit = await credentials.resolve(values().apiKeyEnv).catch(() => undefined)
    const value = hit?.value?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  const service = createSpeechHandler(values, request => {
    const caller = ctx.identity.authenticateRequest(request)
    if (!caller) throw new SpeechError(401, 'unauthorized', '请先登录')
    return caller
  }, sendJson, voiceKey)
  ctx.effect(() => () => service.close())
  for (const [path, transcribe] of [['/speech', false], ['/speech/transcriptions', true]]) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler: async (req, res) => {
      try {
        if (ctx.connection.fence(req) !== undefined) throw new SpeechError(403, 'forbidden-authority', 'untrusted Host or Origin')
        await service.handle(req, res, transcribe)
      } catch (error) {
        if (res.destroyed) return
        sendJson(res, error instanceof SpeechError ? error.status : 500, { ok: false, error: { code: error instanceof SpeechError ? error.code : 'speech/internal', message: error instanceof SpeechError ? error.message : '语音请求失败' } })
      }
    } }), `speech: ${path}`)
  }
}
