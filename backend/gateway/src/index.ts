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
import { mountRoutes } from '@ourfairy/dsh-http/http'
import { GatewayService } from './service.js'
import { gatewayHandlers, SURFACE } from './http.js'
import type { Context } from '@deepseek-ai/cordis'
// The dsh context's own seams and the product's own context rows: the web
// server's route registry, Connection's trust fence, identity's service, the
// model registry, the shared model selection and the chat row. The imports are
// type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@ourfairy/dsh-chat'
import type {} from '@ourfairy/dsh-identity'

export const name = 'ourfairy-gateway'
export const inject = ['webServer', 'connection', 'identity', 'agentDefaultModel', 'llm', 'ourfairyChat']

export function apply(ctx: Context) {
  const service = new GatewayService(ctx)
  const handlers = gatewayHandlers({
    service,
    authenticate: request => ctx.identity.authenticateRequest(request),
    fence: request => ctx.connection.fence(request),
  })
  mountRoutes(ctx, { label: 'ourfairy-gateway', surface: SURFACE, handlers })
}

export { GatewayService, GatewayError } from './service.js'
export { GATEWAY_PATHS, SURFACE, gatewayHandlers } from './http.js'
