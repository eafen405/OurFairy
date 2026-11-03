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
import { freezeSurface, postHandler } from '@ourfairy/dsh-http/http'
import { GatewayError } from './service.js'
import type { IncomingMessage } from 'node:http'
import type { GatewayService } from './service.js'
import type { IdentityService } from '@ourfairy/dsh-identity'

/** The caller one gateway route admits. */
type GatewayCaller = ReturnType<IdentityService['authenticateRequest']>

/** The inputs the gateway's request paths read. */
export interface GatewayHandlerOptions {
  readonly service: GatewayService
  readonly authenticate: (request: IncomingMessage) => GatewayCaller
  readonly fence: (request: IncomingMessage) => unknown
}

/**
 * The addresses this row publishes, in the order the carrier registers them.
 * Every one requires the administrator role.
 */
export const SURFACE = freezeSurface([
  { path: '/gateway/read', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
  { path: '/gateway/selection', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
  { path: '/gateway/route', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
  { path: '/gateway/route/delete', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
  { path: '/gateway/asr', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
  { path: '/gateway/compaction', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
  { path: '/gateway/maintenance', method: 'POST', auth: 'role', body: 'json', response: 'json', prefix: 'gateway' },
])

/** Paths this module owns, in the order the carrier registers them. */
export const GATEWAY_PATHS = Object.freeze(SURFACE.map(entry => entry.path))

/** Build one handler per path in {@link GATEWAY_PATHS}. */
export function gatewayHandlers({ service, authenticate, fence }: GatewayHandlerOptions) {
  const post = (handle: (body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>) => postHandler({
    fence,
    handle,
    HttpError: GatewayError,
    codePrefix: 'gateway',
    internalMessage: 'the gateway module failed to handle this request',
  })
  const asAdmin = (handle: (body: Record<string, unknown>, caller: GatewayCaller) => Promise<Record<string, unknown>>) => post(async (body, request) => {
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
    ['/gateway/compaction', asAdmin(body => service.saveCompaction(body))],
    ['/gateway/maintenance', asAdmin(body => service.saveMaintenance(body))],
  ])
}
