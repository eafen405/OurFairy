/**
 * @covers backend/delivery — this suite drives the row through the product's
 * chat and HTTP routes rather than importing it.
 * @covers backend/groups — one case calls the `groups` tool so the next turn
 * carries a tool result alongside the delivered text.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { before, after, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks, writeOverlay } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-delivery-')
const password = 'group-test-password'
let port, model, modelPort, admin, alice, bob
let senderSession, heldReply
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const modelRequests = []
async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}
function user(name) { return registerUser(port, admin.token, name, password) }
let requestNo = 0
async function tool(user, name, args, sessionId, callId = `delivery-call-${requestNo + 1}`) {
  sessionId ??= (await request('/sessions/create', user.token)).session.id
  const seen = new Set((await request('/chat/read', user.token, { sessionId })).projection.messages.map(m => m.messageId))
  await request('/chat/send', user.token, { sessionId, requestId: `tool-request-${++requestNo}`, text: JSON.stringify({ name, args, callId }) })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', user.token, { sessionId })
    const terminal = projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:'))
    const fresh = terminal.find(m => !seen.has(m.messageId))
    if (fresh) return fresh.text.slice(7)
    if (projection.error) assert.fail(`chat failed before tool result: ${projection.error}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`tool ${name} reply was not returned to original chat ${sessionId}`)
}
/** The receipt one `deliver_message` call rendered back to the sender. */
async function deliveryReceipt(user, args, sessionId, callId) {
  const blocks = JSON.parse(await tool(user, 'deliver_message', args, sessionId, callId))
  const receipt = blocks[0].text.startsWith('{') ? JSON.parse(blocks[0].text) : assert.fail(`delivery failed: ${blocks[0].text}`)
  assert.match(receipt.deliveryId, /^[0-9a-f]{64}$/)
  return receipt
}
/**
 * The two sessions a self-delivery case needs: the fixed primary, filled so the
 * next create materializes an ordinary session, and that origin conversation.
 */
async function selfDeliverySessions(user) {
  const primary = (await request('/sessions/primary', user.token)).session.id
  await tool(user, 'groups', {}, primary)
  const origin = (await request('/sessions/create', user.token)).session.id
  assert.notEqual(origin, primary)
  return { primary, origin }
}
/** Run one statement through a short-lived handle; the fault trigger is the only use. */
function runSql(statement) {
  const db = new DatabaseSync(join(home, 'dsh-home', 'identity', 'identity.sqlite'))
  try { db.exec(statement) } finally { db.close() }
}
async function startBackend(overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-group-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
}
async function stopBackend() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
before(async () => {
  model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(data, res)) return
    const body = JSON.parse(data); modelRequests.push(body)
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const commandIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = blocks.slice(commandIndex + 1).findLast(c => c.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'group-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (!result && JSON.parse(command.text).name === 'hold_reply') {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Recipient is still writing' } })
      heldReply = () => {
        emit({ type: 'content_block_stop', index: 0 })
        emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
        emit({ type: 'message_stop' }); res.end(); heldReply = undefined
      }
      return
    }
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(toolResultBlocks(result))}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.callId, name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  await startBackend()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('group-alice'); bob = await user('group-bob')
})
after(async () => {
  heldReply?.(); await stopBackend(); await new Promise(resolve => model.close(resolve)); removeHome(home)
})
test('Fairy delivers only selected text to a cold primary without recipient inference', async () => {
  senderSession = (await request('/sessions/create', alice.token)).session.id
  const before = modelRequests.length
  const result = await tool(alice, 'deliver_message', { recipientShortId: bob.user.shortId, text: 'Only this selected text.' }, senderSession)
  assert.match(result, /deliveryId/)
  assert.equal(modelRequests.length - before, 2, 'only sender tool turn and result; no recipient inference')
  const target = (await request('/sessions/primary', bob.token)).session.id
  const { projection } = await request('/chat/read', bob.token, { sessionId: target })
  assert.deepEqual(projection.messages.map(m => [m.role,m.text]), [[2,'Only this selected text.']])
  const delivered = projection.events.find(e => e.type === 'delivery/message')
  assert.equal(delivered.data.origin.sessionId, senderSession)
  assert.equal(delivered.data.origin.owner, `user:${alice.user.shortId}`)
  for (const key of ['turn','step','stream']) assert.equal(key in delivered.data, false)
  assert.equal(modelRequests.length - before, 2)
  assert.equal(projection.activity.status, 1)
  assert.deepEqual(projection.activity.reasons, [4])
  assert.equal(projection.activity.delivery.seq, delivered.seq)
  assert.equal(projection.activity.completed.startedSeq, delivered.seq)
  assert.equal(projection.activity.completed.finishedSeq, delivered.seq)
})

