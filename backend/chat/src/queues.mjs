/**
 * The ordered writers behind a chat session.
 *
 * A session's own work (resume, send, receipt, delivery settle) shares one
 * queue per session. Preparing an outgoing delivery uses a second, unrelated
 * key space because a delivery takes its target session's queue from inside
 * its own. The named methods are the policy: callers cannot choose a raw key,
 * so the two spaces never alias even when the ids compare equal.
 *
 * A queue is a promise tail, not a re-entrant lock. Entering a queue this async
 * call chain already holds would wait on itself forever; that nesting is a
 * defect and is reported immediately instead of being left as a silent hang.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export class SessionQueues {
  #queues = new Map()
  #held = new AsyncLocalStorage()

  runSession(sessionId, work) { return this.#run(`session:${sessionId}`, work) }
  runDelivery(deliveryId, work) { return this.#run(`delivery:${deliveryId}`, work) }

  #run(key, work) {
    const held = this.#held.getStore()
    if (held?.has(key) === true) {
      throw new Error(`chat queues: "${key}" is already held by this call chain; waiting on it would never finish`)
    }
    const previous = this.#queues.get(key) ?? Promise.resolve()
    const enter = () => this.#held.run(new Set([...(held ?? []), key]), work)
    const started = previous.then(enter, enter)
    const tail = started.then(() => {}, () => {})
    this.#queues.set(key, tail)
    return started.finally(() => { if (this.#queues.get(key) === tail) this.#queues.delete(key) })
  }
}
