/**
 * The gateway module's request paths, mounted beside the identity paths on the
 * same Web carrier and behind the same Host/Origin fence.
 *
 * Every route derives the caller from the presented credential and then requires
 * the administrator. An ordinary agent is refused by the backend, not by the
 * absence of a button in the client.
 *
 * @module @ourfairy/dsh-gateway/src/http
 */
import { postHandler } from '@ourfairy/dsh-http/http'
import { GatewayError } from './service.mjs'

/** Paths this module owns, in the order the carrier registers them. */
export const GATEWAY_PATHS = Object.freeze([
  '/gateway/read',
  '/gateway/selection',
  '/gateway/route',
  '/gateway/route/delete',
  '/gateway/asr',
])

/** Build one handler per path in {@link GATEWAY_PATHS}. */
export function gatewayHandlers({ service, authenticate, fence }) {
  const post = (handle) => postHandler({
    fence,
    handle,
    HttpError: GatewayError,
    codePrefix: 'gateway',
    internalMessage: 'the gateway module failed to handle this request',
  })
  const asAdmin = (handle) => post(async (body, request) => {
    const caller = authenticate(request)
    service.requireAdmin(caller)
    return { ok: true, ...await handle(body, caller) }
  })

  return new Map([
    ['/gateway/read', asAdmin(() => service.read())],
    ['/gateway/selection', asAdmin(body => service.saveSelection(body))],
    ['/gateway/route', asAdmin(body => service.saveRoute(body))],
    ['/gateway/route/delete', asAdmin(body => service.deleteRoute(body))],
    ['/gateway/asr', asAdmin(body => service.saveAsr(body))],
  ])
}
