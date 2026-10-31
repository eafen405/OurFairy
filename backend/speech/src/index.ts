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
import { createSpeechHandler, resolveSpeechSettings, SpeechError } from './service.js'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
// The dsh context's own seams and the product's own context row: the web
// server's route registry, Connection's trust fence and identity's service.
// The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@ourfairy/dsh-identity'

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

/**
 * One live configuration field: the loader's volatile ref, or the plain value
 * a non-volatile field carries.
 */
export type SpeechField = { readonly get: () => unknown } | string | number | null | undefined

/**
 * The row's configuration, as the loader hands it over.
 *
 * Every field of this row is volatile, so the loader hands over a live ref
 * per field and the ref's `get()` is the row's current value.
 */
export type SpeechConfig = Record<string, SpeechField>

const FIELDS = ['model', 'endpoint', 'apiKeyEnv', 'maxDurationMs', 'maxAudioBytes', 'timeoutMs', 'maxGlobalInFlight', 'maxUserInFlight'] as const

export function apply(ctx: Context, config: SpeechConfig) {
  /** Read the live row: volatile fields are refs, plain fields are values. */
  const values = (): Record<string, unknown> => Object.fromEntries(FIELDS.map(field => {
    const value = config[field]
    return [field, value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value] as const
  }))
  resolveSpeechSettings(values())
  /** Resolve the configured reference through the native seam; an unset one is unavailable. */
  const voiceKey = async (): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return undefined
    // The credential seam names its references with a branded string; the
    // speech row's `apiKeyEnv` is the environment-variable name it resolves.
    const hit = await credentials.resolve(values().apiKeyEnv as CredentialRef).catch(() => undefined)
    const value = hit?.value?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  const service = createSpeechHandler(values, request => {
    const caller = ctx.identity.authenticateRequest(request)
    if (!caller) throw new SpeechError(401, 'unauthorized', '请先登录')
    return caller
  }, sendJson, voiceKey)
  ctx.effect(() => () => service.close())
  for (const [path, transcribe] of [['/speech', false], ['/speech/transcriptions', true]] as const) {
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

/**
 * The addresses this row publishes, as one read-only table (ticket #272).
 *
 * Kept as a free-standing block at the end of the file so the row's mounting
 * loop above — and its admission order — stays untouched. `/speech` is the
 * availability read (`GET`, no body); `/speech/transcriptions` accepts raw
 * `audio/wav` bytes (`POST`) and answers JSON. Both need a live credential.
 */
export const SURFACE = Object.freeze([
  Object.freeze({
    path: '/speech',
    method: 'GET',
    auth: 'authentication',
    body: 'none',
    response: 'json',
    prefix: 'speech',
  }),
  Object.freeze({
    path: '/speech/transcriptions',
    method: 'POST',
    auth: 'authentication',
    body: 'binary',
    response: 'json',
    prefix: 'speech',
  }),
] as const)