async function eventually(work, check) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = await work()
    if (check(value)) return value
    await delay(25)
  }
  assert.fail('condition not reached')
}
async function observe(token, sessionId) {
  const controller = new AbortController(), frames = []
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({sessionId}) })
  assert.equal(response.status,200)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  const settled = (async () => {
    let buffer = ''
    for (;;) {
      const {done,value} = await reader.read()
      if (done) return
      buffer += decoder.decode(value,{stream:true})
      let end
      while ((end=buffer.indexOf('\n\n')) >= 0) {
        const event=buffer.slice(0,end); buffer=buffer.slice(end+2)
        const line=event.split('\n').find(line=>line.startsWith('data: '))
        if (line) frames.push(JSON.parse(line.slice(6)))
      }
    }
  })().catch(error=>{ if (!controller.signal.aborted) throw error })
  return {frames, async close(){controller.abort(); await settled}}
}
test('live delivery remains independent of the recipient active attempt and later model history includes it', async () => {
  const target = (await request('/sessions/primary', bob.token)).session.id
  await request('/chat/send', bob.token, { sessionId: target, requestId: 'hold-recipient', text: JSON.stringify({ name: 'hold_reply', args: {} }) })
  const active = await eventually(() => request('/chat/read', bob.token, { sessionId: target }), value => value.projection.attempt?.text === 'Recipient is still writing')
  const observation = await observe(bob.token,target)
  const before = modelRequests.length
  assert.match(await tool(alice, 'deliver_message', { recipientShortId: bob.user.shortId, text: 'Delivered during your reply' }, senderSession), /deliveryId/)
  const during = (await request('/chat/read', bob.token, { sessionId: target })).projection
  assert.equal(during.activity.status, 2)
  assert.equal(during.activity.episodeId, active.projection.activity.episodeId)
  assert.ok(during.activity.reasons.includes(4))
  assert.equal(during.activity.delivery.episodeId, active.projection.activity.episodeId)
  assert.equal(during.attempt.attemptId, active.projection.attempt.attemptId)
  assert.equal(during.attempt.text, 'Recipient is still writing')
  assert.equal(during.messages.filter(m => m.text === 'Delivered during your reply').length, 1)
  assert.equal(modelRequests.length - before, 2, 'delivery did not dispatch recipient inference')
  const frame = await eventually(async()=>observation.frames.at(-1), value=>value?.messages.some(m=>m.text==='Delivered during your reply'))
  assert.equal(frame.attempt.attemptId,active.projection.attempt.attemptId)
  assert.equal(frame.attempt.text,'Recipient is still writing')
  await observation.close()
  heldReply()
  await eventually(() => request('/chat/read', bob.token, { sessionId: target }), value => value.projection.replyStatus === 0)
  await tool(bob, 'groups', {}, target)
  const nextInput = JSON.stringify(modelRequests.at(-1).messages)
  assert.match(nextInput, /Only this selected text/)
  assert.match(nextInput, /Delivered during your reply/)
})

test('native log success with failed business update recovers after restart and exact retry stays single', async () => {
  const recipient = await user('recovery-recipient')
  const db = new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  db.exec(`CREATE TRIGGER fail_delivery_update BEFORE UPDATE ON deliveries WHEN NEW.recipient_short_id = ${recipient.user.shortId}
    BEGIN SELECT RAISE(ABORT, 'injected business update failure'); END`)
  const args = { recipientShortId: recipient.user.shortId, text: 'Durable before coordination' }
  assert.match(await tool(alice, 'deliver_message', args, senderSession, 'recovery-stable-call'), /injected business update failure/)
  const row = db.prepare('SELECT * FROM deliveries WHERE recipient_short_id = ?').get(recipient.user.shortId)
  assert.equal(row.status, 0)
  const target = (await request('/sessions/primary', recipient.token)).session.id
  const delivered = (await request('/chat/read', recipient.token, {sessionId:target})).projection.events.filter(e => e.type === 'delivery/message')
  assert.equal(delivered.length,1)
  await stopBackend(); await startBackend() // recovery encounters the same temporary business failure
  db.exec('DROP TRIGGER fail_delivery_update')
  assert.match(await tool(alice,'deliver_message',args,senderSession,'recovery-stable-call'), /deliveryId/)
  const recovered = db.prepare('SELECT * FROM deliveries WHERE delivery_id = ?').get(row.delivery_id)
  assert.equal(recovered.status, 1)
  assert.equal(recovered.message_id, delivered[0].data.message.id)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'recovery-stable-call'), /deliveryId/)
  assert.match(await tool(alice,'deliver_message',{...args,text:'changed'},senderSession,'recovery-stable-call'), /different content or recipient/)
  const after = (await request('/chat/read', recipient.token, {sessionId:target})).projection
  assert.equal(after.events.filter(e => e.type === 'delivery/message').length, 1)
  assert.deepEqual(after.messages.map(m=>m.text),[args.text])
  db.close()
})

