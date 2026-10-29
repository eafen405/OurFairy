/**
 * @covers backend/delivery — this suite drives the row through the product's
 * chat and HTTP routes rather than importing it.
 * @covers backend/attachments — the delivered file is qualified through the
 * product's upload routes before the recipient can read it.
 * @covers backend/groups — one case delivers into a group root that the group
 * tools create and join.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { before, after, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks, writeOverlay } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-file-delivery-')
const password = 'group-test-password'
let port, model, modelPort, admin, alice, bob
let senderSession
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
async function startBackend(overlays = []) {
  // This suite drives many tool turns through one source session; keep them
  // below the maintenance threshold so it tests delivery, not maintenance.
  const run = await runBackendAsync(startArgs(overlays), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-group-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}`,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50' })
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
    if (req.url.endsWith('/files')) {
      res.writeHead(404,{'content-type':'application/json'}); res.end(JSON.stringify({error:{type:'not_found_error',message:'model double uses inline image fallback'}})); return
    }
    const body = JSON.parse(data); modelRequests.push(body)
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const commandIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = blocks.slice(commandIndex + 1).findLast(c => c.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'group-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
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
  await stopBackend(); await new Promise(resolve => model.close(resolve)); removeHome(home)
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

async function upload(who,id,bytes,name,mime) {
  const {createHash} = await import('node:crypto')
  const {upload} = await request('/attachments/propose',who.token,{sessionId:id,name,mime,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
  const chunk = await fetch(`http://127.0.0.1:${port}/attachments/chunk`,{method:'POST',headers:{authorization:`Bearer ${who.token}`,'content-type':'application/octet-stream','x-upload-id':upload.uploadId,'x-upload-offset':'0'},body:bytes})
  assert.equal(chunk.status,200)
  return (await request('/attachments/complete',who.token,{uploadId:upload.uploadId})).upload
}
async function eventually(work,check) {
  for(let i=0;i<300;i++){const result=await work();if(check(result))return result;await delay(25)}
  assert.fail('expected file delivery state did not arrive')
}
test('admitted original and image selections can be forwarded without assistant images or sender history rights', async () => {
  const text = Buffer.from('ADMITTED ORIGINAL TEXT'), image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC','base64')
  const items = await Promise.all([upload(alice,senderSession,text,'inbound.txt','text/plain'),upload(alice,senderSession,image,'source.png','image/png')])
  const sent = await request('/chat/send',alice.token,{sessionId:senderSession,requestId:'inbound-original-input',text:JSON.stringify({name:'groups',args:{},callId:'inbound-original-call'}),uploadIds:items.map(item=>item.uploadId)})
  await eventually(()=>projection(alice,senderSession),value=>value.replyStatus===0)
  const args = {recipientShortId:bob.user.shortId,text:'Two selected admitted originals',files:[{messageId:sent.receipt.messageId,index:0},{messageId:sent.receipt.messageId,index:1}]}
  assert.match(await tool(alice,'deliver_message',args,senderSession,'admitted-file-delivery'),/deliveryId/)
  const target=await primary(bob), after=await projection(bob,target), message=after.messages.find(m=>m.text===args.text)
  assert.deepEqual(message.attachments.map(a=>[a.type,a.name,a.bytes]),[[1,'inbound.txt',text.length],[2,'source.png',image.length]])
  assert.deepEqual((await download(bob,target,message.messageId,0)).bytes,text)
  assert.deepEqual((await download(bob,target,message.messageId,1)).bytes,image)
  assert.match(await tool(bob,'deliver_message',{...args,recipientShortId:admin.user.shortId},target,'foreign-message-selector'),/unavailable/)
  const input=after.events.find(e=>e.type==='delivery/message' && e.data.message.id===message.messageId).data.message.source.attachments[1]
  const digest=input.original.attachmentId.slice(7), path=join(home,'dsh-home','attachments','v1','files',digest.slice(0,2),digest,input.original.name)
  assert.match(await tool(bob,'read_image',{file_path:path},target),/image/)
  const captured=modelRequests.findLast(body=>body.messages.some(m=>Array.isArray(m.content) && m.content.some(c=>c.type==='tool_result' && Array.isArray(c.content) && c.content.some(p=>p.type==='image'))))
  assert.ok(captured,'qualified read_image must use official user tool_result image serialization')
  const deliveredInput=captured.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content)
  assert.ok(deliveredInput.every(c=>c.type!=='image'),'delivered assistant has only legal text/file handle projection')
  assert.match(JSON.stringify(deliveredInput),/verbatim read-only copy/)
  assert.ok(!JSON.stringify(deliveredInput).includes('UNSELECTED SOURCE SECRET'))
})

test('a CAS-prepared item whose checklist write fails is retried under the same delivery identity', async () => {
  const recipient=await user('file-checklist-fault'),target=await primary(recipient)
  const path=join(home,'dsh-home','spaces','private',String(alice.user.shortId),'checklist.txt')
  await tool(alice,'write',{file_path:path,content:'NOT YET CHECKLIST COMMITTED'},senderSession)
  const db=new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  db.exec(`CREATE TRIGGER fail_file_checklist BEFORE UPDATE ON deliveries WHEN NEW.recipient_short_id=${recipient.user.shortId} AND OLD.status=2
    BEGIN SELECT RAISE(ABORT,'injected checklist persistence failure'); END`)
  const args={recipientShortId:recipient.user.shortId,text:'Checklist retry',files:[{path}]}
  assert.match(await tool(alice,'deliver_message',args,senderSession,'checklist-stable'),/injected checklist persistence failure/)
  const row=db.prepare('SELECT * FROM deliveries WHERE text=?').get(args.text)
  assert.equal(row.status,2)
  assert.equal(JSON.parse(row.attachments_json)[0].prepared,null)
  assert.equal((await projection(recipient,target)).messages.length,0)
  db.exec('DROP TRIGGER fail_file_checklist')
  await tool(alice,'write',{file_path:path,content:'CHECKLIST RETRY ORIGINAL'},senderSession)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'checklist-stable'),/deliveryId/)
  const after=await projection(recipient,target)
  assert.equal(after.messages.length,1)
  assert.equal((await download(recipient,target,after.messages[0].messageId,0)).bytes.toString(),'CHECKLIST RETRY ORIGINAL')
  db.close()
})

test('file delivery recovers durable log success before business completion without recopying changed sources', async () => {
  const recipient=await user('file-finalize-fault'),target=await primary(recipient)
  const path=join(home,'dsh-home','spaces','private',String(alice.user.shortId),'saved-before-business.txt')
  await tool(alice,'write',{file_path:path,content:'READY SNAPSHOT'},senderSession)
  const db=new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  db.exec(`CREATE TRIGGER fail_file_completion BEFORE UPDATE ON deliveries WHEN NEW.recipient_short_id=${recipient.user.shortId} AND NEW.status=1
    BEGIN SELECT RAISE(ABORT,'injected file completion failure'); END`)
  const args={recipientShortId:recipient.user.shortId,text:'Durable file before business completion',files:[{path}]}
  assert.match(await tool(alice,'deliver_message',args,senderSession,'file-completion-stable'),/injected file completion failure/)
  const row=db.prepare('SELECT * FROM deliveries WHERE text=?').get(args.text)
  assert.equal(row.status,0)
  const original=await projection(recipient,target)
  assert.equal(original.messages.length,1)
  assert.equal((await download(recipient,target,original.messages[0].messageId,0)).bytes.toString(),'READY SNAPSHOT')
  await stopBackend();await startBackend()
  db.exec('DROP TRIGGER fail_file_completion')
  await tool(alice,'write',{file_path:path,content:'CHANGED AFTER READY'},senderSession)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'file-completion-stable'),/deliveryId/)
  const after=await projection(recipient,target)
  assert.equal(after.messages.length,1)
  assert.equal(after.messages[0].messageId,original.messages[0].messageId)
  assert.equal((await download(recipient,target,after.messages[0].messageId,0)).bytes.toString(),'READY SNAPSHOT')
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE delivery_id=?').get(row.delivery_id).status,1)
  db.close()
})

test('a file delivery flush failure leaves a ready retry and never confirms incomplete durability', async () => {
  const target=await primary(bob),path=join(home,'dsh-home','spaces','private',String(alice.user.shortId),'flush-file.txt')
  await tool(alice,'write',{file_path:path,content:'FLUSH RETRY ORIGINAL'},senderSession)
  await stopBackend()
  const fixture=new URL('../backend/chat/test-support/fail-outlets.ts',import.meta.url).pathname
  const layer=writeOverlay(home,[{insert:[{id:'delivery-faults',name:fixture,config:{sessionId:target,failFlush:true}}]}],'file-flush-failure.patch.yml')
  await startBackend([layer]);await projection(bob,target)
  const args={recipientShortId:bob.user.shortId,text:'File checkpoint retry',files:[{path}]}
  const failed=await tool(alice,'deliver_message',args,senderSession,'file-flush-stable')
  assert.doesNotMatch(failed,/deliveryId/)
  const db=new DatabaseSync(join(home,'dsh-home','identity','identity.sqlite'))
  assert.equal(db.prepare('SELECT status FROM deliveries WHERE text=?').get(args.text).status,0)
  assert.match(await tool(alice,'deliver_message',args,senderSession,'file-flush-stable'),/deliveryId/)
  const after=await projection(bob,target),message=after.messages.find(m=>m.text===args.text)
  assert.equal(after.messages.filter(m=>m.text===args.text).length,1)
  assert.equal((await download(bob,target,message.messageId,0)).bytes.toString(),'FLUSH RETRY ORIGINAL')
  db.close()
})

async function observe(who,id) {
  const controller=new AbortController(),frames=[]
  const response=await fetch(`http://127.0.0.1:${port}/chat/observe`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',authorization:`Bearer ${who.token}`},body:JSON.stringify({sessionId:id})})
  assert.equal(response.status,200)
  const reader=response.body.getReader(),decoder=new TextDecoder()
  const done=(async()=>{
    let buffer=''
    while(true){
      const {done,value}=await reader.read();if(done)return
      buffer+=decoder.decode(value,{stream:true})
      let end
      while((end=buffer.indexOf('\n\n'))>=0){
        const event=buffer.slice(0,end);buffer=buffer.slice(end+2)
        const line=event.split('\n').find(line=>line.startsWith('data: '))
        if(line)frames.push(JSON.parse(line.slice(6)))
      }
    }
  })().catch(error=>{if(!controller.signal.aborted)throw error})
  return {frames,async close(){controller.abort();await done}}
}
test('authorized shared files appear together in live and persisted recipient attachment projection',async()=>{
  const groupOwner=await user('file-group-owner'),target=await primary(bob)
  const result=await tool(admin,'group_create',{name:'Delivery file scope',ownerShortId:groupOwner.user.shortId})
  const groupId=Number(result.match(/\\?"id\\?":(\d+)/)?.[1])
  assert.ok(groupId)
  const ownerSession=await primary(groupOwner)
  await tool(groupOwner,'group_members',{groupId,userShortId:alice.user.shortId,action:1},ownerSession)
  const groupPath=join(home,'dsh-home','spaces','groups',String(groupId),'group-selected.txt')
  const publicPath=join(home,'dsh-home','spaces','public','public-selected.txt')
  await tool(alice,'write',{file_path:groupPath,content:'GROUP SELECTED'},senderSession)
  await tool(alice,'write',{file_path:publicPath,content:'PUBLIC SELECTED'},senderSession)
  const follow=await observe(bob,target)
  try{
    const args={recipientShortId:bob.user.shortId,text:'Two shared originals',files:[{path:groupPath},{path:publicPath}]}
    assert.match(await tool(alice,'deliver_message',args,senderSession,'shared-files-stable'),/deliveryId/)
    const frame=await eventually(async()=>follow.frames.at(-1),p=>p?.messages.some(m=>m.text===args.text))
    const live=frame.messages.find(m=>m.text===args.text)
    assert.deepEqual(live.attachments.map(a=>a.name),['group-selected.txt','public-selected.txt'])
    const saved=(await projection(bob,target)).messages.find(m=>m.messageId===live.messageId)
    assert.deepEqual(saved.attachments,live.attachments)
    assert.equal((await download(bob,target,saved.messageId,0)).bytes.toString(),'GROUP SELECTED')
    assert.match(await tool(bob,'read',{file_path:groupPath},target),/outside|denied|permission/i)
  }finally{await follow.close()}
})
