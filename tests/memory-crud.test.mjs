/**
 * Long-term memory rows through an authenticated product session (ticket #244).
 *
 * The backend boots the real v1 profile and Loader against an external model
 * double, then drives the `memory_*` tools through `/chat/send` exactly as a
 * model would. Assertions read what the model receives (the tool result blocks)
 * and, where the contract is about storage rather than interface, the memory
 * SQLite file itself — never a hand-mounted plugin or a private class.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import {
  describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks,
} from './helpers/backend.mjs'

const home = makeHome('ourfairy-memory-')
const password = 'memory-test-password'
/** The row's configured database, under the isolated deployment home. */
const databasePath = join(home, 'dsh-home', 'memory', 'memory.sqlite')
let port, model, modelPort, admin, alice, bob
let requestNo = 0

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

function user(name) { return registerUser(port, admin.token, name, password) }

/** One fresh ordinary session of one identity. */
async function newSession(identity) {
  return (await request('/sessions/create', identity.token)).session.id
}

/**
 * Drive one tool call through chat and return its result blocks as the model
 * sees them: the JSON text of the blocks array.
 */
async function tool(identity, sessionId, name, args, callId = `memory-call-${requestNo + 1}`) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(m => m.messageId))
  await request('/chat/send', identity.token, {
    sessionId, requestId: `memory-request-${++requestNo}`, text: JSON.stringify({ name, args, callId }),
  })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const terminal = projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:'))
    const fresh = terminal.find(m => !seen.has(m.messageId))
    if (fresh) return fresh.text.slice(7)
    if (projection.error) assert.fail(`chat failed before the ${name} result: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`the ${name} result never returned to session ${sessionId}`)
}

/** The value one successful tool call returned, decoded from its result blocks. */
function valueOf(raw, label) {
  const text = blocksText(raw)
  assert.equal(text.startsWith('Error:'), false, `${label ?? 'tool'} must succeed; got ${text}`)
  return JSON.parse(text)
}

/** The failure text of one failed tool call. */
function errorOf(raw) {
  return blocksText(raw)
}

function blocksText(raw) {
  const blocks = JSON.parse(raw)
  return blocks.map(block => block.text ?? '').join('')
}

/** The stored rows, read straight from the row's own database file. */
function storedRows() {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare('SELECT id, content, is_private, source_session, content_updated_at FROM memories ORDER BY id').all()
  } finally {
    database.close()
  }
}

before(async () => {
  model = http.createServer(async (request, response) => {
    // Collect the bytes first: decoding each network chunk on its own splits a
    // multi-byte character that straddles two chunks into replacement marks.
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const blocks = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }])
    const commandIndex = blocks.findLastIndex(block => block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'memory-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
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
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  modelPort = model.address().port
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-memory-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('memory-alice')
  bob = await user('memory-bob')
})

after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('a new memory is normal by default and only a normal search returns it', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '雨天散步让人放松' }), 'memory_add')
  assert.deepEqual(Object.keys(added).sort(), ['id', 'ok'], 'add answers a simple confirmation')
  assert.equal(added.ok, true)
  assert.ok(Number.isSafeInteger(added.id) && added.id > 0, `a memory needs an integer number; got ${JSON.stringify(added)}`)

  const normal = valueOf(await tool(alice, session, 'memory_search', { query: '雨天散步' }), 'memory_search')
  assert.deepEqual(normal.memories.map(memory => memory.id), [added.id])
  const [memory] = normal.memories
  assert.equal(memory.content, '雨天散步让人放松')
  assert.equal(memory.owner_short_id, alice.user.shortId, 'the owner is derived from the source session')
  assert.equal(typeof memory.content_updated_at, 'number')
  assert.deepEqual([normal.limit, normal.character_budget], [20, 8000])
  assert.equal(normal.returned, 1)
  assert.equal(normal.matched, 1)
  assert.equal(normal.truncated, false)

  const deep = valueOf(await tool(alice, session, 'memory_search', { query: '雨天散步', is_private: true }), 'private memory_search')
  assert.deepEqual(deep.memories, [], 'normal search and deep search never share a layer')
})

test('is_private writes the private layer and memory_switch flips both ways', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '清晨写作效率最高', is_private: true }), 'private memory_add')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作' }), 'normal memory_search').memories, [])
  const deep = valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作', is_private: true }), 'deep memory_search')
  assert.deepEqual(deep.memories.map(memory => memory.id), [added.id])
  const updatedAt = deep.memories[0].content_updated_at

  const toNormal = valueOf(await tool(alice, session, 'memory_switch', { id: added.id }), 'memory_switch')
  assert.deepEqual(toNormal, { ok: true, id: added.id, is_private: false })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作', is_private: true }), 'deep memory_search').memories, [])
  const normal = valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作' }), 'normal memory_search')
  assert.deepEqual(normal.memories.map(memory => memory.id), [added.id])
  assert.equal(normal.memories[0].content_updated_at, updatedAt, 'a switch never updates the content time')

  const toPrivate = valueOf(await tool(alice, session, 'memory_switch', { id: added.id }), 'memory_switch')
  assert.deepEqual(toPrivate, { ok: true, id: added.id, is_private: true })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作' }), 'normal memory_search').memories, [])
})

test('memory_edit replaces one uniquely matched fragment and refuses zero or several matches', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '我喜欢喝乌龙茶，也喜欢喝红茶。' }), 'memory_add')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '乌龙茶' }), 'memory_search').memories.map(memory => memory.id), [added.id])

  assert.deepEqual(valueOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '乌龙茶', new_string: '普洱茶' }), 'memory_edit'), { ok: true, id: added.id })
  const edited = valueOf(await tool(alice, session, 'memory_search', { query: '普洱茶' }), 'memory_search')
  assert.deepEqual(edited.memories.map(memory => memory.content), ['我喜欢喝普洱茶，也喜欢喝红茶。'])

  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '绿茶', new_string: '白茶' })), /memory\/no-match/,
    'an old fragment that does not occur is an error')

  const repeated = valueOf(await tool(alice, session, 'memory_add', { content: '重复的记号在这里，重复的记号也在那里' }), 'memory_add')
  valueOf(await tool(alice, session, 'memory_search', { query: '重复的记号' }), 'memory_search')
  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: repeated.id, old_string: '重复的记号', new_string: '唯一记号' })), /memory\/ambiguous-match/,
    'an old fragment that occurs twice is refused rather than guessed')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '重复的记号' }), 'memory_search').memories.map(memory => memory.content),
    ['重复的记号在这里，重复的记号也在那里'], 'a refused edit changes nothing')

  const whole = valueOf(await tool(alice, session, 'memory_search', { query: '普洱茶' }), 'memory_search').memories[0]
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: whole.content, new_string: '整段替换后的记忆正文' }), 'memory_edit'), { ok: true, id: added.id })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '整段替换' }), 'memory_search').memories.map(memory => memory.content), ['整段替换后的记忆正文'],
    'passing the complete old content is how a whole-memory rewrite is expressed')
})

test('memory_delete removes the row physically and never reuses its number', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '这条记忆稍后会被删除' }), 'memory_add')
  valueOf(await tool(alice, session, 'memory_search', { query: '稍后会被删除' }), 'memory_search')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_delete', { id: added.id }), 'memory_delete'), { ok: true })
  assert.deepEqual(storedRows().filter(row => row.id === added.id), [], 'a deleted memory leaves no row behind')
  const empty = valueOf(await tool(alice, session, 'memory_search', { query: '稍后会被删除' }), 'memory_search')
  assert.deepEqual(empty.memories, [])
  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '删除', new_string: '保留' })), /memory\/unknown-memory/,
    'a deleted number no longer names a memory')
  const next = valueOf(await tool(alice, session, 'memory_add', { content: '删除之后新增的记忆' }), 'memory_add')
  assert.ok(next.id > added.id, `a number is never reused; got ${next.id} after deleting ${added.id}`)
})

test('edit, delete and switch need the number to have been returned in the calling session', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '门禁测试的记忆：一只橘猫' }), 'memory_add')
  // `/sessions/create` re-enters the newest empty session, so the second
  // session of this identity only becomes distinct once this one has content.
  const secondSession = await newSession(alice)
  const bobSession = await newSession(bob)
  assert.notEqual(secondSession, session, 'the gate has to prove a second session')

  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '橘猫', new_string: '黑猫' })), /memory\/not-queried/,
    'adding does not authorize changing the new memory')
  assert.match(errorOf(await tool(alice, session, 'memory_delete', { id: added.id })), /memory\/not-queried/)
  assert.match(errorOf(await tool(alice, session, 'memory_switch', { id: added.id })), /memory\/not-queried/)

  assert.deepEqual(valueOf(await tool(alice, secondSession, 'memory_search', { query: '橘猫' }), 'memory_search').memories.map(memory => memory.id), [added.id])
  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '橘猫', new_string: '黑猫' })), /memory\/not-queried/,
    'a query in another session never authorizes this one')

  // Bob's session has seen nothing yet: a different identity's fresh session is
  // no more authorized than a second session of the same identity.
  assert.match(errorOf(await tool(bob, bobSession, 'memory_delete', { id: added.id })), /memory\/not-queried/,
    'another identity\'s session authorizes nothing until it searches itself')
  const bobView = valueOf(await tool(bob, bobSession, 'memory_search', { query: '橘猫' }), 'memory_search')
  assert.equal(bobView.memories[0].owner_short_id, alice.user.shortId, 'the owner is the source session owner, not the searcher')
  assert.match(errorOf(await tool(alice, session, 'memory_delete', { id: added.id })), /memory\/not-queried/,
    'the second session\'s query never authorizes this one')
  assert.match(errorOf(await tool(alice, session, 'memory_switch', { id: added.id })), /memory\/not-queried/)

  valueOf(await tool(alice, session, 'memory_search', { query: '橘猫' }), 'memory_search')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '橘猫', new_string: '狸花猫' }), 'memory_edit'), { ok: true, id: added.id })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_delete', { id: added.id }), 'memory_delete'), { ok: true })
})

test('search dates are one closed interval over the content time, and omitted dates search everything', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '关于日期的记忆：第一次去海边' }), 'memory_add')
  const found = valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边' }), 'memory_search')
  const updatedAt = found.memories[0].content_updated_at
  const idsOf = value => value.memories.map(memory => memory.id)

  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边' }), 'memory_search')), [added.id],
    'omitting both bounds searches every date')
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt, end_at: updatedAt }), 'memory_search')), [added.id],
    'both bounds are inclusive, so one instant can select the memory it equals')
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt, end_at: updatedAt + 60000 }), 'memory_search')), [added.id])
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt - 60000, end_at: updatedAt }), 'memory_search')), [added.id])
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt + 1, end_at: updatedAt + 60000 }), 'memory_search')), [])
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt - 60000, end_at: updatedAt - 1 }), 'memory_search')), [])

  assert.match(errorOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt })), /memory\/invalid-range/,
    'a start without an end is refused')
  assert.match(errorOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', end_at: updatedAt })), /memory\/invalid-range/,
    'an end without a start is refused')
  assert.match(errorOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt, end_at: updatedAt - 1 })), /memory\/invalid-range/,
    'a start later than its end is refused')
  assert.match(errorOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: -1, end_at: updatedAt })), /memory\/invalid-range/,
    'a negative instant is not a millisecond timestamp')
})

test('the content time moves only on add and content edit, never on search or switch', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '内容时间测试的记忆：海边日落' }), 'memory_add')
  const first = valueOf(await tool(alice, session, 'memory_search', { query: '海边日落' }), 'memory_search').memories[0]
  const addedAt = first.content_updated_at

  await delay(5)
  assert.equal(valueOf(await tool(alice, session, 'memory_search', { query: '海边日落' }), 'memory_search').memories[0].content_updated_at, addedAt,
    'a search never updates the content time')
  valueOf(await tool(alice, session, 'memory_switch', { id: added.id }), 'memory_switch')
  const switched = valueOf(await tool(alice, session, 'memory_search', { query: '海边日落', is_private: true }), 'memory_search')
  assert.equal(switched.memories[0].content_updated_at, addedAt, 'a switch never updates the content time')

  await delay(5)
  valueOf(await tool(alice, session, 'memory_edit', { id: added.id, old_string: '海边日落', new_string: '海边日出', is_private: true }), 'memory_edit')
  const edited = valueOf(await tool(alice, session, 'memory_search', { query: '海边日出', is_private: true }), 'memory_search').memories[0]
  assert.ok(edited.content_updated_at > addedAt, `an edit moves the content time; ${edited.content_updated_at} <= ${addedAt}`)
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '海边日出', is_private: true, start_at: edited.content_updated_at, end_at: edited.content_updated_at }), 'memory_search').memories.map(memory => memory.id),
    [added.id], 'the date filter follows the edited content time')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '海边日出', is_private: true, start_at: addedAt, end_at: addedAt }), 'memory_search').memories, [],
    'the old content time no longer selects it')
})

test('a search returns at most 20 memories and never exposes an omitted number', async () => {
  const session = await newSession(alice)
  const ids = []
  for (let index = 0; index < 21; index += 1) {
    ids.push(valueOf(await tool(alice, session, 'memory_add', { content: `批量检索测试第${index}条` }), 'memory_add').id)
  }
  const found = valueOf(await tool(alice, session, 'memory_search', { query: '批量检索测试' }), 'memory_search')
  assert.equal(found.matched, 21)
  assert.equal(found.returned, 20)
  assert.equal(found.memories.length, 20)
  assert.equal(found.truncated, true, 'the budget reports what it left out')
  assert.deepEqual(found.memories.map(memory => memory.id), ids.slice(1).reverse(), 'newest content first, then by number')
  assert.equal(found.memories.some(memory => memory.id === ids[0]), false, 'the omitted number is not returned')
})

test('a search returns at most 8000 Unicode characters, even for one long memory', async () => {
  const session = await newSession(alice)
  const keyword = '字符预算测试'
  const second = valueOf(await tool(alice, session, 'memory_add', { content: `${keyword}${'一'.repeat(2994)}` }), 'memory_add').id
  const third = valueOf(await tool(alice, session, 'memory_add', { content: `${keyword}${'二'.repeat(2994)}` }), 'memory_add').id
  const first = valueOf(await tool(alice, session, 'memory_add', { content: `${keyword}${'三'.repeat(2994)}` }), 'memory_add').id

  const found = valueOf(await tool(alice, session, 'memory_search', { query: keyword }), 'memory_search')
  assert.equal(found.matched, 3)
  assert.equal(found.returned, 2, 'two 3000-character memories fill the budget, the third is omitted')
  assert.equal(found.characters, 6000)
  assert.equal(found.truncated, true)
  assert.deepEqual(found.memories.map(memory => memory.id), [first, third])
  assert.equal(found.memories.reduce((total, memory) => total + [...memory.content].length, 0), 6000)

  const huge = valueOf(await tool(alice, session, 'memory_add', { content: `超长记忆测试${'海'.repeat(8001)}` }), 'memory_add').id
  const empty = valueOf(await tool(alice, session, 'memory_search', { query: '超长记忆测试' }), 'memory_search')
  assert.deepEqual(empty.memories, [], 'a memory larger than the whole budget is not returned at all')
  assert.equal(empty.returned, 0)
  assert.equal(empty.matched, 1)
  assert.equal(empty.characters, 0)
  assert.equal(empty.truncated, true, 'the omitted number is reported as truncation, never as a result')
  void huge
}) 

test('search matches literal text, not SQL wildcards', async () => {
  const session = await newSession(alice)
  const percent = valueOf(await tool(alice, session, 'memory_add', { content: '进度 100% 完成' }), 'memory_add').id
  const plain = valueOf(await tool(alice, session, 'memory_add', { content: '进度 100 完成' }), 'memory_add').id
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '%' }), 'memory_search').memories.map(memory => memory.id), [percent],
    'a percent sign is searched as the character it is')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '100 完成' }), 'memory_search').memories.map(memory => memory.id), [plain])
})

test('an edit re-attributes the memory to the editing session', async () => {
  const bobSession = await newSession(bob)
  const added = valueOf(await tool(bob, bobSession, 'memory_add', { content: '归属派生测试：周末爬山' }), 'memory_add')
  assert.equal(valueOf(await tool(bob, bobSession, 'memory_search', { query: '归属派生测试' }), 'memory_search').memories[0].owner_short_id, bob.user.shortId)
  const aliceSession = await newSession(alice)
  const aliceView = valueOf(await tool(alice, aliceSession, 'memory_search', { query: '归属派生测试' }), 'memory_search')
  assert.equal(aliceView.memories[0].owner_short_id, bob.user.shortId, 'searching never rewrites the owner')

  valueOf(await tool(alice, aliceSession, 'memory_edit', { id: added.id, old_string: '周末爬山', new_string: '周末徒步' }), 'memory_edit')
  const edited = valueOf(await tool(alice, aliceSession, 'memory_search', { query: '周末徒步' }), 'memory_search')
  assert.equal(edited.memories[0].owner_short_id, alice.user.shortId, 'the editing session becomes the source')
  assert.equal(storedRows().find(row => row.id === added.id)?.source_session, aliceSession)
})