test('simultaneous senders and recipient primary creation preserve both deliveries without recipient inference', async () => {
  const recipient = await user('racing-recipient')
  const adminSession = (await request('/sessions/create', admin.token)).session.id
  const before = modelRequests.length
  const calls = await Promise.all([
    tool(alice,'deliver_message',{recipientShortId:recipient.user.shortId,text:'Concurrent Alice'},senderSession),
    tool(admin,'deliver_message',{recipientShortId:recipient.user.shortId,text:'Concurrent Phaethon'},adminSession),
    request('/sessions/primary',recipient.token),
  ])
  for (const result of calls.slice(0,2)) assert.match(result,/deliveryId/)
  const target = calls[2].session.id
  const after = (await request('/chat/read', recipient.token,{sessionId:target})).projection
  assert.deepEqual(after.messages.map(m=>m.text).sort(),['Concurrent Alice','Concurrent Phaethon'])
  assert.equal(modelRequests.length-before,4)
  assert.equal(after.events.filter(e=>e.type==='delivery/message').length,2)
})

test('failed native durability checkpoint never confirms and stable retry recovers the same message', async () => {
  const target = (await request('/sessions/primary', bob.token)).session.id
  await stopBackend()
  const fixture = new URL('../backend/chat/test-support/fail-outlets.ts',import.meta.url).pathname
  const layer = writeOverlay(home,[{insert:[{id:'delivery-faults',name:fixture,config:{sessionId:target,failFlush:true}}]}],'flush-failure.patch.yml')
  await startBackend([layer])
  await request('/chat/read',bob.token,{sessionId:target}) // ensure the recipient is live
  const args = {recipientShortId:bob.user.shortId,text:'Checkpoint retry is still one delivery'}
  const failed = await tool(alice,'deliver_message',args,senderSession,'flush-failure-call')
  // The failure must be the injected `session/flush` fault, not a coincidence:
  // this keeps the case from passing vacuously if the live write stops emitting
  // the `delivery/message` event that arms the fixture.
  assert.match(failed,/injected durability checkpoint failure/)
  assert.doesNotMatch(failed,/deliveryId/)
  const db = new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  const pending = db.prepare('SELECT * FROM deliveries WHERE text = ?').get(args.text)
  assert.equal(pending.status,0)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'flush-failure-call'),/deliveryId/)
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE delivery_id = ?').get(pending.delivery_id).status,1)
  const after = (await request('/chat/read',bob.token,{sessionId:target})).projection
  assert.equal(after.messages.filter(m=>m.text===args.text).length,1)
  db.close()
})

test('notification outlet failure preserves durable delivery and successful sender confirmation', async () => {
  const target = (await request('/sessions/primary', bob.token)).session.id
  await stopBackend()
  const fixture = new URL('../backend/chat/test-support/fail-outlets.ts',import.meta.url).pathname
  const layer = writeOverlay(home,[{insert:[{id:'delivery-faults',name:fixture,config:{sessionId:target,failNotification:true}}]}],'notification-failure.patch.yml')
  await startBackend([layer])
  const args = {recipientShortId:bob.user.shortId,text:'Notification trouble does not retract this'}
  assert.match(await tool(alice,'deliver_message',args,senderSession,'notification-failure-call'),/deliveryId/)
  const after = (await request('/chat/read',bob.token,{sessionId:target})).projection
  assert.equal(after.messages.filter(m=>m.text===args.text).length,1)
  const db = new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE text = ?').get(args.text).status,1)
  db.close()
})

