/** Activity episodes are summaries of native Session prefixes, never a separate log. */
import { taskHistory } from './jobs.mjs'

/** Derive persistent episode identifiers and current activity from the same session facts. */
export function projectActivity(events, sessionId, tasks, running) {
  let episode
  let completed
  let delivery
  let executing = false
  let parked = false
  let latestOutput
  const decisions = new Set()
  const unavailable = new Set()
  const begin = seq => { episode ??= { episodeId: `${sessionId}/${seq}`, startedSeq: seq } }
  taskHistory(events, (event, rows, pending) => {
    const data = event.data
    if (event.type === 'session/end-seed') {
      // Restored process-local work has no continuation guarantee; later real turns need their own episode.
      const lost = rows.filter(row => ['running', 'stopping'].includes(row.status) || [1, 2].includes(row.report.status))
      if (lost.length > 0 || decisions.size > 0) episode = undefined
      for (const row of lost) unavailable.add(row.taskId)
      decisions.clear()
      parked = true
    }
    if (event.type === 'agent/inbox/spliced' && data.inserted.some(message => message.source?.kind === 'user')) parked = false
    if (event.type === 'turn/start') { executing = true; parked = false }
    else if (event.type === 'turn/end') { executing = false; if (data.reason.kind !== 'completed') parked = true }
    else if (event.type === 'jobs/lifecycle') {
      const id = `${data.generation}/${data.job.id}`
      if (data.phase === 'settled') decisions.add(id)
      else if (data.phase === 'removed') decisions.delete(id)
    } else if (event.type === 'jobs/report') decisions.delete(`${data.generation}/${data.jobId}`)
    const waking = !parked && pending.some(message => message.source?.kind === 'user')
    const working = executing || waking || decisions.size > 0 || rows.some(row => !unavailable.has(row.taskId) && (['running', 'stopping'].includes(row.status) || [1, 2].includes(row.report.status)))
    if (working) begin(event.seq)
    if (event.type === 'delivery/message') {
      begin(event.seq)
      delivery = { episodeId: episode.episodeId, seq: event.seq }
      latestOutput = event.seq
    } else if (['assistant/message', 'assistant/attempt'].includes(event.type)) latestOutput = event.seq
    if (episode !== undefined && latestOutput >= episode.startedSeq) episode.outputSeq = latestOutput
    if (!working && episode !== undefined) {
      completed = { ...episode, finishedSeq: event.seq }
      episode = undefined
    }
  })
  const reasons = [
    ...(running ? [1] : []),
    ...(tasks.some(task => [1, 2].includes(task.status)) ? [2] : []),
    ...(tasks.some(task => [1, 2].includes(task.report.status)) ? [3] : []),
  ]
  const unknown = tasks.some(task => task.status === 0 || task.report.status === 6)
  if (running && episode === undefined) {
    if (completed !== undefined) episode = { episodeId: completed.episodeId, startedSeq: completed.startedSeq }
    else begin(events.at(-1)?.seq ?? 0)
  }
  const current = episode ?? completed
  if (delivery !== undefined && delivery.episodeId === current?.episodeId) reasons.push(4)
  return { status: reasons.some(reason => reason !== 4) ? 2 : unknown ? 0 : 1,
    reasons, episodeId: current?.episodeId ?? null, startedSeq: current?.startedSeq ?? null,
    throughSeq: events.at(-1)?.seq ?? -1,
    ...(completed === undefined ? {} : { completed }), ...(delivery === undefined ? {} : { delivery }) }
}
