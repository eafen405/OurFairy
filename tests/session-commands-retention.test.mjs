/** @covers backend/chat backend/memory backend/skill-creator — retention through the authenticated product composition. */
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describeRun, httpJson, makeHome, messageBlocks, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-command-retention-')
const password = 'command-retention-password'
const seedDir = join(home, 'seeds')
const summaryMarker = 'SUMMARY_DROP_345'
const rawMarker = 'RAW_DROP_345'
const toolMarker = 'TOOL_OUTPUT_DROP_345'
const skillBody = 'SKILL_BODY_DROP_345'
const resourceBody = 'REVIEWED_RESOURCE_KEEP_345'
const memory = 'MEMORY_KEEP_345 共同保存的灯塔约定'
const impression = 'IMPRESSION_KEEP_345 喜欢安静的清晨'
let port, model, admin, alice
let serial = 0
const requests = []
const memoryRequests = []
let holdMemory, heldMemory
const learningRequests = []
let failLearning = 0, holdLearning, heldLearning
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const blocks = body => (body.messages ?? []).flatMap(messageBlocks)
const text = message => messageBlocks(message).filter(b => b.type === 'text').map(b => b.text).join('')
function currentText(body) {
  return (body.messages ?? []).filter(m => m.role === 'user').map(text)
    .filter(t => t && !t.startsWith('Current runtime context.') && !t.startsWith('<system-reminder>')).at(-1) ?? ''
}
function emitReply(response, reply) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: `retention-${requests.length}`, type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  if (reply.tool) {
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: reply.tool.id, name: reply.tool.name, input: {} } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.tool.args) } })
  } else {
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } })
  }
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: reply.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}
const call = (path, token, body = {}) => httpJson(port, path, { token, body })
const create = async () => (await call('/sessions/create', alice.token)).session.id
const read = async sessionId => (await call('/chat/read', alice.token, { sessionId })).projection
async function until(work, check) {
  const deadline = Date.now() + 30000
  let value
  do {
    value = await work()
    if (check(value)) return value
    await delay(25)
  } while (Date.now() < deadline)
  assert.fail(`condition not reached: ${JSON.stringify(value)}`)
}
async function send(sessionId, content) {
  const seen = new Set((await read(sessionId)).messages.map(m => m.messageId))
  const requestId = `retention-${++serial}`
  await call('/chat/send', alice.token, { sessionId, requestId, text: content })
  const projection = await until(() => read(sessionId), p => p.replyStatus === 0
    && p.messages.some(m => m.role === 2 && m.status === 2 && !seen.has(m.messageId) && /^(REPLY|RESULT):/.test(m.text)))
  return projection.messages.findLast(m => m.role === 2 && !seen.has(m.messageId)).text
}
async function tool(sessionId, name, args = {}) {
  const reply = await send(sessionId, JSON.stringify({ name, args, callId: `retention-tool-${++serial}` }))
  assert.ok(reply.startsWith('RESULT:'), reply)
  return JSON.parse(reply.slice(7)).map(b => b.text ?? '').join('')
}
async function command(sessionId, requestId, command = 2) {
  await call('/chat/commands/execute', alice.token, { sessionId, requestId, command })
  return until(async () => (await call('/chat/commands/status', alice.token, { sessionId, requestId })).command, c => c?.status !== 1)
}
async function history(sessionId) {
  const cut = (await read(sessionId)).cursor
  const events = [], messages = new Map()
  let beforeSeq = cut + 1
  while (beforeSeq > 0) {
    const { page } = await call('/chat/page', alice.token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 128 })
    events.unshift(...page.events)
    for (const message of page.messages) messages.set(message.messageId, message)
    beforeSeq = page.beforeSeq ?? 0
  }
  return { events, messages: [...messages.values()].sort((a, b) => a.position - b.position) }
}
async function start(extra = {}) {
  port = startedPort(await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50', OURFAIRY_SKILL_LEARNING_TURNS: '50', OURFAIRY_SEED_SKILLS_DIR: seedDir, ...extra }))
}
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
function rows(area, sql, ...args) {
  const db = new DatabaseSync(join(home, 'dsh-home', area, `${area}.sqlite`), { readOnly: true })
  try { return db.prepare(sql).all(...args).map(row => ({ ...row })) } finally { db.close() }
}
before(async () => {
  const packageDir = join(seedDir, 'retained-workflow')
  mkdirSync(join(packageDir, 'references'), { recursive: true })
  writeFileSync(join(packageDir, 'SKILL.md'), `---\nname: retained-workflow\ndescription: RETAINED_CATALOG_345 灯塔工作流\n---\n\n${skillBody}\n`)
  writeFileSync(join(packageDir, 'references', 'guide.md'), resourceBody)
  model = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    requests.push(body)
    const names = (body.tools ?? []).map(t => t.name)
    if (names.includes('submit_signals')) {
      learningRequests.push(body)
      const material = JSON.stringify(body.messages)
      const relevant = material.includes('LEARNING_345_')
      if (relevant && failLearning > 0) {
        failLearning--
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'one refused detection turn' } }))
        return
      }
      if (relevant && holdLearning) {
        holdLearning = false
        await new Promise(resolve => { heldLearning = { body, release: resolve } })
      }
      if (response.destroyed) return
      const submitted = blocks(body).some(b => b.type === 'tool_use' && b.name === 'submit_signals')
      const signals = !relevant ? [] : [{ taskKey: material.includes('LEARNING_345_NEW') ? 'clear-retention:new-material'
        : material.includes('LEARNING_345_HELD') ? 'clear-retention:held-material' : 'clear-retention:failed-material', status: 0 }]
      return emitReply(response, submitted ? { text: 'DETECTION_DONE_345' }
        : { tool: { name: 'submit_signals', args: { signals }, id: `learning-submit-${++serial}` } })
    }
    if (names.length === 5 && ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch'].every(n => names.includes(n))) {
      memoryRequests.push(body)
      if (holdMemory) {
        holdMemory = false
        await new Promise(resolve => { heldMemory = { body, release: resolve } })
      }
      return emitReply(response, { text: 'MAINTENANCE_DONE_345' })
    }
    if (JSON.stringify(body.messages).includes('You are now acting as a compaction engine')) return emitReply(response, { text: summaryMarker })
    const current = currentText(body)
    const flat = blocks(body)
    const index = current.startsWith('{"name":') ? flat.findLastIndex(b => b.type === 'text' && b.text === current) : -1
    const result = index < 0 ? undefined : flat.slice(index + 1).findLast(b => b.type === 'tool_result')
    if (index >= 0 && !result) return emitReply(response, { tool: { ...JSON.parse(current), id: JSON.parse(current).callId } })
    emitReply(response, { text: result ? `RESULT:${JSON.stringify(toolResultBlocks(result))}` : `REPLY:${requests.length}` })
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  await start()
  admin = await call('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'retention-alice', password)
})
after(async () => {
  await stop()
  model?.closeAllConnections()
  await new Promise(resolve => model?.close(resolve))
  removeHome(home)
})

