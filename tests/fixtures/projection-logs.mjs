/**
 * Fixed native logs and live-registry cases for the projection fixtures.
 *
 * These are the logs ticket #89 used to pin the units against the per-read full
 * folds. Ticket #90 deleted those folds, so the expected values they produced
 * are frozen in `projection-expected.json`; the builders stay here so the unit
 * tests keep folding the same documented shapes (see
 * `tests/projection-units.test.mjs`).
 */

export const SESSION = 'session-1'

/** One committed native event, at the seq the fixture names. */
export function event(seq, type, data, extra = {}) {
  return { seq, type, time: 1_700_000_000_000 + seq, data, ...extra }
}

export const userMessage = (id, text, { rpcId, attachments } = {}) => ({
  id, role: 'user', content: [{ type: 'text', text }],
  source: { kind: 'user', ...(rpcId === undefined ? {} : { rpcId }), ...(attachments === undefined ? {} : { attachments }) },
})
export const assistantMessage = (id, text) => ({ id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } })
export const noticeMessage = (id, text) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'tool-jobs' } })
export const attachment = (uploadId, bytes) => ({ uploadId, name: `${uploadId}.png`, mime: 'image/png',
  original: { name: `${uploadId}.png`, mime: 'image/png', bytes }, image: { width: 4, height: 4 } })

/** A compact assistant stream carrying only visible text, as the log stores it. */
export const textStream = text => [{ type: 'text-chunks', time0: 1, index: 0, dt: [0], texts: [text] }]

export const job = (overrides = {}) => ({ id: 'job-1', kind: 'task', label: 'work', status: 'running', startedAt: 10,
  output: { earliest: 0, total: 0 }, ...overrides })

/**
 * One transcript-focused log: a queued message spliced then appended, an
 * assistant message, a settled attempt, a delivery, an interrupted assistant
 * message, and two ignored shapes (a replacement surface copy and a
 * non-user-authored user message).
 */
export function transcriptLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] })] }),
    event(2, 'user/message', userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] }), { surfaceOp: 'append' }),
    event(3, 'step/start', { turn: 1, step: 1 }),
    event(4, 'assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'hi there'), stream: textStream('hi there') }, { surfaceOp: 'append' }),
    event(5, 'assistant/attempt', { turn: 1, step: 1, stream: textStream('half') }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(7, 'assistant/attempt', { turn: 2, step: 1, stream: textStream('orphan') }),
    event(8, 'user/message', userMessage('u-replacement', 'replaced copy'), { surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } }),
    event(9, 'user/message', noticeMessage('n1', 'notice'), { surfaceOp: 'append' }),
    event(10, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' }, message: assistantMessage('dmsg', 'delivered') }, { surfaceOp: 'append' }),
    event(11, 'assistant/message', { turn: 2, step: 1, message: assistantMessage('a2', 'cut off'), stream: textStream('cut off'), interrupted: true }, { surfaceOp: 'append' }),
  ]
}

/**
 * One task/activity-focused log: a background task settles, its completion is
 * queued, a turn consumes the notice, another turn is aborted, and a restored
 * process-local task closes the log.
 */
export function workLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'start a job', { rpcId: 'r1' })] }),
    event(2, 'user/message', userMessage('u1', 'start a job', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(3, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() }),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(5, 'jobs/lifecycle', { generation: 'g1', phase: 'settled', job: job({ status: 'completed', finishedAt: 20 }) }),
    event(6, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'wakeup', messageId: 'n1' }),
    event(7, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 0, inserted: [noticeMessage('n1', 'job done')] }),
    event(8, 'turn/start', { turn: 2 }),
    event(9, 'user/message', noticeMessage('n1', 'job done'), { surfaceOp: 'append' }),
    event(10, 'assistant/message', { turn: 2, step: 1, message: assistantMessage('a2', 'done'), stream: textStream('done') }, { surfaceOp: 'append' }),
    event(11, 'turn/end', { turn: 2, reason: { kind: 'aborted' } }),
    event(12, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job({ id: 'job-2', status: 'stopping', startedAt: 30 }) }),
    event(13, 'session/end-seed', {}),
  ]
}

/** A log whose queued task notice is discarded from the inbox rather than delivered. */
export function canceledNoticeLog() {
  return [
    event(0, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() }),
    event(1, 'jobs/lifecycle', { generation: 'g1', phase: 'settled', job: job({ status: 'failed', finishedAt: 20, detail: 'exit code: 3' }) }),
    event(2, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'failed', messageId: 'n1', reason: 'no delivery' }),
    event(3, 'agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 0, inserted: [noticeMessage('n1', 'job failed')] }),
    event(4, 'agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' }),
    event(5, 'turn/start', { turn: 1 }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'error' } }),
  ]
}

/** A restored log: real work ran before a restart, then the seed marker closes it. */
export function restoredLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job({ status: 'running' }) }),
    event(2, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'quiet-context', messageId: 'q1' }),
    event(3, 'session/end-seed', { inherited: true }),
  ]
}

/** One delivery and one removed job inside a single episode, for its own summary fields. */
export function deliveryLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' }, message: assistantMessage('dmsg', 'delivered') }, { surfaceOp: 'append' }),
    event(2, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() }),
    event(3, 'jobs/lifecycle', { generation: 'g1', phase: 'settled', job: job({ status: 'completed', finishedAt: 20 }) }),
    event(4, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'none' }),
    event(5, 'jobs/lifecycle', { generation: 'g1', phase: 'removed', job: job({ status: 'completed', finishedAt: 20 }) }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/** The work cases frozen in `projection-expected.json`, in the same order. */
export function workCases() {
  return [
    { log: workLog(), running: false, liveJobs: [] },
    { log: workLog(), running: false, liveJobs: [job({ status: 'running' })] },
    { log: workLog(), running: false, liveJobs: [job({ status: 'running' }), job({ id: 'job-2', status: 'running' })] },
    { log: workLog(), running: true, liveJobs: [job({ status: 'running' })] },
    // A live job whose id belongs to an older registry generation never matches.
    { log: workLog(), running: false, liveJobs: [job({ status: 'running', owner: 'session-1' })] },
    { log: workLog(), running: false, liveJobs: [job({ status: 'running', owner: 'session-2' })] },
    { log: canceledNoticeLog(), running: false, liveJobs: [] },
    { log: canceledNoticeLog(), running: true, liveJobs: [job({ status: 'failed', finishedAt: 20, detail: 'exit code: 3' })] },
    { log: restoredLog(), running: false, liveJobs: [job({ status: 'running' })] },
    { log: restoredLog(), running: true, liveJobs: [] },
    { log: deliveryLog(), running: false, liveJobs: [] },
    { log: deliveryLog(), running: false, liveJobs: [job({ status: 'completed', finishedAt: 20 })] },
    { log: deliveryLog(), running: true, liveJobs: [] },
    { log: [], running: false, liveJobs: [] },
    { log: [], running: true, liveJobs: [] },
  ]
}
