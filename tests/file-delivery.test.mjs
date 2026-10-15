import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun } from './helpers/backend.mjs'

const home = makeHome('ourfairy-file-delivery-')
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
async function user(name) {
  const invite = await request('/identity/invite', admin.token)
  return request('/identity/register', undefined, { name, password, inviteCode: invite.invite.code })
}
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
async function startBackend() {
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-group-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
}
async function stopBackend() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
before(async () => {
  model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
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
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result.content)}` } })
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
test('selected private file reaches recipient primary as an independent original reference', async () => {
  senderSession = (await request('/sessions/create', alice.token)).session.id
  const path = join(home,'dsh-home','spaces','private',String(alice.user.shortId),'selected.txt')
  assert.match(await tool(alice,'write',{file_path:path,content:'T12 original 私有文件'},senderSession),/success|wrote|write|create/i)
  const before = modelRequests.length
  const result = await tool(alice,'deliver_message',{recipientShortId:bob.user.shortId,text:'Explicit selected file',files:[{path}]},senderSession,'file-stable-call')
  assert.match(result,/deliveryId/)
  assert.equal(modelRequests.length-before,2,'file delivery does not run recipient inference')
  const target = (await request('/sessions/primary',bob.token)).session.id
  const projection = (await request('/chat/read',bob.token,{sessionId:target})).projection
  const message = projection.messages.find(m=>m.text==='Explicit selected file')
  assert.deepEqual(message.attachments,[{index:0,type:1,name:'selected.txt',mime:'text/plain',bytes:Buffer.byteLength('T12 original 私有文件')}])
  const response = await fetch(`http://127.0.0.1:${port}/attachments/download`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bob.token}`},body:JSON.stringify({sessionId:target,messageId:message.messageId,index:0})})
  assert.equal(response.status,200)
  assert.equal(await response.text(),'T12 original 私有文件')
  const delivery = projection.events.find(e=>e.type==='delivery/message')
  assert.ok(!JSON.stringify(delivery.data).includes(path),'receiver event must not disclose private source path')
  assert.equal(delivery.data.message.source.kind,'delivered-message')
})

async function primary(who) { return (await request('/sessions/primary',who.token)).session.id }
async function projection(who,id) { return (await request('/chat/read',who.token,{sessionId:id})).projection }
async function download(who,id,messageId,index) {
  const response = await fetch(`http://127.0.0.1:${port}/attachments/download`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${who.token}`},body:JSON.stringify({sessionId:id,messageId,index})})
  return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())}
}
test('same identity resumes unfinished preparation after restart without rereading its already prepared file', async () => {
  const recipient = await user('file-recovery'), target = await primary(recipient)
  const root = join(home,'dsh-home','spaces','private',String(alice.user.shortId))
  const first = join(root,'first.txt'), second = join(root,'later.txt')
  await tool(alice,'write',{file_path:first,content:'FIRST IMMUTABLE'},senderSession)
  const args = {recipientShortId:recipient.user.shortId,text:'Both originals',files:[{path:first},{path:second}]}
  const failed = await tool(alice,'deliver_message',args,senderSession,'preparation-stable')
  assert.match(failed,/not found/)
  assert.equal((await projection(recipient,target)).messages.length,0,'no text-only or half-file message')
  const db = new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  const row = db.prepare('SELECT * FROM deliveries WHERE text = ?').get(args.text)
  assert.equal(row.status,2)
  assert.ok(JSON.parse(row.attachments_json)[0].prepared)
  assert.equal(JSON.parse(row.attachments_json)[1].prepared,null)
  await stopBackend(); await startBackend()
  assert.equal((await projection(recipient,target)).messages.length,0,'startup never settles preparing rows as plain text')
  await tool(alice,'write',{file_path:first,content:'FIRST CHANGED'},senderSession)
  await tool(alice,'write',{file_path:second,content:'SECOND ORIGINAL'},senderSession)
  assert.match(await tool(alice,'deliver_message',{...args,files:[{path:second},{path:first}]},senderSession,'preparation-stable'),/different content or recipient/)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'preparation-stable'),/deliveryId/)
  const message = (await projection(recipient,target)).messages[0]
  assert.equal((await download(recipient,target,message.messageId,0)).bytes.toString(),'FIRST IMMUTABLE')
  assert.equal((await download(recipient,target,message.messageId,1)).bytes.toString(),'SECOND ORIGINAL')
  await tool(alice,'bash',{description:'Delete sources after complete preparation',command:`rm '${first}' '${second}'`},senderSession)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'preparation-stable'),/deliveryId/)
  assert.equal((await projection(recipient,target)).messages.length,1)
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE delivery_id = ?').get(row.delivery_id).status,1)
  db.close()
})

test('source scope and recipient exact-file references stay separate from private spaces and unrelated users', async () => {
  const target = await primary(bob)
  const foreign = join(home,'dsh-home','spaces','private',String(bob.user.shortId),'bob-only.txt')
  await tool(bob,'write',{file_path:foreign,content:'BOB PRIVATE WHOLE SPACE'},target)
  const before = (await projection(bob,target)).messages.length
  const args = {recipientShortId:bob.user.shortId,text:'Forbidden source',files:[{path:foreign}]}
  assert.match(await tool(alice,'deliver_message',args,senderSession,'foreign-file-call'),/outside|denied|permission/i)
  assert.equal((await projection(bob,target)).messages.length,before)
  const delivered = (await projection(bob,target)).messages.find(m=>m.text==='Explicit selected file')
  const event = (await projection(bob,target)).events.find(e=>e.type==='delivery/message' && e.data.message.id===delivered.messageId)
  const ref = event.data.message.source.attachments[0].original
  const digest = ref.attachmentId.slice('sha256:'.length)
  const handle = join(home,'dsh-home','attachments','v1','files',digest.slice(0,2),digest,ref.name)
  assert.match(await tool(bob,'read',{file_path:handle},target),/T12 original 私有文件/)
  const privateSibling = join(home,'dsh-home','spaces','private',String(alice.user.shortId),'unselected.txt')
  await tool(alice,'write',{file_path:privateSibling,content:'UNSELECTED SOURCE SECRET'},senderSession)
  assert.match(await tool(bob,'read',{file_path:privateSibling},target),/outside|denied|permission/i)
  assert.match(await tool(admin,'read',{file_path:handle}),/outside|denied|permission/i)
  const otherId = (await request('/sessions/create',bob.token)).session.id
  assert.equal((await download(bob,otherId,delivered.messageId,0)).status,404)
  assert.equal((await download(alice,senderSession,delivered.messageId,0)).status,404)
  const lastRecipientRequest = modelRequests.findLast(body=>JSON.stringify(body).includes('T12 original') && JSON.stringify(body).includes('read-only copy'))
  assert.ok(lastRecipientRequest)
  assert.equal(lastRecipientRequest.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content).some(c=>c.type==='image'),false)
})