test('an idle source clears while its memory child remains held, then each raw interval is consumed once', async () => {
  await call('/gateway/maintenance', admin.token, { triggerTurns: 5, decayHours: 6 })
  const source = await create()
  const state = () => rows('memory', 'SELECT * FROM maintenance_state WHERE source_session = ?', source)[0]
  const count = memoryRequests.length
  holdMemory = true
  heldMemory = undefined
  try {
    for (let i = 0; i < 5; i++) await send(source, `MEMORY_OLD_INTERVAL_345_${i}`)
    await until(async () => heldMemory, Boolean)
    const frozen = state()
    assert.equal(frozen.status, 1)
    assert.ok(frozen.child_session)
    assert.equal(frozen.watermark_seq, -1)
    assert.equal((await read(source)).replyStatus, 0)
    assert.equal((await command(source, 'memory-held-clear')).status, 4)
    assert.equal(memoryRequests.length, count + 1, 'clear completes before the child is released')
    for (const key of ['child_session', 'cut_seq', 'watermark_seq', 'status']) assert.equal(state()[key], frozen[key], key)
    await send(source, 'MEMORY_NEW_INTERVAL_345_0')
    assert.ok(JSON.stringify(heldMemory.body.messages).includes('MEMORY_OLD_INTERVAL_345_0'))
    assert.ok(!JSON.stringify(heldMemory.body.messages).includes('MEMORY_NEW_INTERVAL_345_0'))
    heldMemory.release()
    const completed = await until(async () => state(), s => s?.status === 0 && s.watermark_seq === frozen.cut_seq)
    assert.equal(completed.child_session, frozen.child_session)
    const ends = (await history(source)).events.filter(e => e.type === 'turn/end')
    assert.equal(completed.watermark_seq, ends.at(-2).seq)
    assert.ok(ends.at(-1).seq > completed.watermark_seq)
    for (let i = 1; i < 5; i++) await send(source, `MEMORY_NEW_INTERVAL_345_${i}`)
    const next = await until(async () => memoryRequests.slice(count + 1).find(b => JSON.stringify(b.messages).includes('MEMORY_NEW_INTERVAL_345_0')), Boolean)
    assert.ok(!JSON.stringify(next.messages).includes('MEMORY_OLD_INTERVAL_345_'))
    const final = await until(async () => state(), s => s?.status === 0 && s.watermark_seq > frozen.cut_seq)
    assert.notEqual(final.child_session, frozen.child_session)
    assert.equal(final.watermark_seq, final.cut_seq)
    assert.equal(memoryRequests.length, count + 2)
  } finally {
    heldMemory?.release()
    holdMemory = false
    await call('/gateway/maintenance', admin.token, { triggerTurns: 50, decayHours: 6 })
  }
})

