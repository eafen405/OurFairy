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
import { freezeSurface, mountRoutes, sendJson, type RouteHandler } from '@ourfairy/dsh-http/http'
import { DEFAULT_API_KEY_ENV, SPEECH_FIELDS } from './policy.js'
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

/**
 * Every field is live: the gateway edits the row, the next recording reads it.
 *
 * The field vocabulary and the positive-integer floor are the speech policy's
 * (`./policy.ts`). This row still declares one schema per field, because a
 * schema carries the field's type and default as well as its name;
 * `tests/speech-policy.test.mjs` proves the keys are exactly `SPEECH_FIELDS` and
 * that the floor agrees with `isPositiveInteger`.
 */
export const Config = z.object({
  model: z.string().required().volatile(),
  endpoint: z.string().required().volatile(),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV).volatile(),
  maxDurationMs: z.natural().min(1).required().volatile(),
  maxAudioBytes: z.natural().min(1).required().volatile(),
  timeoutMs: z.natural().min(1).required().volatile(),
  maxGlobalInFlight: z.natural().min(1).required().volatile(),
  maxUserInFlight: z.natural().min(1).required().volatile(),
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

/**
 * The addresses this row publishes, and the ones `mountRoutes` mounts.
 *
 * `/speech` is the availability read (`GET`, no body); `/speech/transcriptions`
 * accepts raw `audio/wav` bytes (`POST`) and answers JSON. Both need a live
 * credential and keep their own admission in the service: neither request body
 * is read as JSON here.
 */
export const SURFACE = freezeSurface([
  { path: '/speech', method: 'GET', auth: 'authentication', body: 'none', response: 'json', prefix: 'speech' },
  { path: '/speech/transcriptions', method: 'POST', auth: 'authentication', body: 'binary', response: 'json', prefix: 'speech' },
])

export function apply(ctx: Context, config: SpeechConfig) {
  /** Read the live row: volatile fields are refs, plain fields are values. */
  const values = (): Record<string, unknown> => Object.fromEntries(SPEECH_FIELDS.map(field => {
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

  /**
   * The carrier handler both addresses share: the fence first, then the
   * service's own credential, method and audio checks and its error envelope.
   * `transcribe` follows the address's declared method — the availability read
   * is the GET, and the one POST transcribes audio — which is the same split
   * the service's own method check makes.
   */
  const carrier = (transcribe: boolean): RouteHandler => async (req, res) => {
    try {
      if (ctx.connection.fence(req) !== undefined) throw new SpeechError(403, 'forbidden-authority', 'untrusted Host or Origin')
      await service.handle(req, res, transcribe)
    } catch (error) {
      if (res.destroyed) return
      sendJson(res, error instanceof SpeechError ? error.status : 500, { ok: false, error: { code: error instanceof SpeechError ? error.code : 'speech/internal', message: error instanceof SpeechError ? error.message : '语音请求失败' } })
    }
  }
  const handlers = new Map(SURFACE.map((entry): [string, RouteHandler] => [entry.path, carrier(entry.method === 'POST')]))
  mountRoutes(ctx, { label: 'speech', surface: SURFACE, handlers })
}
