/**
 * The narrow runtime chat exposes to the delivery row.
 *
 * Delivery needs chat's ordered writers, the live session, one event read and
 * the durability barrier — nothing else. Holding the `SessionRuntime` behind a
 * module-private symbol makes that the entire reachable surface: a product row
 * cannot reach the resume, projection, subscription or configuration paths
 * through this service.
 */
import { Service } from '@deepseek-ai/cordis'

/**
 * Where one facade keeps the chat runtime: a module-private symbol rather than
 * a `#` field, because Cordis calls a service method with a traceable proxy as
 * `this` and a class-private field is unreadable through it.
 */
const RUNTIME = Symbol('ourfairy-chat-runtime')

export class ChatRuntimeFacade extends Service {
  constructor(ctx, runtime) {
    super(ctx, 'ourfairyChatRuntime')
    this[RUNTIME] = runtime
  }
  runSession(sessionId, work) { return this[RUNTIME].runSession(sessionId, work) }
  runDelivery(deliveryId, work) { return this[RUNTIME].runDelivery(deliveryId, work) }
  live(sessionId) { return this[RUNTIME].live(sessionId) }
  events(sessionId) { return this[RUNTIME].events(sessionId) }
  barrier(state) { return this[RUNTIME].barrier(state) }
}