test('clear removes summary, raw text, tool results and activated body while retaining saved recognition and reviewed skills', async () => {
  const setup = await create()
  assert.equal(JSON.parse(await tool(setup, 'impression_read')).content, '')
  assert.deepEqual(JSON.parse(await tool(setup, 'impression_edit', { content: impression })), { ok: true })
  assert.deepEqual(JSON.parse(await tool(setup, 'memory_add', { content: memory })), { ok: true })
  const saved = JSON.parse(await tool(setup, 'memory_search', { query: 'MEMORY_KEEP_345' })).memories.find(m => m.content === memory)
  assert.ok(saved?.id)
  const skill = (await call('/skills/list', alice.token)).skills.find(s => s.name === 'retained-workflow')
  assert.ok(skill)
  await call('/skills/preference', alice.token, { skillId: skill.skillId, enabled: true })
  const poolBefore = (await call('/skills/list', alice.token)).skills
  const versionsBefore = rows('skill', 'SELECT * FROM skill_version WHERE skill_id = ?', skill.skillId)
  assert.equal(versionsBefore.length, 1)
  assert.equal(versionsBefore[0].status, 3, 'deployment seed passed the reviewed-package import')
  const resource = join(home, 'dsh-home', 'skill', versionsBefore[0].package_path, 'references', 'guide.md')
  const target = await create()
  const gatewayBefore = (await call('/gateway/read', admin.token)).gateway
  await send(target, `COMPACT_OLD_345 ${'x'.repeat(48000)}`)
  await send(target, `COMPACT_RECENT_345 ${'r'.repeat(48000)}`)
  assert.equal((await command(target, 'retention-compact', 1)).status, 2)
  await send(target, rawMarker)
  assert.match(await tool(target, 'bash', { command: `printf '${toolMarker}'`, description: 'emit a distinct historical tool result' }), new RegExp(toolMarker))
  assert.ok((await tool(target, 'skill', { name: 'retained-workflow' })).includes(skillBody))
  await send(target, 'BEFORE_CLEAR_PROBE_345')
  const before = requests.at(-1)
  for (const marker of [summaryMarker, rawMarker, toolMarker, skillBody]) assert.ok(JSON.stringify(before.messages).includes(marker), `precondition: actual request carries ${marker}`)
  const historicalResults = blocks(before).filter(b => b.type === 'tool_result').flatMap(toolResultBlocks).map(b => b.text ?? '').join('\n')
  assert.ok(historicalResults.includes(toolMarker), 'the old bash output is present as a real tool_result')
  assert.ok(historicalResults.includes(skillBody), 'the activated body is present as a real skill tool_result')
  const other = await create()
  await send(other, 'OTHER_SESSION_KEEP_345')
  const otherBefore = await history(other)
  const historyBefore = await history(target)
  assert.equal(historyBefore.messages.filter(m => m.kind === 1 && m.role === 3).length, 1)
  const cleared = await command(target, 'retention-clear')
  assert.equal(cleared.status, 4)
  assert.equal(cleared.sessionId, target)
  const gatewayAfter = (await call('/gateway/read', admin.token)).gateway
  assert.deepEqual(gatewayAfter.compaction, gatewayBefore.compaction)
  assert.equal(gatewayAfter.saved.compaction, gatewayBefore.saved.compaction)
  await send(target, 'FIRST_PLAIN_PROBE_345')
  const after = requests.at(-1)
  for (const marker of [summaryMarker, rawMarker, toolMarker, skillBody, 'COMPACT_OLD_345', 'COMPACT_RECENT_345']) {
    assert.ok(!JSON.stringify(after.messages).includes(marker), `first plain request excludes ${marker}`)
  }
  const system = typeof after.system === 'string' ? after.system : after.system.map(b => b.text).join('\n')
  assert.match(system, /Ⅲ型总序式集成泛用人工智能/)
  assert.ok(system.includes(impression))
  assert.ok(system.includes(`当前已认证用户短号：${alice.user.shortId}`))
  assert.ok(system.includes('retention-alice'))
  for (const name of ['bash', 'read', 'skill', 'memory_search', 'impression_read']) assert.ok(after.tools.some(t => t.name === name), `${name} remains available`)
  const catalog = blocks(after).filter(b => b.type === 'text' && b.text.includes('<available_skills>')).at(-1)?.text
  assert.ok(catalog?.includes('retained-workflow'))
  assert.deepEqual((await call('/skills/list', alice.token)).skills, poolBefore)
  assert.deepEqual(rows('skill', 'SELECT * FROM skill_version WHERE skill_id = ?', skill.skillId), versionsBefore)
  const retrieved = JSON.parse(await tool(target, 'memory_search', { query: 'MEMORY_KEEP_345' })).memories.find(m => m.content === memory)
  assert.equal(retrieved?.id, saved.id, 'the same saved memory is retrieved through the normal tool')
  assert.ok((await tool(target, 'skill', { name: 'retained-workflow' })).includes(skillBody))
  assert.ok((await tool(target, 'read', { file_path: resource })).includes(resourceBody))
  assert.equal(readFileSync(resource, 'utf8'), resourceBody)
  const retained = await history(target)
  for (const old of historyBefore.messages) assert.deepEqual(retained.messages.find(m => m.messageId === old.messageId), old)
  assert.equal(retained.messages.filter(m => m.kind === 1 && m.role === 3).length, 2, 'only explicit reload adds a second activation')
  assert.deepEqual(await history(other), otherBefore)
  await send(other, 'OTHER_SESSION_PROBE_345')
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('OTHER_SESSION_KEEP_345'))
  await stop()
  await start()
  assert.deepEqual((await call('/skills/list', alice.token)).skills, poolBefore)
  assert.deepEqual(rows('skill', 'SELECT * FROM skill_version WHERE skill_id = ?', skill.skillId), versionsBefore)
  assert.equal((await call('/impression/read', alice.token)).impression.content, impression)
  assert.equal(JSON.parse(await tool(target, 'memory_search', { query: 'MEMORY_KEEP_345' })).memories.find(m => m.content === memory)?.id, saved.id)
  assert.ok((await tool(target, 'skill', { name: 'retained-workflow' })).includes(skillBody))
  assert.ok((await tool(target, 'read', { file_path: resource })).includes(resourceBody))
})

