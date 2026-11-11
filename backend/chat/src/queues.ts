/**
 * The ordered writers behind a chat session.
 *
 * A session's own work (resume, send, receipt, delivery settle) shares one queue
 * per session; preparing an outgoing delivery uses a second key space because a
 * delivery takes its target session's queue from inside its own. Callers name a
 * space through the methods, so the two never alias even when ids compare equal.
 *
 * A queue is a promise tail, not a re-entrant lock: entering one this call chain
 * is still running waits on itself forever, so that nesting fails immediately.
 * The test is the entry's own work, not the call chain alone: a turn started
 * inside a queue entry keeps inheriting this async context after the entry has
 * settled, and may legitimately ask for the same queue later (a self delivery
 * landing in the session that issued it). Waiting then waits on nothing.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** The work one queue runs. Every caller passes an async function. */
export type QueueWork<T> = () => Promise<T>

/** One queue entry as its call chain remembers it. */
interface HeldEntry {
  /** Whether the work this context descends from has already resolved. */
  settled: boolean
}

export class SessionQueues {
  #queues = new Map<string, Promise<unknown>>()
  #held = new AsyncLocalStorage<Map<string, HeldEntry>>()

  sessionPending(sessionId: string): boolean { return this.#queues.has(`session:${sessionId}`) }
  runSession<T>(sessionId: string, work: QueueWork<T>): Promise<T> { return this.#run(`session:${sessionId}`, work) }
  runDelivery<T>(deliveryId: string, work: QueueWork<T>): Promise<T> { return this.#run(`delivery:${deliveryId}`, work) }

  #run<T>(key: string, work: QueueWork<T>): Promise<T> {
    const held = this.#held.getStore()
    const outer = held?.get(key)
    if (outer !== undefined && !outer.settled) {
      throw new Error(`chat queues: "${key}" is already held by this call chain; waiting on it would never finish`)
    }
    const previous = this.#queues.get(key) ?? Promise.resolve()
    const entry: HeldEntry = { settled: false }
    const enter = (): Promise<T> => this.#held.run(new Map([...(held ?? []), [key, entry]]), work)
    const started = previous.then(enter, enter)
    const tail = started.then(() => {}, () => {})
    this.#queues.set(key, tail)
    return started.finally(() => {
      entry.settled = true
      if (this.#queues.get(key) === tail) this.#queues.delete(key)
    })
  }
}
