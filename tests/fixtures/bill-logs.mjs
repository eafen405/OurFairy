/**
 * Session-log builders for the electricity-bill fixtures (ticket #318).
 *
 * The bill is derived from the durable log alone, so the fixtures are logs and
 * nothing else: a closed turn is `turn/start` … `turn/end` around steps that
 * settle an attempt. `deriveTurnTokenUsage` reads usage from the settlement
 * (`assistant/message.data.usage`) and from a retried attempt's own stream, so
 * both shapes are here.
 */

/** 2026-01-15 11:00 Asia/Shanghai: a fixed instant the day-bucketing cases shift from. */
export const JANUARY_15 = Date.UTC(2026, 0, 15, 3, 0, 0)

/** One committed event at the seq the caller names. */
export function event(seq, type, data, time = JANUARY_15 + seq) {
  return { seq, type, time, data }
}

/** The assistant message one settled step appends; its source is a model route. */
export const message = (id = 'a1') => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  source: { kind: 'model', provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash' },
})

/**
 * One provider-reported usage record.
 *
 * The four buckets are disjoint, and the total is the sum of the four, which is
 * what the vendor reports and what the dsh fold re-checks. `totalTokens` is
 * derived unless the caller asserts an explicit one.
 */
export function usage({
  inputTokens = 100, outputTokens = 20, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens,
} = {}) {
  const total = inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? total,
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
    ...reasoningTokens === undefined ? {} : { reasoningTokens },
  }
}

/** One usage sample as it appears inside a durable assistant stream. */
export const usageStream = sample => [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: sample } }]

/** One settled step: an opened step whose assistant message reports `sample`. */
export function step(seq, { turn = 1, step: stepNumber = 1, time = JANUARY_15, sample } = {}) {
  return [
    event(seq, 'step/start', { turn, step: stepNumber }, time),
    event(seq + 1, 'assistant/message', {
      turn,
      step: stepNumber,
      message: message(`message-${seq}`),
      stream: sample === undefined ? [] : usageStream(sample),
      ...sample === undefined ? {} : { usage: sample },
    }, time + 1),
    event(seq + 2, 'step/end', { turn, step: stepNumber }, time + 2),
  ]
}

/** One closed turn whose listed steps each settle. */
export function closedTurn(startSeq, { turn = 1, time = JANUARY_15, samples = [usage()] } = {}) {
  const events = [event(startSeq, 'turn/start', { turn }, time)]
  let cursor = startSeq + 1
  samples.forEach((sample, index) => {
    events.push(...step(cursor, { turn, step: index + 1, time: time + 1, sample }))
    cursor += 3
  })
  events.push(event(cursor, 'turn/end', { turn, reason: { kind: 'completed' } }, time + 2))
  return events
}

/** One attempt that settled without a durable surface message (a retried call). */
export function attempt(seq, { turn = 1, step: stepNumber = 1, time = JANUARY_15, sample }) {
  return event(seq, 'assistant/attempt', {
    turn,
    step: stepNumber,
    stream: [
      ...usageStream(sample),
      { type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'retry' } } } },
    ],
  }, time)
}

/** One turn whose first attempt failed and whose retry settled a message. */
export function retriedTurn(startSeq, { turn = 1, time = JANUARY_15, failed, retried } = {}) {
  return [
    event(startSeq, 'turn/start', { turn }, time),
    event(startSeq + 1, 'step/start', { turn, step: 1 }, time + 1),
    attempt(startSeq + 2, { turn, sample: failed }),
    event(startSeq + 3, 'llm/retry', { turn, step: 1 }, time + 2),
    event(startSeq + 4, 'llm/retry-started', { turn, step: 1, retry: 1 }, time + 3),
    event(startSeq + 5, 'assistant/message', {
      turn,
      step: 1,
      message: message('message-retry'),
      stream: usageStream(retried),
      usage: retried,
    }, time + 4),
    event(startSeq + 6, 'step/end', { turn, step: 1 }, time + 5),
    event(startSeq + 7, 'turn/end', { turn, reason: { kind: 'completed' } }, time + 6),
  ]
}

/** One turn whose stream usage and settlement disagree; the settlement is later. */
export function replacedSampleTurn(startSeq, { turn = 1, time = JANUARY_15, streamed, settled } = {}) {
  return [
    event(startSeq, 'turn/start', { turn }, time),
    event(startSeq + 1, 'step/start', { turn, step: 1 }, time + 1),
    event(startSeq + 2, 'assistant/message', {
      turn,
      step: 1,
      message: message('message-replaced'),
      stream: usageStream(streamed),
      usage: settled,
    }, time + 2),
    event(startSeq + 3, 'step/end', { turn, step: 1 }, time + 3),
    event(startSeq + 4, 'turn/end', { turn, reason: { kind: 'completed' } }, time + 4),
  ]
}

/** One turn that never closed: the process died, so its usage is unprovable. */
export function hangingTurn(startSeq, { turn = 1, time = JANUARY_15, sample } = {}) {
  return [
    event(startSeq, 'turn/start', { turn }, time),
    ...step(startSeq + 1, { turn, sample, time: time + 1 }),
  ]
}

/** One closed turn whose model reported no usage at all. */
export function silentTurn(startSeq, { turn = 1, time = JANUARY_15 } = {}) {
  return closedTurn(startSeq, { turn, time, samples: [undefined] })
}