test('a held learning child permits clear immediately and resumes its original evidence after restart', async () => {
  await stop()
  await start({ OURFAIRY_SKILL_LEARNING_TURNS: '1' })
  const source = await create()
  const state = () => rows('skill', 'SELECT * FROM skill_learning_state WHERE source_session = ?', source)[0]
  const signals = () => rows('skill', 'SELECT * FROM skill_reuse_signal WHERE source_session = ?', source)
  holdLearning = true
  heldLearning = undefined
  try {
    await tool(source, 'bash', { command: 'printf LEARNING_345_HELD_TOOL', description: 'execute held learning evidence' })
    await until(async () => heldLearning, Boolean)
    const frozen = state()
    assert.equal(frozen.status, 1)
    assert.ok(frozen.child_session)
    const held = heldLearning
    assert.equal((await command(source, 'learning-held-clear')).status, 4)
    assert.equal(heldLearning, held, 'clear finishes before the model gate is released')
    for (const key of ['child_session', 'cut_seq', 'watermark_seq', 'status']) assert.equal(state()[key], frozen[key], key)
    assert.equal(signals().length, 0)
    await stop()
    held.release()
    heldLearning = undefined
    holdLearning = true
    await start({ OURFAIRY_SKILL_LEARNING_TURNS: '1' })
    await until(async () => heldLearning, Boolean)
    for (const key of ['child_session', 'cut_seq', 'watermark_seq']) assert.equal(state()[key], frozen[key], key)
    assert.ok(JSON.stringify(heldLearning.body.messages).includes('LEARNING_345_HELD_TOOL'))
    assert.match(JSON.stringify(heldLearning.body.messages), /上一轮检测没有完成/u)
    heldLearning.release()
    const completed = await until(async () => state(), s => s?.status === 0 && s.watermark_seq === frozen.cut_seq)
    assert.equal(completed.child_session, frozen.child_session)
    assert.equal(signals().length, 1)
    assert.equal(signals()[0].evidence_end_seq, frozen.cut_seq)
    assert.equal((await command(source, 'learning-held-clear')).status, 4)
    assert.equal(signals().length, 1)
  } finally {
    heldLearning?.release()
    holdLearning = false
    await stop()
    await start()
  }
})