test('a self delivery lands in the origin session as a normal Fairy message, and an archived origin falls back', async () => {
  const carol = await user('self-delivery-carol')
  const { primary, origin } = await selfDeliverySessions(carol)
  const text = 'Delivered to myself in this conversation'
  const result = await deliveryReceipt(carol, { recipientShortId: carol.user.shortId, text }, origin, 'self-delivery-call-1')
  assert.equal(result.sessionId, origin, 'the receipt names the session the text landed in')
  const view = (await request('/chat/read', carol.token, { sessionId: origin })).projection
  assert.deepEqual(view.messages.filter(message => message.text === text).map(message => message.role), [2],
    'the delivered text is one ordinary Fairy message in the origin session')
  const delivered = view.events.filter(event => event.type === 'delivery/message')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].data.origin.sessionId, origin)
  assert.equal((await request('/chat/read', carol.token, { sessionId: primary })).projection.messages
    .some(message => message.text === text), false, 'a self delivery must not also land in the primary')
  // The archived session stays readable and writable; only its availability as
  // a landing changes, so this same conversation issues the next delivery.
  await request('/sessions/archive', carol.token, { sessionId: origin })
  const fallbackText = 'Delivered after the origin was archived'
  const fallback = await deliveryReceipt(carol, { recipientShortId: carol.user.shortId, text: fallbackText }, origin, 'self-delivery-call-2')
  assert.equal(fallback.sessionId, primary, 'an archived origin falls back to the primary')
  const primaryView = (await request('/chat/read', carol.token, { sessionId: primary })).projection
  assert.deepEqual(primaryView.messages.filter(message => message.text === fallbackText).map(message => message.role), [2])
  assert.equal((await request('/chat/read', carol.token, { sessionId: origin })).projection.messages
    .some(message => message.text === fallbackText), false)
})

test('a self delivery retry reuses its recorded landing after the origin is archived', async () => {
  const dana = await user('self-retry-dana')
  const { primary, origin } = await selfDeliverySessions(dana)
  const text = 'Retried into the first recorded landing'
  const callId = 'self-retry-landing-call'
  // The unique text confines the refusal to this delivery's business completion.
  // The native append has already succeeded when this trigger fires, which is
  // what makes the row and the log disagree.
  runSql(`CREATE TRIGGER fail_self_retry_update BEFORE UPDATE ON deliveries WHEN NEW.text = '${text}'
    BEGIN SELECT RAISE(ABORT, 'injected business completion failure'); END`)
  assert.match(await tool(dana, 'deliver_message', { recipientShortId: dana.user.shortId, text }, origin, callId),
    /injected business completion failure/)
  // Archiving the origin changes what a fresh landing decision would answer:
  // from now on a self delivery from this conversation falls back to the
  // primary. The retry must reuse the recorded session instead of that answer.
  await request('/sessions/archive', dana.token, { sessionId: origin })
  runSql('DROP TRIGGER fail_self_retry_update')
  const receipt = await deliveryReceipt(dana, { recipientShortId: dana.user.shortId, text }, origin, callId)
  assert.equal(receipt.sessionId, origin, 'the retry receipt names the recorded landing')
  const landed = (await request('/chat/read', dana.token, { sessionId: origin })).projection
  assert.deepEqual(landed.messages.filter(message => message.text === text).map(message => message.role), [2],
    'the retry leaves exactly one ordinary Fairy message in the recorded landing')
  assert.equal((await request('/chat/read', dana.token, { sessionId: primary })).projection.messages
    .some(message => message.text === text), false, 'the retry stays out of the primary')
  // The landing difference is not part of the identity check; the content is.
  assert.match(await tool(dana, 'deliver_message', { recipientShortId: dana.user.shortId, text: `${text} changed` }, origin, callId),
    /different content or recipient/)
})

test('boot recovery settles a pending self delivery into its recorded origin without a tool call', async () => {
  const erin = await user('self-boot-erin')
  const { primary, origin } = await selfDeliverySessions(erin)
  const text = 'Boot recovery lands in the recorded origin'
  await stopBackend()
  const fixture = new URL('../backend/chat/test-support/fail-outlets.ts', import.meta.url).pathname
  const layer = writeOverlay(home, [{ insert: [{ id: 'delivery-faults', name: fixture, config: { sessionId: origin, failFlush: true } }] }],
    'self-boot-flush-failure.patch.yml')
  await startBackend([layer])
  // Make the origin live so the fixture's `session/event` listener can arm the
  // next flush; a cold append would not emit the same event.
  await request('/chat/read', erin.token, { sessionId: origin })
  assert.match(await tool(erin, 'deliver_message', { recipientShortId: erin.user.shortId, text }, origin, 'self-boot-call'),
    /injected durability checkpoint failure/)
  // The archive route needs the running backend. Archiving before the restart
  // means a fresh landing decision would answer the primary.
  await request('/sessions/archive', erin.token, { sessionId: origin })
  await stopBackend()
  await startBackend()
  // The restart is the only caller after this point: startup settlement, not a
  // new tool call, must pick the row up and use its recorded session.
  const recovered = await eventually(() => request('/chat/read', erin.token, { sessionId: origin }),
    value => value.projection.messages.some(message => message.text === text))
  assert.deepEqual(recovered.projection.messages.filter(message => message.text === text).map(message => message.role), [2],
    'startup settlement leaves exactly one ordinary Fairy message in the archived origin')
  assert.equal((await request('/chat/read', erin.token, { sessionId: primary })).projection.messages
    .some(message => message.text === text), false, 'startup settlement stays out of the primary')
})
