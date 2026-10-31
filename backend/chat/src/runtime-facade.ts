/**
 * The narrow runtime chat exposes to the delivery row.
 *
 * Delivery needs one at-most-once session append that resolves durable, and one
 * outgoing-delivery queue — nothing else. Holding the `SessionRuntime` behind a
 * module-private symbol makes that the entire reachable surface: a product row
 * cannot reach the resume, projection, subscription or configuration paths
 * through this service.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRuntime } from './runtime.js'
import type { QueueWork } from './queues.js'

/**
 * Where one facade keeps the chat runtime: a module-private symbol rather than
 * a `#` field, because Cordis calls a service method with a traceable proxy as
 * `this` and a class-private field is unreadable through it.
 */
const RUNTIME = Symbol('ourfairy-chat-runtime')

export class ChatRuntimeFacade extends Service {
  /**
   * The runtime this facade exposes. Declared, not emitted: the constructor
   * assignment stays the only write, exactly as before the migration.
   */
  declare [RUNTIME]: SessionRuntime

  constructor(ctx: Context, runtime: SessionRuntime) {
    super(ctx, 'ourfairyChatRuntime')
    this[RUNTIME] = runtime
  }
  appendOnce<E extends SessionEvent>(sessionId: SessionId, match: (events: readonly SessionEvent[]) => E | undefined, build: (session: Session) => E): Promise<E> { return this[RUNTIME].appendOnce(sessionId, match, build) }
  runDelivery<T>(deliveryId: SessionId, work: QueueWork<T>): Promise<T> { return this[RUNTIME].runDelivery(deliveryId, work) }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The narrow chat runtime the delivery row reads, as this package provides it. */
    ourfairyChatRuntime: ChatRuntimeFacade
  }
}
