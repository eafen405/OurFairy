/**
 * The group capability is one removable row (ticket #100).
 *
 * The bundle mounts the group tools and the group-root contribution as their
 * own row, so disabling exactly that row must take both away and leave the
 * private/public file spaces and confined scripts working. Everything asserted
 * here is caller-visible: the tool catalog the model receives, and the results
 * the tools return through the product's own chat routes. The row id is
 * exercised the way an operator addresses it — an overlay disabling `groups`.
 *
 * @covers backend/groups
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { before, after, test } from 'node:test'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks, writeOverlay } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-groups-row-')
const password = 'groups-row-password'
const spacesRoot = join(home, 'dsh-home', 'spaces')
let port, model, modelPort, admin, alice
const modelRequests = []

function request(path, token, body = {}) {
  return httpJson(port, path, { token, body })
}

let requestNo = 0
/** Send one tool call through chat and return the tool result body as text. */
async function tool(user, name, args, sessionId) {
  sessionId ??= (await request('/sessions/create', user.token, {})).session.id
  const seen = new Set((await request('/chat/read', user.token, { sessionId })).projection.messages.map(m => m.messageId))
  await request('/chat/send', user.token, { sessionId, requestId: `groups-row-request-${++requestNo}`, text: JSON.stringify({ name, args }) })
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

/** The tool names the model was offered on the most recent request. */
function offeredTools() {
  const request = modelRequests.at(-1)
  assert.ok(Array.isArray(request?.tools), `the model request carried no tool catalog: ${JSON.stringify(Object.keys(request ?? {}))}`)
  return request.tools.map(tool => tool.name)
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
    emit({ type: 'message_start', message: { id: 'groups-row-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(toolResultBlocks(result))}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'groups-row-call', name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  const overlay = writeOverlay(home, [{ id: 'groups', disabled: true }], 'no-groups.patch.yml')
  const run = await runBackendAsync(startArgs([overlay]), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-groups-row-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'groups-row-alice', password)
})

after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('disabling the groups row removes the group tools and roots, not the file spaces or scripts', async () => {
  const sessionId = (await request('/sessions/create', alice.token, {})).session.id
  const privateDir = join(spacesRoot, 'private', String(alice.user.shortId))
  const privateFile = join(privateDir, 'private-notes.txt')
  const publicFile = join(spacesRoot, 'public', 'shared-notes.txt')
  const groupRoot = join(spacesRoot, 'groups', '1')

  // The file spaces are a different row: private and public files still work.
  assert.match(await tool(alice, 'write', { file_path: privateFile, content: 'groups-row-private' }, sessionId), /create|wrote|write|success/i)
  assert.match(await tool(alice, 'read', { file_path: privateFile }, sessionId), /groups-row-private/)
  assert.match(await tool(alice, 'write', { file_path: publicFile, content: 'groups-row-public' }, sessionId), /create|wrote|write|success/i)
  assert.match(await tool(alice, 'read', { file_path: publicFile }, sessionId), /groups-row-public/)

  // Confined scripts are a different row: they still run inside the private space.
  const script = await tool(alice, 'bash', { description: 'Run a confined script in the private space',
    workdir: privateDir, command: "printf 'groups-row-script' > script.txt; cat script.txt" }, sessionId)
  assert.match(script, /groups-row-script/)

  // The model is no longer offered any group tool.
  const offered = offeredTools()
  for (const name of ['groups', 'group_create', 'group_members']) {
    assert.equal(offered.includes(name), false, `a disabled groups row must not offer ${name}: ${JSON.stringify(offered)}`)
  }
  assert.ok(offered.includes('read') && offered.includes('write') && offered.includes('bash'),
    `file and script tools must survive the disabled groups row: ${JSON.stringify(offered)}`)
  assert.match(await tool(alice, 'groups', {}, sessionId), /unknown tool/i)
  assert.match(await tool(admin, 'group_create', { name: 'Forbidden', ownerShortId: alice.user.shortId }), /unknown tool/i)

  // The group root is not contributed: reading, writing, or running a script
  // there is refused exactly as any path outside the authorized spaces is.
  assert.match(await tool(alice, 'read', { file_path: join(groupRoot, 'missing.txt') }, sessionId), /outside|denied/i)
  assert.match(await tool(alice, 'write', { file_path: join(groupRoot, 'forbidden.txt'), content: 'NO' }, sessionId), /outside|denied/i)
  assert.match(await tool(alice, 'bash', { description: 'Try the absent group root', workdir: groupRoot, command: 'cat missing.txt' }, sessionId), /outside|denied/i)

  // The private space still works after the refused group operations.
  assert.match(await tool(alice, 'read', { file_path: privateFile }, sessionId), /groups-row-private/)
})
