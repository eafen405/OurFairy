/**
 * OurFairy's Phaethon gateway: the `/gateway/*` request paths over the native
 * dsh profile settings, the registered provider routes and the shared model
 * selection.
 *
 * The module owns no store of its own. The profile patch written by the native
 * configuration editor is the only durable authority; `agent-default-model`,
 * `llm-pi-ai` and `speech` rows are the shared configuration themselves.
 *
 * @module @ourfairy/dsh-gateway
 */
import { GatewayService } from './service.mjs'
import { GATEWAY_PATHS, gatewayHandlers } from './http.mjs'

export const name = 'ourfairy-gateway'
export const inject = ['webServer', 'connection', 'identity', 'agentDefaultModel', 'llm', 'ourfairyChat']

export function apply(ctx) {
  const service = new GatewayService(ctx)
  const handlers = gatewayHandlers({
    service,
    authenticate: request => ctx.identity.authenticateRequest(request),
    fence: request => ctx.connection.fence(request),
  })
  for (const path of GATEWAY_PATHS) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler: handlers.get(path) }), `ourfairy-gateway: ${path}`)
  }
}

export { GatewayService, GatewayError } from './service.mjs'
export { GATEWAY_PATHS, gatewayHandlers } from './http.mjs'
