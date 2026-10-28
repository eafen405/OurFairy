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
import { answerIfTitle } from './helpers/title-aware.mjs'

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

/**
 * The stored number of one memory, located by its exact content.
 *
 * A successful add answers only `{ok:true}`, so a case that needs the number
 * reads the row's own database instead of the tool result.
 */
function idOf(content) {
  const row = storedRows().find(entry => entry.content === content)
  assert.ok(row !== undefined, `the memory ${JSON.stringify(content.slice(0, 40))} must be stored`)
  return row.id
}

before(async () => {
  model = http.createServer(async (request, response) => {
    // Collect the bytes first: decoding each network chunk on its own splits a
    // multi-byte character that straddles two chunks into replacement marks.
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(Buffer.concat(chunks).toString('utf8'), response)) return
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
  // These cases drive up to 21 closed turns through one session; keep them
  // below the maintenance threshold so this file tests CRUD, not maintenance.
  // The maintenance engine's own suite sets the threshold it needs.
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-memory-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}`,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50', OURFAIRY_MEMORY_MAINTENANCE_DECAY_HOURS: '24' })
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
  assert.deepEqual(added, { ok: true }, 'add answers a simple confirmation')

  const normal = valueOf(await tool(alice, session, 'memory_search', { query: '雨天散步' }), 'memory_search')
  assert.deepEqual(normal.memories.map(memory => memory.id), [idOf('雨天散步让人放松')])
  const [memory] = normal.memories
  assert.ok(Number.isSafeInteger(memory.id) && memory.id > 0, `a memory needs an integer number; got ${JSON.stringify(memory)}`)
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
  assert.deepEqual(added, { ok: true }, 'add answers a simple confirmation')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作' }), 'normal memory_search').memories, [])
  const deep = valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作', is_private: true }), 'deep memory_search')
  const addedId = idOf('清晨写作效率最高')
  assert.deepEqual(deep.memories.map(memory => memory.id), [addedId])
  const updatedAt = deep.memories[0].content_updated_at

  const toNormal = valueOf(await tool(alice, session, 'memory_switch', { id: addedId }), 'memory_switch')
  assert.deepEqual(toNormal, { ok: true }, 'switch answers a simple confirmation')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作', is_private: true }), 'deep memory_search').memories, [])
  const normal = valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作' }), 'normal memory_search')
  assert.deepEqual(normal.memories.map(memory => memory.id), [addedId])
  assert.equal(normal.memories[0].content_updated_at, updatedAt, 'a switch never updates the content time')

  const toPrivate = valueOf(await tool(alice, session, 'memory_switch', { id: addedId }), 'memory_switch')
  assert.deepEqual(toPrivate, { ok: true }, 'switch answers the same confirmation in both directions')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '清晨写作' }), 'normal memory_search').memories, [])
})

test('memory_edit replaces one uniquely matched fragment and refuses zero or several matches', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '我喜欢喝乌龙茶，也喜欢喝红茶。' }), 'memory_add')
  assert.deepEqual(added, { ok: true }, 'add answers a simple confirmation')
  const addedId = idOf('我喜欢喝乌龙茶，也喜欢喝红茶。')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '乌龙茶' }), 'memory_search').memories.map(memory => memory.id), [addedId])

  assert.deepEqual(valueOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '乌龙茶', new_string: '普洱茶' }), 'memory_edit'), { ok: true })
  const edited = valueOf(await tool(alice, session, 'memory_search', { query: '普洱茶' }), 'memory_search')
  assert.deepEqual(edited.memories.map(memory => memory.content), ['我喜欢喝普洱茶，也喜欢喝红茶。'])

  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '绿茶', new_string: '白茶' })), /memory\/no-match/,
    'an old fragment that does not occur is an error')

  const repeated = valueOf(await tool(alice, session, 'memory_add', { content: '重复的记号在这里，重复的记号也在那里' }), 'memory_add')
  assert.deepEqual(repeated, { ok: true })
  const repeatedId = idOf('重复的记号在这里，重复的记号也在那里')
  valueOf(await tool(alice, session, 'memory_search', { query: '重复的记号' }), 'memory_search')
  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: repeatedId, old_string: '重复的记号', new_string: '唯一记号' })), /memory\/ambiguous-match/,
    'an old fragment that occurs twice is refused rather than guessed')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '重复的记号' }), 'memory_search').memories.map(memory => memory.content),
    ['重复的记号在这里，重复的记号也在那里'], 'a refused edit changes nothing')

  const whole = valueOf(await tool(alice, session, 'memory_search', { query: '普洱茶' }), 'memory_search').memories[0]
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: whole.content, new_string: '整段替换后的记忆正文' }), 'memory_edit'), { ok: true })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '整段替换' }), 'memory_search').memories.map(memory => memory.content), ['整段替换后的记忆正文'],
    'passing the complete old content is how a whole-memory rewrite is expressed')
})

test('memory_delete removes the row physically and never reuses its number', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '这条记忆稍后会被删除' }), 'memory_add')
  assert.deepEqual(added, { ok: true })
  const addedId = idOf('这条记忆稍后会被删除')
  valueOf(await tool(alice, session, 'memory_search', { query: '稍后会被删除' }), 'memory_search')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_delete', { id: addedId }), 'memory_delete'), { ok: true })
  assert.deepEqual(storedRows().filter(row => row.id === addedId), [], 'a deleted memory leaves no row behind')
  const empty = valueOf(await tool(alice, session, 'memory_search', { query: '稍后会被删除' }), 'memory_search')
  assert.deepEqual(empty.memories, [])
  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '删除', new_string: '保留' })), /memory\/unknown-memory/,
    'a deleted number no longer names a memory')
  const next = valueOf(await tool(alice, session, 'memory_add', { content: '删除之后新增的记忆' }), 'memory_add')
  assert.deepEqual(next, { ok: true })
  const nextId = idOf('删除之后新增的记忆')
  assert.ok(nextId > addedId, `a number is never reused; got ${nextId} after deleting ${addedId}`)
})

test('edit, delete and switch need the number to have been returned in the calling session', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '门禁测试的记忆：一只橘猫' }), 'memory_add')
  assert.deepEqual(added, { ok: true })
  const addedId = idOf('门禁测试的记忆：一只橘猫')
  // `/sessions/create` re-enters the newest empty session, so the second
  // session of this identity only becomes distinct once this one has content.
  const secondSession = await newSession(alice)
  const bobSession = await newSession(bob)
  assert.notEqual(secondSession, session, 'the gate has to prove a second session')

  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '橘猫', new_string: '黑猫' })), /memory\/not-queried/,
    'adding does not authorize changing the new memory')
  assert.match(errorOf(await tool(alice, session, 'memory_delete', { id: addedId })), /memory\/not-queried/)
  assert.match(errorOf(await tool(alice, session, 'memory_switch', { id: addedId })), /memory\/not-queried/)

  assert.deepEqual(valueOf(await tool(alice, secondSession, 'memory_search', { query: '橘猫' }), 'memory_search').memories.map(memory => memory.id), [addedId])
  assert.match(errorOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '橘猫', new_string: '黑猫' })), /memory\/not-queried/,
    'a query in another session never authorizes this one')

  // Bob's session has seen nothing yet: a different identity's fresh session is
  // no more authorized than a second session of the same identity.
  assert.match(errorOf(await tool(bob, bobSession, 'memory_delete', { id: addedId })), /memory\/not-queried/,
    'another identity\'s session authorizes nothing until it searches itself')
  const bobView = valueOf(await tool(bob, bobSession, 'memory_search', { query: '橘猫' }), 'memory_search')
  assert.equal(bobView.memories[0].owner_short_id, alice.user.shortId, 'the owner is the source session owner, not the searcher')
  assert.match(errorOf(await tool(alice, session, 'memory_delete', { id: addedId })), /memory\/not-queried/,
    'the second session\'s query never authorizes this one')
  assert.match(errorOf(await tool(alice, session, 'memory_switch', { id: addedId })), /memory\/not-queried/)

  valueOf(await tool(alice, session, 'memory_search', { query: '橘猫' }), 'memory_search')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '橘猫', new_string: '狸花猫' }), 'memory_edit'), { ok: true })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_delete', { id: addedId }), 'memory_delete'), { ok: true })
})

test('search dates are one closed interval over the content time, and omitted dates search everything', async () => {
  const session = await newSession(alice)
  const added = valueOf(await tool(alice, session, 'memory_add', { content: '关于日期的记忆：第一次去海边' }), 'memory_add')
  assert.deepEqual(added, { ok: true })
  const found = valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边' }), 'memory_search')
  const addedId = found.memories[0].id
  const updatedAt = found.memories[0].content_updated_at
  const idsOf = value => value.memories.map(memory => memory.id)

  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边' }), 'memory_search')), [addedId],
    'omitting both bounds searches every date')
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt, end_at: updatedAt }), 'memory_search')), [addedId],
    'both bounds are inclusive, so one instant can select the memory it equals')
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt, end_at: updatedAt + 60000 }), 'memory_search')), [addedId])
  assert.deepEqual(idsOf(valueOf(await tool(alice, session, 'memory_search', { query: '第一次去海边', start_at: updatedAt - 60000, end_at: updatedAt }), 'memory_search')), [addedId])
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
  assert.deepEqual(added, { ok: true })
  const first = valueOf(await tool(alice, session, 'memory_search', { query: '海边日落' }), 'memory_search').memories[0]
  const addedId = first.id
  const addedAt = first.content_updated_at

  await delay(5)
  assert.equal(valueOf(await tool(alice, session, 'memory_search', { query: '海边日落' }), 'memory_search').memories[0].content_updated_at, addedAt,
    'a search never updates the content time')
  valueOf(await tool(alice, session, 'memory_switch', { id: addedId }), 'memory_switch')
  const switched = valueOf(await tool(alice, session, 'memory_search', { query: '海边日落', is_private: true }), 'memory_search')
  assert.equal(switched.memories[0].content_updated_at, addedAt, 'a switch never updates the content time')

  await delay(5)
  valueOf(await tool(alice, session, 'memory_edit', { id: addedId, old_string: '海边日落', new_string: '海边日出', is_private: true }), 'memory_edit')
  const edited = valueOf(await tool(alice, session, 'memory_search', { query: '海边日出', is_private: true }), 'memory_search').memories[0]
  assert.ok(edited.content_updated_at > addedAt, `an edit moves the content time; ${edited.content_updated_at} <= ${addedAt}`)
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '海边日出', is_private: true, start_at: edited.content_updated_at, end_at: edited.content_updated_at }), 'memory_search').memories.map(memory => memory.id),
    [addedId], 'the date filter follows the edited content time')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '海边日出', is_private: true, start_at: addedAt, end_at: addedAt }), 'memory_search').memories, [],
    'the old content time no longer selects it')
})

test('a search returns at most 20 memories and never exposes an omitted number', async () => {
  const session = await newSession(alice)
  for (let index = 0; index < 21; index += 1) {
    assert.deepEqual(valueOf(await tool(alice, session, 'memory_add', { content: `批量检索测试第${index}条` }), 'memory_add'), { ok: true })
  }
  const ids = []
  for (let index = 0; index < 21; index += 1) ids.push(idOf(`批量检索测试第${index}条`))
  const found = valueOf(await tool(alice, session, 'memory_search', { query: '批量检索测试' }), 'memory_search')
  assert.equal(found.matched, 21)
  assert.equal(found.returned, 20)
  assert.equal(found.memories.length, 20)
  assert.equal(found.truncated, true, 'the budget reports what it left out')
  assert.deepEqual(found.memories.map(memory => memory.id), ids.slice(1).reverse(), 'newest content first, then by number')
  assert.equal(found.memories.some(memory => memory.id === ids[0]), false, 'the omitted number is not returned')
})

test('the 8000-character search budget is also the largest memory a write may store', async () => {
  const session = await newSession(alice)
  const keyword = '字符预算测试'
  for (const body of [`${keyword}${'一'.repeat(2994)}`, `${keyword}${'二'.repeat(2994)}`, `${keyword}${'三'.repeat(2994)}`]) {
    assert.deepEqual(valueOf(await tool(alice, session, 'memory_add', { content: body }), 'memory_add'), { ok: true })
  }
  const second = idOf(`${keyword}${'一'.repeat(2994)}`)
  const third = idOf(`${keyword}${'二'.repeat(2994)}`)
  const first = idOf(`${keyword}${'三'.repeat(2994)}`)

  const found = valueOf(await tool(alice, session, 'memory_search', { query: keyword }), 'memory_search')
  assert.equal(found.matched, 3)
  assert.equal(found.returned, 2, 'two 3000-character memories fill the budget, the third is omitted')
  assert.equal(found.characters, 6000)
  assert.equal(found.truncated, true)
  assert.deepEqual(found.memories.map(memory => memory.id), [first, third])
  assert.equal(found.memories.some(memory => memory.id === second), false, 'the memory that did not fit is not returned')
  assert.equal(found.memories.reduce((total, memory) => total + [...memory.content].length, 0), 6000)

  // Exactly 8000 Unicode characters is storable and is returned whole: the
  // budget is a per-memory write limit as well as a per-search one.
  const exact = `${keyword}${'界'.repeat(8000 - keyword.length)}`
  assert.equal([...exact].length, 8000)
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_add', { content: exact }), 'memory_add'), { ok: true })
  const exactFound = valueOf(await tool(alice, session, 'memory_search', { query: keyword }), 'memory_search')
  assert.deepEqual(exactFound.memories.map(memory => memory.id), [idOf(exact)],
    'the newest memory fills the budget exactly, so the older three are omitted')
  assert.equal(exactFound.characters, 8000)
  assert.equal(exactFound.returned, 1)
  assert.equal(exactFound.truncated, true)

  // One character over the budget is refused at add, before any row exists:
  // such a row could never be returned by a search and therefore could never
  // be edited, deleted or switched (User Story 10, ADR-0002).
  const over = `${keyword}${'海'.repeat(8001)}`
  const refusedAdd = errorOf(await tool(alice, session, 'memory_add', { content: over }), 'memory_add')
  assert.match(refusedAdd, /memory\/invalid-content/)
  assert.match(refusedAdd, /8000/, 'the refusal names the budget')
  assert.equal(storedRows().some(row => row.content === over), false, 'an over-budget add stores no row')

  // The post-edit content is bounded the same way; a refused edit changes nothing.
  const target = `${keyword}编辑目标`
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_add', { content: target }), 'memory_add'), { ok: true })
  const targetId = idOf(target)
  valueOf(await tool(alice, session, 'memory_search', { query: target }), 'memory_search')
  const refusedEdit = errorOf(await tool(alice, session, 'memory_edit', {
    id: targetId, old_string: '编辑目标', new_string: `${keyword}${'改'.repeat(8001)}`,
  }), 'memory_edit')
  assert.match(refusedEdit, /memory\/invalid-content/)
  assert.equal(storedRows().find(row => row.id === targetId)?.content, target, 'a refused over-budget edit leaves the row unchanged')
})

test('search matches literal text, not SQL wildcards', async () => {
  const session = await newSession(alice)
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_add', { content: '进度 100% 完成' }), 'memory_add'), { ok: true })
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_add', { content: '进度 100 完成' }), 'memory_add'), { ok: true })
  const percent = idOf('进度 100% 完成')
  const plain = idOf('进度 100 完成')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '%' }), 'memory_search').memories.map(memory => memory.id), [percent],
    'a percent sign is searched as the character it is')
  assert.deepEqual(valueOf(await tool(alice, session, 'memory_search', { query: '100 完成' }), 'memory_search').memories.map(memory => memory.id), [plain])
})

test('an edit re-attributes the memory to the editing session', async () => {
  const bobSession = await newSession(bob)
  assert.deepEqual(valueOf(await tool(bob, bobSession, 'memory_add', { content: '归属派生测试：周末爬山' }), 'memory_add'), { ok: true })
  const addedId = idOf('归属派生测试：周末爬山')
  assert.equal(valueOf(await tool(bob, bobSession, 'memory_search', { query: '归属派生测试' }), 'memory_search').memories[0].owner_short_id, bob.user.shortId)
  const aliceSession = await newSession(alice)
  const aliceView = valueOf(await tool(alice, aliceSession, 'memory_search', { query: '归属派生测试' }), 'memory_search')
  assert.equal(aliceView.memories[0].owner_short_id, bob.user.shortId, 'searching never rewrites the owner')

  assert.deepEqual(valueOf(await tool(alice, aliceSession, 'memory_edit', { id: addedId, old_string: '周末爬山', new_string: '周末徒步' }), 'memory_edit'), { ok: true })
  const edited = valueOf(await tool(alice, aliceSession, 'memory_search', { query: '周末徒步' }), 'memory_search')
  assert.equal(edited.memories[0].owner_short_id, alice.user.shortId, 'the editing session becomes the source')
  assert.equal(storedRows().find(row => row.id === addedId)?.source_session, aliceSession)
})
