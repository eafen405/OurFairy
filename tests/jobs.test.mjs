/**
 * @covers backend/chat — this suite drives `/chat/jobs/output`,
 * `/chat/jobs/stop`, `/chat/observe` and `/chat/stop` through the product's own
 * routes rather than importing the package.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { before, after, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks, writeOverlay } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-jobs-')
const password = 'jobs-test-password'
let port, model, modelPort, admin, alice, bob
let serial = 0
async function request(path, token, body = {}, status = 200) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, status, JSON.stringify(value))
  return value
}
async function until(read, accept, label) {
  const end = Date.now() + 15000
  let value
  while (Date.now() < end) {
    value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`)
}
const projection = (user, sessionId) => request('/chat/read', user.token, { sessionId }).then(r => r.projection)
async function send(user, sessionId, text) {
  return request('/chat/send', user.token, { sessionId, text, requestId: `jobs-${++serial}` })
}
async function startJob(user, sessionId, command) {
  const before = (await projection(user, sessionId)).tasks?.length ?? 0
  await send(user, sessionId, JSON.stringify({ name: 'bash', args: { description: 'Run bounded background fixture', command, run_in_background: true } }))
  return (await until(() => projection(user, sessionId), p => p.tasks?.length > before, 'background task appeared')).tasks.at(-1)
}
async function start(overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-jobs-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
}
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
before(async () => {
  model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(data, res)) return
    const body = JSON.parse(data)
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const latestUser = blocks.findLastIndex(c => c.type === 'text' && (c.text.startsWith('{"name":') || c.text.startsWith('__')))
    const command = blocks[latestUser]
    const noticeIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('background job '))
    const result = blocks.slice(latestUser + 1).findLast(c => c.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'jobs-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (command?.text === '__HOLD__' && noticeIndex < latestUser) return
    if (command?.text.startsWith('{"name":') && !result && noticeIndex < latestUser) {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `jobs-call-${serial}`, name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: noticeIndex > latestUser ? 'REPORT: original job finished' : result ? `RESULT:${JSON.stringify(toolResultBlocks(result))}` : 'CHAT: independent reply' } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: command?.text.startsWith('{"name":') && !result && noticeIndex < latestUser ? 'tool_use' : noticeIndex > latestUser && command?.text.includes('FAIL_REPORT') ? 'max_tokens' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' }); res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  await start()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  for (const name of ['jobs-alice', 'jobs-bob']) {
    const user = await registerUser(port, admin.token, name, password)
    if (!alice) alice = user; else bob = user
  }
})
after(async () => {
  try { await stop() } finally {
    model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); removeHome(home)
  }
})

test('actual confined job survives phone observation, permits dialogue, and reports into its original session', async () => {
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  const task = await startJob(alice, sessionId, "printf '你好'; sleep 1; printf '完成'")
  assert.equal(task.status, 1); assert.equal(task.availability, 1)
  const startedActivity = (await projection(alice, sessionId)).activity
  assert.equal(startedActivity.status, 2)
  assert.ok(startedActivity.reasons.includes(2))
  const observer = new AbortController()
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: observer.signal })
  const reader = response.body.getReader(); await reader.read(); observer.abort()
  await send(alice, sessionId, '__CHAT__')
  await until(() => projection(alice, sessionId), p => p.messages.some(m => m.text === 'CHAT: independent reply'), 'dialogue while job runs')
  const terminal = await until(() => projection(alice, sessionId), p => p.tasks[0].status === 3 && p.tasks[0].report.status === 3, 'original completion report')
  assert.ok(terminal.messages.some(m => m.text === 'REPORT: original job finished'))
  assert.equal(terminal.activity.status, 1)
  assert.equal(terminal.activity.completed.episodeId, startedActivity.episodeId)
  const { output } = await request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 })
  assert.equal(output.availability, 1); assert.equal(output.next, 12); assert.equal(output.lossy, false)
  assert.equal(output.chunks.map(c => c.text).join(''), '你好完成')
  const overlap = (await request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 3 })).output
  assert.equal(overlap.chunks[0].at, 0); assert.equal(overlap.next, 12)
})

test('stopping a reply and stopping its real background process are independent, with owned controls', async () => {
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  const task = await startJob(alice, sessionId, "printf running; sleep 10; printf must-not-run")
  await until(() => projection(alice, sessionId), p => p.replyStatus === 0, 'initial reply ended')
  await send(alice, sessionId, '__HOLD__')
  await until(() => projection(alice, sessionId), p => p.attempt !== null, 'held reply')
  await request('/chat/stop', alice.token, { sessionId })
  const stopped = await until(() => projection(alice, sessionId), p => p.replyStatus === 0, 'reply stopped')
  assert.equal(stopped.tasks[0].status, 1)
  for (const other of [bob, admin]) {
    await request('/chat/jobs/output', other.token, { sessionId, taskId: task.taskId, from: 0 }, 404)
    await request('/chat/jobs/stop', other.token, { sessionId, taskId: task.taskId }, 404)
  }
  const otherSession = (await request('/sessions/create', alice.token)).session.id
  await request('/chat/jobs/output', alice.token, { sessionId: otherSession, taskId: task.taskId, from: 0 }, 404)
  await request('/chat/jobs/stop', alice.token, { sessionId: otherSession, taskId: task.taskId }, 404)
  await request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: -1 }, 400)
  await send(alice, sessionId, '__HOLD__')
  await until(() => projection(alice, sessionId), p => p.attempt !== null, 'second held reply')
  assert.equal((await request('/chat/jobs/stop', alice.token, { sessionId, taskId: task.taskId })).outcome, 1)
  const killed = await until(() => projection(alice, sessionId), p => p.tasks[0].status === 4, 'job killed')
  assert.equal(killed.replyStatus, 1)
  const output = (await request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 })).output
  assert.doesNotMatch(output.chunks.map(c => c.text).join(''), /must-not-run/)
  await request('/chat/stop', alice.token, { sessionId })
  const canceledReport = await until(() => projection(alice, sessionId), p => p.replyStatus === 0, 'held report reply stopped')
  assert.equal(canceledReport.tasks[0].report.status, 4)
  assert.equal(canceledReport.activity.status, 1)
  await send(alice, sessionId, '__CHAT__')
  await until(() => projection(alice, sessionId), p => p.replyStatus === 0 && p.tasks[0].report.status >= 3, 'cancel/report settled')
})

test('stopping the same real job twice reports requested first and already-finished after it settles', async () => {
  // A fresh session keeps this case independent of the tasks other cases leave
  // behind: the projection's only task is the one this case starts.
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  const task = await startJob(alice, sessionId, 'printf running; sleep 30; printf must-not-run')
  await until(() => request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 }),
    response => response.output.next > 0, 'the real job started writing before the stop')

  const first = await request('/chat/jobs/stop', alice.token, { sessionId, taskId: task.taskId })
  assert.equal(first.outcome, 1, 'a running job reports that cancellation was requested')
  await until(() => projection(alice, sessionId), p => p.tasks[0].status === 4, 'the stopped job settled')

  const second = await request('/chat/jobs/stop', alice.token, { sessionId, taskId: task.taskId })
  assert.equal(second.outcome, 2, 'the same job reports already-finished after it settled')
})

test('producer-side loss exposes missing output rather than treating a terminal status as complete output', async () => {
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  const task = await startJob(alice, sessionId, `node -e "process.stdout.write('你'.repeat(120000))"; sleep .3; printf END`)
  await until(() => projection(alice, sessionId), p => p.tasks[0].status === 3, 'large job finished')
  const { output } = await request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 })
  assert.ok(output.lossy || output.chunks.some(chunk => chunk.gapBefore === true))
  assert.ok(output.next > 0)
  assert.ok(output.chunks.map(c => c.text).join('').endsWith('END'))
})

test('registry retention preserves absolute byte offsets and explicitly marks an evicted prefix', async () => {
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  const task = await startJob(alice, sessionId, `node -e "let n=0; const timer=setInterval(()=>{process.stdout.write('你'.repeat(18000)); if(++n===8) clearInterval(timer)},250)"; printf END`)
  await until(() => projection(alice, sessionId), p => p.tasks[0].status === 3, 'paced output job finished')
  const { output } = await request('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 })
  assert.ok(output.earliest > 0)
  assert.equal(output.lossy, true)
  assert.ok(output.next > 262144)
  assert.equal(output.chunks[0].at, output.earliest)
  assert.ok(output.chunks.map(c => c.text).join('').endsWith('END'))
})

test('confined detached scripts cannot read another user and old task identities stay unavailable after restart', async () => {
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  const foreign = `${home}/dsh-home/spaces/private/${bob.user.shortId}/job-secret.txt`
  const bobSession = (await request('/sessions/create', bob.token)).session.id
  const bobTask = await startJob(bob, bobSession, `printf bob-secret > '${foreign}'`)
  await until(() => projection(bob, bobSession), p => p.tasks[0].status === 3, 'foreign fixture ready')
  const denied = await startJob(alice, sessionId, `if cat '${foreign}'; then printf LEAK; else printf blocked; fi`)
  await until(() => projection(alice, sessionId), p => p.tasks[0].status === 3, 'confined job finished')
  const denial = (await request('/chat/jobs/output', alice.token, { sessionId, taskId: denied.taskId, from: 0 })).output
  const text = denial.chunks.map(c => c.text).join('')
  assert.match(text, /blocked/); assert.doesNotMatch(text, /bob-secret|LEAK/)
  await until(() => projection(alice, sessionId), p => p.tasks[0].report.status === 3, 'known completed report')
  const live = await startJob(alice, sessionId, 'printf ready; sleep 2')
  await until(() => request('/chat/jobs/output', alice.token, { sessionId, taskId: live.taskId, from: 0 }), r => r.output.next > 0, 'real child started before crash')
  await request('/chat/checkpoint', alice.token, { sessionId })
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const pid = JSON.parse(readFileSync(join(home, 'run', 'backend.json'), 'utf8')).pid
  process.kill(-pid, 'SIGKILL')
  await until(async () => {
    try { process.kill(pid, 0); return false }
    catch (error) { if (error.code === 'ESRCH') return true; throw error }
  }, gone => gone, 'crashed Host fully exited before launcher cleanup')
  await stop(); await start()
  const recovered = await projection(alice, sessionId)
  const known = recovered.tasks.find(t => t.taskId === denied.taskId)
  assert.equal(known.status, 3); assert.equal(known.availability, 0); assert.equal(known.report.status, 3)
  const lost = recovered.tasks.find(t => t.taskId === live.taskId)
  assert.equal(lost.availability, 0)
  assert.equal(lost.status, 0)
  assert.equal(recovered.activity.status, 0)
  const unavailable = (await request('/chat/jobs/output', alice.token, { sessionId, taskId: denied.taskId, from: 0 })).output
  assert.equal(unavailable.availability, 0); assert.equal(unavailable.lossy, true); assert.deepEqual(unavailable.chunks, [])
  assert.equal((await request('/chat/jobs/stop', alice.token, { sessionId, taskId: denied.taskId })).outcome, 0)
  const fresh = await startJob(alice, sessionId, 'printf fresh')
  assert.notEqual(fresh.taskId, denied.taskId)
  const freshProjection = await until(() => projection(alice, sessionId), p => p.tasks.find(t => t.taskId === fresh.taskId)?.report.status === 3, 'fresh post-restart work settled')
  assert.notEqual(freshProjection.activity.completed.episodeId, recovered.activity.episodeId)
  assert.ok(freshProjection.activity.completed.finishedSeq > recovered.activity.throughSeq)
  // The crashed Host cannot settle the original record. The fixture's bounded orphan, if any, must finish before global teardown checks it.
  await new Promise(resolve => setTimeout(resolve, 2000))
  if (process.env.T13_WIRE_SAMPLE) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.T13_WIRE_SAMPLE, JSON.stringify({ task: known, output: unavailable,
      stop: await request('/chat/jobs/stop', alice.token, { sessionId, taskId: denied.taskId }) }, null, 2) + '\n')
  }
})


async function activityObserver(user, sessionId) {
  const controller = new AbortController(), frames = []
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', headers: {
    authorization: `Bearer ${user.token}`, 'content-type': 'application/json',
  }, body: JSON.stringify({ sessionId }), signal: controller.signal })
  const done = (async () => {
    let buffered = ''
    const decoder = new TextDecoder()
    for await (const chunk of response.body) {
      buffered += decoder.decode(chunk, { stream: true })
      let end
      while ((end = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2)
        const data = frame.split('\n').find(line => line.startsWith('data: '))
        if (data) frames.push(JSON.parse(data.slice(6)))
      }
    }
  })().catch(error => { if (!controller.signal.aborted) throw error })
  return { frames, async close() { controller.abort(); await done } }
}

test('two sessions stay independent and real job settlement never publishes an intermediate quiet episode', async () => {
  const first = (await request('/sessions/create', alice.token)).session.id
  // The job's user message makes the first session non-empty, so the second
  // create is a genuinely different session rather than the reusable empty one.
  await startJob(alice, first, 'sleep .8; printf done')
  const second = (await request('/sessions/create', alice.token)).session.id
  assert.notEqual(second, first, 'a session with content is not reused as the second session')
  const observation = await activityObserver(alice, first)
  try {
    await until(async () => observation.frames, frames => frames.length > 0, 'activity observer opened')
    const episodeId = observation.frames[0].activity.episodeId
    await send(alice, second, '__CHAT__')
    const quietSecond = await until(() => projection(alice, second), p => p.replyStatus === 0 && p.messages.length >= 2, 'second session finished')
    assert.equal(quietSecond.activity.status, 1)
    assert.notEqual(quietSecond.activity.episodeId, episodeId)
    assert.equal((await projection(alice, first)).activity.status, 2)
    await until(() => projection(alice, first), p => p.tasks[0].report.status === 3 && p.activity.status === 1, 'first session finished')
    await until(async () => observation.frames, frames => frames.at(-1)?.activity.status === 1, 'final activity frame')
    const states = observation.frames.map(p => p.activity)
    assert.ok(states.every(activity => activity.episodeId === episodeId))
    const firstQuiet = states.findIndex(activity => activity.status === 1)
    assert.ok(firstQuiet > 0)
    assert.ok(states.slice(firstQuiet).every(activity => activity.status === 1))
    assert.equal(states.at(-1).completed.episodeId, episodeId)
    if (process.env.T14_WIRE_SAMPLE) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(process.env.T14_WIRE_SAMPLE, JSON.stringify(states.at(-1), null, 2) + '\n')
    }
  } finally { await observation.close() }
})

test('an awaited result and a failed report both settle without holding terminal tasks active', async () => {
  const awaitedSession = (await request('/sessions/create', alice.token)).session.id
  const task = await startJob(alice, awaitedSession, 'sleep .7; printf collected')
  const nativeId = task.taskId.slice(task.taskId.indexOf('/') + 1)
  await send(alice, awaitedSession, JSON.stringify({ name: 'job_output', args: { job_id: nativeId, wait: true } }))
  const awaited = await until(() => projection(alice, awaitedSession), p => p.tasks[0].status === 3 && p.replyStatus === 0, 'awaited job result')
  assert.equal(awaited.tasks[0].report.status, 0)
  assert.equal(awaited.activity.status, 1)
  const failedSession = (await request('/sessions/create', alice.token)).session.id
  await startJob(alice, failedSession, 'sleep .3; printf FAIL_REPORT')
  const failed = await until(() => projection(alice, failedSession), p => p.tasks[0].report.status === 5 && p.replyStatus === 0, 'failed report settled')
  assert.equal(failed.activity.status, 1)
  assert.ok(!failed.activity.reasons.includes(3))
})

test('configured quiet completion leaves context for later without inventing pending inference', async () => {
  await stop()
  const overlay = writeOverlay(home, [{ id: 'tool-jobs', config: { completionDelivery: 'quiet' } }], 'quiet.patch.yml')
  await start([overlay])
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  await startJob(alice, sessionId, 'sleep .3; printf quiet-result')
  const quiet = await until(() => projection(alice, sessionId), p => p.tasks[0].status === 3 && p.replyStatus === 0, 'quiet result retained')
  assert.equal(quiet.tasks[0].report.status, 0)
  assert.equal(quiet.activity.status, 1)
  assert.ok(!quiet.messages.some(message => message.text.startsWith('REPORT:')))
  assert.ok(quiet.events.some(event => event.type === 'jobs/report' && event.data.delivery === 'quiet-context'))
  await send(alice, sessionId, '__CHAT__')
  const later = await until(() => projection(alice, sessionId), p => p.tasks[0].report.status === 3, 'quiet context entered later real turn')
  assert.equal(later.activity.status, 1)
  assert.notEqual(later.activity.completed.episodeId, quiet.activity.completed.episodeId)
})

test('accepted consecutive turns form one execution episode and canceled parked input does not stay active', async () => {
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  await send(alice, sessionId, '__HOLD__')
  const first = await until(() => projection(alice, sessionId), p => p.attempt !== null, 'first held execution')
  await send(alice, sessionId, '__CHAT__')
  // Keep the second accepted input while ending the held turn, then explicitly wake it.
  await request('/chat/stop', alice.token, { sessionId })
  const parked = await until(() => projection(alice, sessionId), p => p.replyStatus === 0, 'input parked after stop')
  assert.equal(parked.activity.status, 1)
  await send(alice, sessionId, '__CHAT__')
  const final = await until(() => projection(alice, sessionId), p => p.replyStatus === 0 && p.messages.filter(m => m.role === 2).length >= 2, 'queued turns drained')
  const waking = final.events.find(event => event.type === 'agent/inbox/spliced' && event.seq > parked.cursor && event.data.inserted.some(message => message.source?.kind === 'user'))
  assert.equal(final.activity.completed.startedSeq, waking.seq)
  assert.notEqual(final.activity.completed.episodeId, first.activity.episodeId)
})
