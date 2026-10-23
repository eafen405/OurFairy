/**
 * Test-only fault at the Assistant frame boundary: publish one non-dense frame
 * for a chosen Session after the test asks for it, and at least `afterChunks`
 * real chunks have already been delivered.
 *
 * A real in-process Agent always emits dense frames, so a lost or reordered
 * frame cannot be produced by a real boot. The test writes `triggerPath` after
 * it has seen a published attempt; the next real chunk then emits a frame two
 * revision/index steps ahead, which is the shape an in-flight lost frame leaves
 * behind. The Agent's own stream, durable log and settlement stay real.
 */
import { existsSync, writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the dsh agent events this fixture publishes into.
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'ourfairy-assistant-frame-gap'

/** The fault this fixture injects. */
export interface FrameGapConfig {
  /** The session whose frames the fault applies to. */
  readonly sessionId: string
  /** How many real chunks must have arrived before the gap fires. */
  readonly afterChunks: number
  /** The path the test writes to arm the fault. */
  readonly triggerPath: string
  /** The path the fixture writes the fired frame's position to. */
  readonly reportPath: string
  /** The marker text the gap frame carries. */
  readonly marker: string
}

export function apply(ctx: Context, config: FrameGapConfig): void {
  let chunks = 0
  let fired = false
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (fired || frame.type !== 'chunk' || String(agent.session.id) !== config.sessionId) return
    chunks += 1
    if (chunks < config.afterChunks || !existsSync(config.triggerPath)) return
    fired = true
    // Same attempt, skipped revision and chunk position: only a lost frame
    // in flight can make the native fold see this.
    agent.ctx.emit('agent/assistant-stream', { agent, frame: {
      type: 'chunk', attemptId: frame.attemptId, revision: frame.revision + 2,
      index: frame.index + 2, time: frame.time,
      chunk: { type: 'text-delta', index: 0, text: config.marker },
    } })
    writeFileSync(config.reportPath, `${JSON.stringify({ revision: frame.revision, index: frame.index })}\n`)
  }, { global: true })
}