test('failed learning resumes the same frozen child after clear and restart without skipping or duplicating signals', async () => {
  await stop()
  await start({ OURFAIRY_SKILL_LEARNING_TURNS: '1' })
  const source = await create()
  const state = () => rows('skill', 'SELECT * FROM skill_learning_state WHERE source_session = ?', source)[0]
  const signals = () => rows('skill', 'SELECT * FROM skill_reuse_signal WHERE source_session = ? ORDER BY id', source)
  failLearning = 1
  heldLearning = undefined
  try {
    assert.ok((await tool(source, 'bash', { command: 'printf LEARNING_345_OLD_TOOL', description: 'execute real learning evidence' })).includes('LEARNING_345_OLD_TOOL'))
    const failed = await until(async () => state(), s => s?.status === 2)
    assert.ok(failed.child_session)
    assert.equal(failed.watermark_seq, -1)
    holdLearning = true
    assert.equal((await command(source, 'learning-failed-clear')).status, 4)
    for (const key of ['child_session', 'cut_seq', 'watermark_seq']) assert.equal(state()[key], failed[key], key)
    assert.deepEqual(signals(), [])
    await stop()
    heldLearning?.release()
    heldLearning = undefined
    holdLearning = true
    const resumedAt = learningRequests.length
    await start({ OURFAIRY_SKILL_LEARNING_TURNS: '1' })
    await until(async () => heldLearning, Boolean)
    const resumed = state()
    assert.equal(resumed.child_session, failed.child_session)
    assert.equal(resumed.cut_seq, failed.cut_seq)
    assert.equal(resumed.watermark_seq, failed.watermark_seq)
    const wire = JSON.stringify(heldLearning.body.messages)
    assert.ok(wire.includes('LEARNING_345_OLD_TOOL'))
    assert.match(wire, /上一轮检测没有完成/u)
    heldLearning.release()
    const done = await until(async () => state(), s => s?.status === 0 && s.watermark_seq === failed.cut_seq)
    assert.equal(done.child_session, failed.child_session)
    assert.equal(signals().length, 1)
    const oldSignal = signals()[0]
    assert.equal(oldSignal.evidence_start_seq, -1)
    assert.equal(oldSignal.evidence_end_seq, failed.cut_seq)
    assert.ok(learningRequests.length > resumedAt)
    await tool(source, 'bash', { command: 'printf LEARNING_345_NEW_TOOL', description: 'execute new interval evidence' })
    const next = await until(async () => learningRequests.slice(resumedAt).find(b => JSON.stringify(b.messages).includes('LEARNING_345_NEW_TOOL')), Boolean)
    assert.ok(!JSON.stringify(next.messages).includes('LEARNING_345_OLD_TOOL'))
    const completed = await until(async () => state(), s => s?.status === 0 && s.watermark_seq > failed.cut_seq)
    assert.equal(completed.watermark_seq, completed.cut_seq)
    assert.notEqual(completed.child_session, failed.child_session)
    assert.equal(signals().length, 2)
    assert.deepEqual(signals()[0], oldSignal)
    assert.equal(signals()[1].evidence_start_seq, failed.cut_seq)
    assert.equal(signals()[1].evidence_end_seq, completed.cut_seq)
  } finally {
    heldLearning?.release()
    holdLearning = false
    failLearning = 0
    await stop()
    await start()
  }
})
