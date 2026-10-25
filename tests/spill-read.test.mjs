/**
 * Ticket #83: a spilled tool result stays retrievable inside its own session.
 *
 * Native spill writes `<DSH_HOME>/spill/session-<hash>/…`, outside the caller's
 * spaces roots, so the model's follow-up read used to fail with
 * `FS_PERMISSION_DENIED`. The subject under test is narrow: the *current*
 * session's spill directory becomes an exact read-only root, and nothing else —
 * another session, another user, `DSH_HOME` itself, the attachments data
 * directory — becomes readable.
 *
 * Every case drives the shipped launcher against a real loopback Messages double
 * (the inline shape `tests/spaces.test.mjs` uses). The double names one tool
 * call from the user's text and, once the harness hands back the tool result,
 * echoes that exact wire result — so chained calls need no script and the
 * assertions read the real `is_error` flag and content.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { after, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks,
} from './helpers/backend.mjs'

const PASSWORD = 'spill-read-password'
const homes = []
const models = []
after(async () => {
  for (const model of models) await new Promise(resolve => model.close(resolve))
  for (const home of homes) removeHome(home)
})

function freshHome() {
  const home = makeHome('ourfairy-spill-read-')
  homes.push(home)
  return home
}

/** The inline Messages double; `requests` keeps every body the model received. */
async function startModel() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    let data = ''
    for await (const chunk of req) data += chunk
    const body = JSON.parse(data)
    requests.push(body)
    const blocks = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }])
    const commandIndex = blocks.findLastIndex(block => block.type === 'text' && block.text.startsWith('{"tool":'))
    const command = commandIndex < 0 ? undefined : JSON.parse(blocks[commandIndex].text)
    const result = commandIndex < 0 ? undefined : blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'spill-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result !== undefined) {
      // Echo the wire result, including `is_error`, so a denial cannot read as success.
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta',
        text: `RESULT:${JSON.stringify({ isError: result.is_error ?? false, content: toolResultBlocks(result) })}` } })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'spill-call', name: command.tool, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(command.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result === undefined ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  models.push(server)
  return { baseURL: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close(resolve => resolve()) }
}

async function boot(home, model) {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: PASSWORD,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: model.baseURL })
  return startedPort(run)
}

