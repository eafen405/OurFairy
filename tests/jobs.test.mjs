import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun } from './helpers/backend.mjs'

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
async function start() {
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-jobs-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
}
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
before(async () => {
  model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
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
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: noticeIndex > latestUser ? 'REPORT: original job finished' : result ? `RESULT:${JSON.stringify(result.content)}` : 'CHAT: independent reply' } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: command?.text.startsWith('{"name":') && !result && noticeIndex < latestUser ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' }); res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  await start()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  for (const name of ['jobs-alice', 'jobs-bob']) {
    const invite = await request('/identity/invite', admin.token)
    const user = await request('/identity/register', undefined, { name, password, inviteCode: invite.invite.code })
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
  const observer = new AbortController()
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }), signal: observer.signal })
  const reader = response.body.getReader(); await reader.read(); observer.abort()
  await send(alice, sessionId, '__CHAT__')
  await until(() => projection(alice, sessionId), p => p.messages.some(m => m.text === 'CHAT: independent reply'), 'dialogue while job runs')
  const terminal = await until(() => projection(alice, sessionId), p => p.tasks[0].status === 3 && p.tasks[0].report.status === 3, 'original completion report')
  assert.ok(terminal.messages.some(m => m.text === 'REPORT: original job finished'))
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
  await send(alice, sessionId, '__CHAT__')
  await until(() => projection(alice, sessionId), p => p.replyStatus === 0 && p.tasks[0].report.status >= 3, 'cancel/report settled')
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
  const unavailable = (await request('/chat/jobs/output', alice.token, { sessionId, taskId: denied.taskId, from: 0 })).output
  assert.equal(unavailable.availability, 0); assert.equal(unavailable.lossy, true); assert.deepEqual(unavailable.chunks, [])
  assert.equal((await request('/chat/jobs/stop', alice.token, { sessionId, taskId: denied.taskId })).outcome, 0)
  const fresh = await startJob(alice, sessionId, 'printf fresh')
  assert.notEqual(fresh.taskId, denied.taskId)
  await until(() => projection(alice, sessionId), p => p.tasks.find(t => t.taskId === fresh.taskId)?.report.status === 3, 'fresh post-restart work settled')
  // The crashed Host cannot settle the original record. The fixture's bounded orphan, if any, must finish before global teardown checks it.
  await new Promise(resolve => setTimeout(resolve, 2000))
  if (process.env.T13_WIRE_SAMPLE) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.T13_WIRE_SAMPLE, JSON.stringify({ task: known, output: unavailable,
      stop: await request('/chat/jobs/stop', alice.token, { sessionId, taskId: denied.taskId }) }, null, 2) + '\n')
  }
})
