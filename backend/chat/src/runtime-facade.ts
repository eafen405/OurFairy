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
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRuntime } from './runtime.js'
import type { QueueWork } from './queues.js'

/**
 * Where one facade keeps the chat runtime: a module-private symbol rather than
 * a `#` field, because Cordis calls a service method with a traceable proxy as
 * `this` and a class-private field is unreadable through it.
 */
const RUNTIME = Symbol('ourfairy-chat-runtime')

/** The live session the runtime holds for one session id. */
type LiveSession = NonNullable<ReturnType<SessionRuntime['live']>>

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
  runSession<T>(sessionId: SessionId, work: QueueWork<T>): Promise<T> { return this[RUNTIME].runSession(sessionId, work) }
  runDelivery<T>(deliveryId: SessionId, work: QueueWork<T>): Promise<T> { return this[RUNTIME].runDelivery(deliveryId, work) }
  live(sessionId: SessionId): LiveSession | undefined { return this[RUNTIME].live(sessionId) }
  events(sessionId: SessionId): ReturnType<SessionRuntime['events']> { return this[RUNTIME].events(sessionId) }
  barrier(state: LiveSession): Promise<void> { return this[RUNTIME].barrier(state) }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The narrow chat runtime the delivery row reads, as this package provides it. */
    ourfairyChatRuntime: ChatRuntimeFacade
  }
}