async function stop(home) {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

let requests = 0
/**
 * Run one model-authored tool call inside `sessionId` and return what the model
 * received: `{ isError, text }`, taken from the double's echo of the wire result.
 */
async function tool(port, token, sessionId, name, args) {
  // `/chat/read` returns a sliding 64-event window, so a RESULT-row count
  // plateaus once older turns fall out. The pre-send cursor marks the boundary:
  // this call's result is the first RESULT row with a higher seq.
  const before = (await httpJson(port, '/chat/read', { token, body: { sessionId } })).projection.throughSeq
  await httpJson(port, '/chat/send', { token, body: { sessionId, requestId: `spill-read-${++requests}`,
    text: JSON.stringify({ tool: name, args }) } })
  const deadline = Date.now() + 90000
  let projection
  do {
    projection = (await httpJson(port, '/chat/read', { token, body: { sessionId } })).projection
    const terminal = projection.messages.filter(message => message.role === 2
      && message.text.startsWith('RESULT:') && message.seq > before)
    // The spill policy adds a notice block to an oversized tool result, and
    // only that rendered text becomes durable, so two RESULT rows can belong to
    // one call. Waiting for the settled turn keeps one call's result from being
    // read as the next call's.
    if (terminal.length > 0 && projection.replyStatus === 0 && projection.attempt === null) {
      const value = JSON.parse(terminal.at(-1).text.slice('RESULT:'.length))
      const text = value.content.filter(block => block.type === 'text').map(block => block.text).join('')
      return { isError: value.isError, text }
    }
    if (projection.error) assert.fail(`chat failed before the tool result: ${projection.error}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  assert.fail(`tool ${name} returned no result; replyStatus=${projection?.replyStatus} attempt=${JSON.stringify(projection?.attempt)} sinceSeq=${before}; projection was ${JSON.stringify(projection?.messages?.slice(-2))}`)
}

/**
 * A shell result that exceeds the 8 000-token inline budget while staying one
 * `read` window: 802 lines of 22–41 characters (33 648 bytes, about 8 400
 * estimated tokens, under `read`'s 50 KiB / 2 000-line defaults), so a
 * full-content comparison is possible. The middle marker is the line the spill
 * preview omits.
 */
const MARKER = 'SPILL-READ-MIDDLE-MARKER'
const SPILL_COMMAND = [
  "for i in $(seq 1 400); do printf 'row-%04d xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n' \"$i\"; done",
  `printf '${MARKER}\\n'`,
  "for i in $(seq 401 800); do printf 'row-%04d xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n' \"$i\"; done",
  "printf 'SPILL-READ-TAIL-MARKER\\n'",
].join('; ')

/** The spill locator the model was handed in the request that carried the tool result. */
function locatorOf(request) {
  const blocks = request.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
  const results = blocks.filter(block => block.type === 'tool_result')
  return /Full formatted result stored at: (\S+?)\. Use read/u.exec(JSON.stringify(results))?.[1]
}

/** The `<content>` body of one read envelope. */
function readBody(text) {
  const body = /<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
  assert.ok(body !== undefined, `not a read envelope: ${JSON.stringify(text.slice(0, 300))}`)
  return body
}

test('a spilled bash result is fully readable and searchable in the session that produced it', async () => {
  const home = freshHome()
  const model = await startModel()
  const port = await boot(home, model)
  const admin = (await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })).token
  const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
  try {
    const spill = await tool(port, admin, session.id, 'bash', { command: SPILL_COMMAND, description: 'print a large result' })
    assert.equal(spill.isError, false, 'a spilled result is not a failed tool call')
    const locator = locatorOf(model.requests.at(-1))
    assert.ok(locator !== undefined, `the model must receive a locator; it saw ${JSON.stringify(spill.text.slice(-400))}`)
    assert.ok(locator.startsWith(`${join(home, 'dsh-home', 'spill')}${sep}`), `the locator must live under the mounted spill root; got ${locator}`)
    assert.equal(spill.text.includes(MARKER), false, 'the preview omits the middle the locator keeps')
    assert.equal(spill.text.includes('SPILL-READ-TAIL-MARKER'), true, 'the preview keeps the tail')

    // `read` on the locator: the default window holds the whole file, so the
    // returned lines must equal the spill file line for line.
    const read = await tool(port, admin, session.id, 'read', { file_path: locator })
    assert.equal(read.isError, false, `read on the locator must succeed, not be denied: ${JSON.stringify(read.text)}`)
    const body = readBody(read.text)
    // Native read ends a complete window with a blank line and the EOF footer.
    const footer = /\n\n\(End of file - total (\d+) lines\)$/u.exec(body)
    assert.ok(footer !== undefined, `a complete read ends with the EOF footer; got ${JSON.stringify(body.slice(-200))}`)
    const lines = body.slice(0, footer.index).split('\n')
    const fileLines = readFileSync(locator, 'utf8').replace(/\n$/u, '').split('\n')
    assert.equal(Number(footer[1]), fileLines.length, 'the read reports the spill file\'s line count')
    assert.deepEqual(lines, fileLines.map((line, index) => `${index + 1}: ${line}`),
      'the read returns the complete spilled result, not the bounded preview')
    assert.equal(fileLines.length, 802)
    assert.match(fileLines.join('\n'), new RegExp(MARKER), 'the spill file keeps the omitted middle')

    // Searchable through the authorized tool that exists: the confined shell,
    // whose namespace mounts the session's read-only contribution.
    const grep = await tool(port, admin, session.id, 'bash',
      { command: `grep -n '${MARKER}' '${locator}'`, description: 'search the spill file' })
    assert.equal(grep.isError, false, `the shell must reach the locator: ${JSON.stringify(grep.text)}`)
    assert.match(grep.text, new RegExp(`\\b401:${MARKER}\\b`), `grep returns the matching line number; got ${JSON.stringify(grep.text.slice(0, 300))}`)

    // The deployment has no native grep tool, so the shell path is the only
    // search surface; that is a catalog fact, not a spill fact.
    const catalog = (model.requests[0].tools ?? []).map(tool => tool.name)
    assert.equal(catalog.includes('grep'), false, `the v1 catalog must not advertise a grep tool; got ${JSON.stringify(catalog)}`)
  } finally {
    await stop(home)
  }
})

test('another session and another user are denied the locator even though the file is readable', async () => {
  const home = freshHome()
  const model = await startModel()
  const port = await boot(home, model)
  const admin = (await httpJson(port, '/identity/sign-in', { body: { name: 'phaethon', password: PASSWORD } })).token
  const alice = await registerUser(port, admin, 'spill-alice', PASSWORD)
  const { session } = await httpJson(port, '/sessions/create', { token: admin, body: {} })
  const aliceSession = (await httpJson(port, '/sessions/create', { token: alice.token, body: {} })).session
  try {
    const spill = await tool(port, admin, session.id, 'bash', { command: SPILL_COMMAND, description: 'print a large result' })
    assert.equal(spill.isError, false)
    const locator = locatorOf(model.requests.at(-1))
    assert.ok(locator !== undefined, 'the owner received a locator')

    // The owning session now has content, so a second create is a genuinely
    // different session: the denial below must be scope, not the same session.
    const otherSession = (await httpJson(port, '/sessions/create', { token: admin, body: {} })).session
    assert.notEqual(otherSession.id, session.id, 'a session with content is not reused as the other session')

    // The denial is scope, not file permission: the process itself can read the
    // file, and the owning session does read it.
    assert.ok(statSync(locator).isFile(), 'the spill file exists')
    assert.equal(statSync(locator).mode & 0o777, 0o600, 'the spill file stays owner-only on disk')
    assert.match(readFileSync(locator, 'utf8'), new RegExp(MARKER), 'the test process can read the file')
    const owner = await tool(port, admin, session.id, 'read', { file_path: locator })
    assert.equal(owner.isError, false, 'the owning session reads its own spill file')

    // Read-only means no writable root: the session that just read the locator
    // cannot overwrite it, and its shell mount is read-only too.
    const before = readFileSync(locator, 'utf8')
    const overwrite = await tool(port, admin, session.id, 'write', { file_path: locator, content: 'overwritten\n' })
    assert.equal(overwrite.isError, true, `write into the spill directory must be refused: ${JSON.stringify(overwrite)}`)
    assert.match(overwrite.text, /writable|denied|outside|permission/i,
      `the write refusal must name the scope; got ${JSON.stringify(overwrite.text)}`)
    const append = await tool(port, admin, session.id, 'bash',
      { command: `printf 'appended\\n' >> '${locator}'`, description: 'try to append to the spill file' })
    // The shell reports a finished command, not a tool error: the refusal is the
    // read-only mount in its stderr, and the file stays byte-identical.
    assert.match(append.text, /read-only file system/i, `the shell mount must be read-only; got ${JSON.stringify(append.text)}`)
    assert.equal(readFileSync(locator, 'utf8'), before, 'a refused write or append leaves the spill file unchanged')

    for (const [label, token, sessionId] of [
      ['another session of the same user', admin, otherSession.id],
      ['another user', alice.token, aliceSession.id],
    ]) {
      const denied = await tool(port, token, sessionId, 'read', { file_path: locator })
      assert.equal(denied.isError, true, `${label} must be denied, not silently served: ${JSON.stringify(denied)}`)
      assert.match(denied.text, /denied|outside|permission/i, `${label} must get a refusal that names it; got ${JSON.stringify(denied.text)}`)
      assert.equal(denied.text.includes(MARKER), false, `${label} must not receive spill content`)
      assert.equal(denied.text.includes('SPILL-READ-TAIL-MARKER'), false, `${label} must not receive the spill tail`)
    }

    // The shell namespace follows the same scope: a foreign session cannot cat it.
    const shell = await tool(port, alice.token, aliceSession.id, 'bash',
      { command: `cat '${locator}'`, description: 'try to read a foreign spill file' })
    assert.equal(shell.text.includes(MARKER), false, 'the confined shell must not carry a foreign spill file')

    // The contribution is the session directory only: a different session, the
    // attachments data directory and DSH_HOME stay outside it. (The spill root
    // holds no regular file, and `read` only opens regular files, so it is not
    // used as a probe here.)
    const sessionDirectory = locator.slice(0, locator.lastIndexOf(sep))
    const sibling = join(sessionDirectory.replace(/session-[0-9a-f]{12}$/u, 'session-000000000000'), 'sibling-spill.txt')
    for (const [label, path] of [
      ['a sibling session directory', sibling],
      ['the attachments data directory', join(home, 'dsh-home', 'uploads')],
      ['DSH_HOME', join(home, 'dsh-home')],
    ]) {
      const denied = await tool(port, admin, session.id, 'read', { file_path: path })
      assert.equal(denied.isError, true, `${label} must not be granted by the spill contribution: ${JSON.stringify(denied)}`)
      assert.match(denied.text, /denied|outside|permission|not a regular file|not a directory/i,
        `${label} denial must be explicit; got ${JSON.stringify(denied.text)}`)
    }
  } finally {
    await stop(home)
  }
})
