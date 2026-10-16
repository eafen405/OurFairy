import { sendJson } from '@ourfairy/dsh-identity/http'
import { createSpeechHandler, SpeechError } from './service.mjs'
export const name = 'ourfairy-speech'
export const inject = ['webServer', 'connection', 'identity']
export function apply(ctx, config) {
  const service = createSpeechHandler(config, request => {
    const caller = ctx.identity.authenticateRequest(request)
    if (!caller) throw new SpeechError(401, 'unauthorized', '请先登录')
    return caller
  }, sendJson)
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
