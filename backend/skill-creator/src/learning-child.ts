/**
 * The child-agent mechanics shared by the background learning and deep
 * creation engines (#300).
 *
 * Both engines launch native dsh Agent children that inherit no tool (the
 * product rows and the detection/creation tools must not see a user's whole
 * surface), self-register exactly their own structured tools and carry one
 * prompt section. They also both decide completion from the child's durable
 * log, and both track the same active/running/retry bookkeeping. Keeping those
 * four facts in this narrow module means the two engines cannot drift on what a
 * learning child is or on when its turn counts as complete.
 *
 * @module @ourfairy/dsh-skill-creator/src/learning-child
 */
import { LEARNING_SECTION } from './learning-policy.js'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: the agent-scoped tool and prompt seams the setup closure uses.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

/** One successful call of one tool in one run. */
export type ToolCall = { readonly callId: string; readonly arguments: string }

/** The successful calls of one named tool in one run, in call order. */
export function successfulCalls(events: readonly SessionEvent[], startSeq: number, name: string): ToolCall[] {
  const succeeded = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result' || event.seq < startSeq) continue
    const callId = event.data.message.toolCallId
    if (typeof callId === 'string' && event.data.message.isError !== true) succeeded.add(callId)
  }
  return events
    .filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call'
      && event.seq >= startSeq && event.data.name === name && succeeded.has(event.data.callId))
    .map(event => ({ callId: event.data.callId, arguments: event.data.arguments }))
}

/** Whether the child's last ended turn in this run completed. */
export function turnCompleted(events: readonly SessionEvent[], startSeq: number): boolean {
  const ending = events.filter(event => event.type === 'turn/end' && event.seq >= startSeq).at(-1)
  return ending !== undefined && ending.type === 'turn/end' && ending.data.reason.kind === 'completed'
}

/**
 * The setup closure every learning child uses.
 *
 * The order is part of the contract: inherited tools are restricted to nothing
 * first, the engine registers its own structured tools, and then the one prompt
 * section is written. A resumed child repeats the same setup because its own
 * scoped tools do not survive the resume.
 */
export function learningChildSetup(policy: string, register: (agentCtx: Context) => void): (agentCtx: Context) => void {
  return agentCtx => {
    agentCtx.tools.restrict({ allow: [] })
    register(agentCtx)
    agentCtx.systemPrompt.section({ name: LEARNING_SECTION, order: 0, text: policy, interpolate: false })
  }
}

/**
 * The active-run, running-promise and retry bookkeeping both engines share.
 *
 * A launch is fire-and-forget: the engine's own run settles its durable row,
 * this tracker only removes the key from the active set, records an unexpected
 * rejection's retry time and lets `close()` await every still-running child.
 */
export class ChildRuns<K> {
  readonly #active = new Set<K>()
  readonly #runs = new Set<Promise<void>>()
  readonly #retryAt = new Map<K, number>()

  /** Whether one key currently has a child run. */
  has(key: K): boolean {
    return this.#active.has(key)
  }

  /** The retry time one key has been deferred to, or undefined. */
  retryAt(key: K): number | undefined {
    return this.#retryAt.get(key)
  }

  /** Defer one key until `at`; the next tick may launch it again after then. */
  defer(key: K, at: number): void {
    this.#retryAt.set(key, at)
  }

  /** Forget one key's retry after a successful settlement. */
  clearRetry(key: K): void {
    this.#retryAt.delete(key)
  }

  /** Track one run; an unexpected rejection defers the key's next retry. */
  launch(key: K, run: Promise<void>, retryDelayMs: number): void {
    this.#active.add(key)
    let tracked: Promise<void>
    tracked = run.catch(() => {
      this.#retryAt.set(key, Date.now() + retryDelayMs)
    }).finally(() => {
      this.#active.delete(key)
      this.#runs.delete(tracked)
    })
    this.#runs.add(tracked)
  }

  /** Wait for every tracked run, including runs launched while closing. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.#runs])
  }
}
