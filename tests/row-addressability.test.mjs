/**
 * Ticket #105: a profile overlay addresses rows by their stable ids.
 *
 * The bundle mounts delivery, groups and each scoped provider as its own row.
 * These cases exercise the operator's overlay path — `--patch` — and assert
 * only caller-visible facts: the boot result, the tool catalog the model is
 * offered, the tool results the product's own chat routes return, and the
 * rows/services a probe reports. No private composition object is inspected.
 *
 * Two boot paths appear here:
 *
 * - `start` (through the launcher) waits for the probe to report ready, so it
 *   proves a disabled delivery/groups row still leaves every service the
 *   composition promises. A disabled scoped provider leaves its service absent
 *   by design, which the probe (correctly) reports as a failure; those cases
 *   boot the pinned dsh CLI directly, the same way `start` does minus the
 *   launcher's readiness gate.
 * - The filesystem provider is a deeper cut: `scoped-directory` and the
 *   `attachments` row (which the chat routes wait on) both require `fs`, so
 *   disabling `scoped-fs` leaves dependent rows waiting rather than mounting an
 *   unscoped fallback. The direct boot still serves the identity/session HTTP
 *   surface, and the chat routes are absent (404) because their row never
 *   activates. That is the caller-visible failure for this row; no tool catalog
 *   exists to call `read`/`write` against.
 * - Replacing a provider is disable-plus-insert. A patch carrying `id` and
 *   `name` only checks the name; a different name is warned about and skipped,
 *   and even a matching name cannot change the row's module. The overlay here
 *   disables `scoped-bash` and inserts a fixture row that provides the same
 *   `shell` service. Because the probe's service table expects that service on
 *   `scoped-bash`, this case also boots the CLI directly.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, repoRoot, runBackendAsync,
  startArgs, startedPort, toolResultBlocks, writeOverlay,
} from './helpers/backend.mjs'

const password = 'row-addressability-password'
const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshDir = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath
const dshBin = join(dshDir, 'apps', 'cli', 'lib', 'bin.js')
const recordingFixture = fileURLToPath(new URL('./fixtures/recording-bash-provider.mjs', import.meta.url))

const homes = []
const children = []
const servers = []
const runningLaunchers = new Set()

after(async () => {
  for (const child of children) await stopChild(child)
  for (const home of runningLaunchers) await stopLauncher(home, { assertOk: false })
  for (const server of servers) await closeServer(server)
  for (const home of homes) removeHome(home)
})

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function freshHome(prefix) {
  const home = makeHome(prefix)
  homes.push(home)
  return home
}

/** Close one in-process model server once; the file's `after` may run it again. */
function closeServer(server) {
  if (server.listening !== true) return Promise.resolve()
  return new Promise(resolve => server.close(resolve))
}

/**
 * A model double that turns one JSON tool command in the user text into a
 * tool_use block, and a tool result back into a plain assistant reply.
 *
 * Plain text gets a plain reply, which is how the chat send/read cases reach a
 * completed turn without invoking a tool. The double records the raw request
 * bodies so a test can read the tool catalog the model was actually offered.
 */
async function modelDouble() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    let data = ''
    for await (const chunk of req) data += chunk
    const body = JSON.parse(data)
    requests.push(body)
    const blocks = body.messages.flatMap(message =>
      typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : (message.content ?? []))
    const commandIndex = blocks.findLastIndex(block =>
      block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('{"name":'))
    const command = commandIndex >= 0 ? blocks[commandIndex] : undefined
    const result = commandIndex >= 0
      ? blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')
      : undefined

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({
      type: 'message_start',
      message: {
        id: 'row-addressability-message', type: 'message', role: 'assistant', model: 'test',
        content: [], usage: { input_tokens: 3, output_tokens: 0 },
      },
    })
    if (result !== undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({
        type: 'content_block_delta', index: 0,
        delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(toolResultBlocks(result))}` },
      })
    } else if (command !== undefined) {
      const call = JSON.parse(command.text)
      emit({
        type: 'content_block_start', index: 0,
        content_block: { type: 'tool_use', id: 'row-addressability-call', name: call.name, input: {} },
      })
      emit({
        type: 'content_block_delta', index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args ?? {}) },
      })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'acknowledged' } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({
      type: 'message_delta',
      delta: { stop_reason: result !== undefined || command === undefined ? 'end_turn' : 'tool_use', stop_sequence: null },
      usage: { output_tokens: 3 },
    })
    emit({ type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  servers.push(server)
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => closeServer(server) }
}

const modelEnv = model => ({
  MINIMAX_CN_API_KEY: 'mock-row-addressability-key',
  OURFAIRY_MINIMAX_BASE_URL: model.url,
})

/** Boot through the product launcher, which requires the probe to report ready. */
async function startLauncher(home, model, overlays = []) {
  const run = await runBackendAsync(startArgs(overlays), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    ...(model === undefined ? {} : modelEnv(model)),
  })
  const port = startedPort(run)
  runningLaunchers.add(home)
  return port
}

async function stopLauncher(home, { assertOk = true } = {}) {
  runningLaunchers.delete(home)
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  if (assertOk) assert.equal(run.code, 0, describeRun('stop', run))
}

/** Run one probe with the overlays and read the report it wrote. */
async function probe(home, overlays = [], report = 'report.json') {
  const reportPath = join(home, report)
  const args = ['probe', '--report', reportPath]
  for (const overlay of overlays) args.push('--patch', overlay)
  const run = await runBackendAsync(args, { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password })
  assert.ok(existsSync(reportPath), `probe wrote no report: ${describeRun('probe', run)}`)
  return { run, report: JSON.parse(readFileSync(reportPath, 'utf8')) }
}

/** A port the OS just showed to be free; the direct boot binds it explicitly. */
async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

/**
 * Boot the pinned CLI directly with one overlay, as the launcher does, but
 * without the probe readiness gate. Readiness is the caller-visible sign-in
 * route answering, not a log line.
 */
async function startDirect(home, model, overlay) {
  const port = await freePort()
  mkdirSync(join(home, 'user-home'), { recursive: true })
  const child = spawn(process.execPath, [dshBin, '--profile', 'ourfairy', '--patch', overlay], {
    cwd: home,
    env: {
      ...process.env,
      HOME: join(home, 'user-home'),
      DSH_HOME: join(home, 'dsh-home'),
      OURFAIRY_HOME: home,
      OURFAIRY_PORT: String(port),
      OURFAIRY_PHAETHON_PASSWORD: password,
      ...modelEnv(model),
      XDG_CACHE_HOME: join(home, 'cache'),
      XDG_CONFIG_HOME: join(home, 'config'),
      XDG_DATA_HOME: join(home, 'data'),
      XDG_STATE_HOME: join(home, 'state'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = { stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { logs.stdout += chunk })
  child.stderr.on('data', chunk => { logs.stderr += chunk })
  children.push(child)

  const deadline = Date.now() + 120000
  for (;;) {
    if (child.exitCode !== null) {
      assert.fail(`direct boot exited ${child.exitCode} before serving:\n${logs.stderr}\n${logs.stdout}`)
    }
    try {
      const response = await httpJson(port, '/identity/sign-in', {
        body: { name: 'phaethon', password }, expect: false,
      })
      if (response.status === 200) return { port, child, logs }
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) {
      assert.fail(`direct boot never answered /identity/sign-in on port ${port}:\n${logs.stderr}\n${logs.stdout}`)
    }
    await delay(50)
  }
}

async function stopChild(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(10000).then(() => false),
  ])
  if (!stopped) {
    child.kill('SIGKILL')
    await once(child, 'exit').catch(() => {})
  }
}

const request = (port, path, token, body) => httpJson(port, path, { token, body })

async function signIn(port, name, value) {
  return (await request(port, '/identity/sign-in', undefined, { name, password: value })).token
}

/** The tool names the model was offered in one captured request. */
const offeredTools = captured =>
  (Array.isArray(captured?.tools) ? captured.tools.map(tool => tool?.name) : [])

/** Wait until the composed tool rows are active, observable through the catalog. */
async function waitForCatalog(port, token, sessionId, requests, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  let index = requests.length
  for (;;) {
    const requestId = `catalog-${Date.now()}-${index}`
    await request(port, '/chat/send', token, {
      sessionId, requestId, text: `catalog probe ${requestId}`,
    })
    const sentAt = Date.now()
    while (requests.length <= index) {
      if (Date.now() > deadline) {
        const { projection } = await request(port, '/chat/read', token, { sessionId })
        assert.fail(`the model was never asked after a chat send; projection=${JSON.stringify({
          replyStatus: projection?.replyStatus,
          error: projection?.error,
          messages: projection?.messages?.map(message => [message.role, message.status, message.text.slice(0, 80)]),
        })}`)
      }
      // A turn that failed before the model request records why in the projection.
      if (Date.now() - sentAt > 5000) {
        const { projection } = await request(port, '/chat/read', token, { sessionId })
        if (projection?.error) assert.fail(`chat failed before the model was asked: ${projection.error}`)
      }
      await delay(100)
    }
    const catalog = offeredTools(requests[index])
    if (predicate(catalog)) return catalog
    index = requests.length
    if (Date.now() > deadline) {
      assert.fail(`the tool catalog never satisfied the condition; last catalog was ${JSON.stringify(catalog)}`)
    }
    await delay(100)
  }
}

/** Wait for one caller-visible condition in the projection the phone reads. */
async function until(port, token, sessionId, check, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  let projection
  do {
    projection = (await request(port, '/chat/read', token, { sessionId })).projection
    if (check(projection)) return projection
    await delay(25)
  } while (Date.now() < deadline)
  assert.fail(`condition not reached; projection was ${JSON.stringify({
    replyStatus: projection?.replyStatus,
    error: projection?.error,
    messages: projection?.messages?.map(message => [message.role, message.status, message.text.slice(0, 60)]),
  })}`)
}

let requestNo = 0

/**
 * Send one tool call through chat and return the tool result body as text.
 * The caller sees exactly what the product returned to the model.
 */
async function tool(port, user, name, args, sessionId) {
  sessionId ??= (await request(port, '/sessions/create', user.token, {})).session.id
  const seen = new Set((await request(port, '/chat/read', user.token, { sessionId }))
    .projection.messages.map(message => message.messageId))
  await request(port, '/chat/send', user.token, {
    sessionId, requestId: `tool-request-${++requestNo}`, text: JSON.stringify({ name, args }),
  })
  const deadline = Date.now() + 90000
  for (;;) {
    const { projection } = await request(port, '/chat/read', user.token, { sessionId })
    const fresh = projection.messages
      .filter(message => message.role === 2 && message.text.startsWith('RESULT:'))
      .find(message => !seen.has(message.messageId))
    if (fresh !== undefined) {
      // The double echoes the tool result as the block array the wire carried;
      // the caller sees the joined text, not that framing.
      const blocks = JSON.parse(fresh.text.slice('RESULT:'.length))
      return blocks.map(block => block.text ?? '').join('')
    }
    if (projection.error) assert.fail(`chat failed before returning the tool result: ${projection.error}`)
    if (Date.now() > deadline) assert.fail(`tool ${name} returned no result`)
    await delay(25)
  }
}

test('disabling the delivery row leaves chat serving and refuses deliver_message', async () => {
  const home = freshHome('ourfairy-row-address-delivery-')
  const model = await modelDouble()
  const overlay = writeOverlay(home, [{ id: 'delivery', disabled: true }], 'disable-delivery.patch.yml')
  let started = false
  try {
    const port = await startLauncher(home, model, [overlay])
    started = true
    const admin = { token: await signIn(port, 'phaethon', password) }
    const session = (await request(port, '/sessions/create', admin.token, {})).session.id

    const catalog = await waitForCatalog(port, admin.token, session, model.requests,
      names => names.includes('read') && names.includes('bash'))
    assert.ok(catalog.includes('todo_write'),
      `the catalog was captured; it offered ${JSON.stringify(catalog)}`)
    assert.equal(catalog.includes('deliver_message'), false,
      `the disabled row must offer no deliver_message tool; catalog was ${JSON.stringify(catalog)}`)

    // Chat still sends and reads with the delivery row gone.
    await request(port, '/chat/send', admin.token, {
      sessionId: session, requestId: 'delivery-disabled-chat', text: 'hello without the delivery row',
    })
    const projection = await until(port, admin.token, session,
      value => value.replyStatus === 0
        && value.messages.some(message => message.role === 2 && message.status === 2))
    assert.ok(projection.messages.some(message => message.role === 1 && message.text === 'hello without the delivery row'),
      'chat accepted the user message with the row disabled')
    assert.ok(projection.messages.some(message => message.role === 2 && message.text === 'acknowledged'),
      'chat produced the assistant reply with the row disabled')

    // A caller that asks for the absent capability gets an explicit failure.
    const result = await tool(port, admin, 'deliver_message', { recipientShortId: 2, text: 'never sent' }, session)
    assert.match(result, /unknown tool "deliver_message"/u,
      `the absent capability must fail explicitly; result was ${result}`)
  } finally {
    if (started) await stopLauncher(home, { assertOk: false })
    await model.close()
  }
})

test('disabling the groups row removes its tools and roots, not the file spaces or scripts', async () => {
  const home = freshHome('ourfairy-row-address-groups-')
  const model = await modelDouble()
  const overlay = writeOverlay(home, [{ id: 'groups', disabled: true }], 'disable-groups.patch.yml')
  let started = false
  try {
    const port = await startLauncher(home, model, [overlay])
    started = true
    const admin = { token: await signIn(port, 'phaethon', password) }
    const alice = await registerUser(port, admin.token, 'row-address-alice', password)
    const session = (await request(port, '/sessions/create', alice.token, {})).session.id
    const spacesRoot = join(home, 'dsh-home', 'spaces')
    const privateDir = join(spacesRoot, 'private', String(alice.user.shortId))
    const privateFile = join(privateDir, 'private-notes.txt')
    const publicFile = join(spacesRoot, 'public', 'shared-notes.txt')
    const groupRoot = join(spacesRoot, 'groups', '1')

    const catalog = await waitForCatalog(port, alice.token, session, model.requests,
      names => names.includes('read') && names.includes('bash'))
    for (const name of ['groups', 'group_create', 'group_members']) {
      assert.equal(catalog.includes(name), false,
        `a disabled groups row must not offer ${name}: ${JSON.stringify(catalog)}`)
    }
    assert.ok(catalog.includes('read') && catalog.includes('write') && catalog.includes('bash'),
      `file and script tools must survive the disabled groups row: ${JSON.stringify(catalog)}`)

    // Private and public file spaces are different rows and still work.
    assert.match(await tool(port, alice, 'write', { file_path: privateFile, content: 'row-address-private' }, session),
      /create|wrote|write|success/i)
    assert.match(await tool(port, alice, 'read', { file_path: privateFile }, session), /row-address-private/)
    assert.match(await tool(port, alice, 'write', { file_path: publicFile, content: 'row-address-public' }, session),
      /create|wrote|write|success/i)
    assert.match(await tool(port, alice, 'read', { file_path: publicFile }, session), /row-address-public/)
    assert.match(await tool(port, alice, 'bash', {
      description: 'Run a confined script in the private space',
      workdir: privateDir,
      command: "printf 'row-address-script' > script.txt; cat script.txt",
    }, session), /row-address-script/)

    // The absent group tool and root fail explicitly.
    assert.match(await tool(port, alice, 'groups', {}, session), /unknown tool "groups"/u)
    assert.match(await tool(port, alice, 'read', { file_path: join(groupRoot, 'missing.txt') }, session),
      /outside|denied/i)
    assert.match(await tool(port, alice, 'write', { file_path: join(groupRoot, 'forbidden.txt'), content: 'NO' }, session),
      /outside|denied/i)
  } finally {
    if (started) await stopLauncher(home, { assertOk: false })
    await model.close()
  }
})

test('disabling a scoped provider keeps the HTTP surface while its service and tool are absent', async () => {
  const home = freshHome('ourfairy-row-address-shell-')
  const overlay = writeOverlay(home, [{ id: 'scoped-bash', disabled: true }], 'disable-scoped-bash.patch.yml')

  // Install the profile with a clean boot, then observe the same composition
  // with the row disabled through the probe's authoritative row/service facts.
  const baseline = await probe(home, [], 'baseline.json')
  assert.equal(baseline.run.code, 0, `the baseline composition must probe cleanly: ${describeRun('probe', baseline.run)}`)
  assert.equal(baseline.report.ok, true, `baseline failures: ${JSON.stringify(baseline.report.failures)}`)
  const disabled = await probe(home, [overlay], 'disabled.json')
  assert.notEqual(disabled.run.code, 0, `probe must fail with the shell row disabled: ${describeRun('probe', disabled.run)}`)
  assert.equal(disabled.report.services.shell?.live, false,
    'disabling the row must leave the shell service absent, not supplied by a native fallback')
  assert.equal(disabled.report.services.shell?.expectedRow, 'scoped-bash')
  assert.ok(disabled.report.failures.join('\n').includes('service "shell" is not live'),
    `the failure must name the missing service; got ${JSON.stringify(disabled.report.failures)}`)

  // A fallback provider would be a row the baseline composition never had.
  const baselineRows = new Set(baseline.report.rows.map(row => row.id))
  const appeared = disabled.report.rows.map(row => row.id).filter(id => !baselineRows.has(id))
  assert.deepEqual(appeared, [],
    `disabling a scoped provider must not mount fallback rows; it added ${JSON.stringify(appeared)}`)
  assert.equal(disabled.report.rows.find(row => row.id === 'scoped-bash')?.disabled, true,
    'the addressed row must be the one the overlay disabled')

  const model = await modelDouble()
  let child
  try {
    const direct = await startDirect(home, model, overlay)
    child = direct.child
    const adminToken = await signIn(direct.port, 'phaethon', password)
    const admin = { token: adminToken }
    const session = (await request(direct.port, '/sessions/create', admin.token, {})).session.id

    // The HTTP surface still signs in, creates a session and completes a turn.
    await request(direct.port, '/chat/send', admin.token, {
      sessionId: session, requestId: 'shell-disabled-chat', text: 'hello without the shell row',
    })
    const projection = await until(direct.port, admin.token, session,
      value => value.replyStatus === 0
        && value.messages.some(message => message.role === 2 && message.text === 'acknowledged'))
    assert.ok(projection.messages.some(message => message.role === 1 && message.text === 'hello without the shell row'))

    const catalog = await waitForCatalog(direct.port, admin.token, session, model.requests,
      names => names.includes('read'))
    assert.equal(catalog.includes('bash'), false,
      `the disabled provider must not offer bash; catalog was ${JSON.stringify(catalog)}`)

    const result = await tool(direct.port, admin, 'bash', { command: 'echo should-not-run' }, session)
    assert.match(result, /unknown tool "bash"/u,
      `the absent capability must fail explicitly; result was ${result}`)
  } finally {
    if (child !== undefined) await stopChild(child)
    await model.close()
  }
})

test('disabling the fs provider leaves its dependants waiting, not a fallback', async () => {
  const home = freshHome('ourfairy-row-address-fs-')
  const overlay = writeOverlay(home, [{ id: 'scoped-fs', disabled: true }], 'disable-scoped-fs.patch.yml')

  // The row and the service it owns are the caller-visible facts: the probe
  // names both the missing service and the row that should have owned it.
  const baseline = await probe(home, [], 'baseline.json')
  assert.equal(baseline.run.code, 0, `the baseline composition must probe cleanly: ${describeRun('probe', baseline.run)}`)
  assert.equal(baseline.report.ok, true, `baseline failures: ${JSON.stringify(baseline.report.failures)}`)
  const disabled = await probe(home, [overlay], 'disabled.json')
  assert.notEqual(disabled.run.code, 0, `probe must fail with the fs row disabled: ${describeRun('probe', disabled.run)}`)
  const failures = disabled.report.failures.join('\n')
  assert.equal(disabled.report.services.fs?.live, false,
    'disabling the row must leave the fs service absent, not supplied by a native fallback')
  assert.equal(disabled.report.services.fs?.expectedRow, 'scoped-fs')
  assert.ok(failures.includes('service "fs" is not live'),
    `the failure must name the missing service; got ${JSON.stringify(disabled.report.failures)}`)
  assert.ok(failures.includes('expected row "scoped-fs"'),
    `the failure must name the addressed row; got ${JSON.stringify(disabled.report.failures)}`)

  // `fs` is a hard dependency of the scoped directory provider and of the
  // attachments row the chat rows wait on. Those rows wait; nothing remounts a
  // native provider beneath them.
  const rows = new Map(disabled.report.rows.map(row => [row.id, row]))
  assert.equal(rows.get('scoped-fs')?.disabled, true,
    'the addressed row must be the one the overlay disabled')
  for (const id of ['scoped-directory', 'attachments', 'chat']) {
    assert.equal(rows.get(id)?.fiberState, 'pending',
      `row "${id}" must wait for the missing fs service; got ${JSON.stringify(rows.get(id))}`)
  }
  for (const native of ['fs-sandbox', 'working-directory', 'bash-sandbox', 'sandbox']) {
    assert.equal(rows.has(native), false, `the composition must not mount native provider row "${native}"`)
  }
  const baselineRows = new Set(baseline.report.rows.map(row => row.id))
  const appeared = disabled.report.rows.map(row => row.id).filter(id => !baselineRows.has(id))
  assert.deepEqual(appeared, [],
    `disabling the fs provider must not mount fallback rows; it added ${JSON.stringify(appeared)}`)

  // Boot direct: the web carrier, identity and session routes survive, while
  // the chat routes never register because the chat row is still waiting on the
  // fs-dependent attachments row. The absent capability is an explicit 404,
  // and there is no tool catalog because no chat turn can start.
  const model = await modelDouble()
  let child
  try {
    const direct = await startDirect(home, model, overlay)
    child = direct.child
    const admin = { token: await signIn(direct.port, 'phaethon', password) }
    const created = await request(direct.port, '/sessions/create', admin.token, {})
    assert.ok(created.session?.id, `the session route must survive the disabled fs row: ${JSON.stringify(created)}`)

    const read = await httpJson(direct.port, '/chat/read', {
      token: admin.token, body: { sessionId: created.session.id }, expect: false,
    })
    assert.equal(read.status, 404,
      `the chat route must be absent while its row waits; got ${read.status}: ${read.text}`)
    const send = await httpJson(direct.port, '/chat/send', {
      token: admin.token,
      body: { sessionId: created.session.id, requestId: 'fs-disabled-chat', text: 'hello without the fs row' },
      expect: false,
    })
    assert.equal(send.status, 404,
      `the chat route must be absent while its row waits; got ${send.status}: ${send.text}`)
  } finally {
    if (child !== undefined) await stopChild(child)
    await model.close()
  }
})

test('an overlay can replace the shell provider and leave the other providers working', async () => {
  const home = freshHome('ourfairy-row-address-replace-')
  const installed = await probe(home, [], 'install.json')
  assert.equal(installed.run.code, 0, `the profile must install cleanly first: ${describeRun('probe', installed.run)}`)

  // A name-only patch is a guard, not a module replacement; the working
  // replacement disables the row and inserts a row that provides `shell`.
  const overlay = writeOverlay(home, [
    { id: 'scoped-bash', disabled: true },
    { insert: [{ id: 'scoped-bash-recording', name: recordingFixture }] },
  ], 'recording-bash.patch.yml')

  const model = await modelDouble()
  let child
  try {
    const direct = await startDirect(home, model, overlay)
    child = direct.child
    const admin = { token: await signIn(direct.port, 'phaethon', password) }
    const session = (await request(direct.port, '/sessions/create', admin.token, {})).session.id
    const spacesRoot = join(home, 'dsh-home', 'spaces')
    const privateDir = join(spacesRoot, 'private', String(1))
    const privateFile = join(privateDir, 'replacement-notes.txt')

    const catalog = await waitForCatalog(direct.port, admin.token, session, model.requests,
      names => names.includes('bash') && names.includes('read'))
    assert.ok(catalog.includes('bash'),
      `the replacement row must offer bash again; catalog was ${JSON.stringify(catalog)}`)

    // The shell tool exists again, and its result names the fixture module.
    const shell = await tool(direct.port, admin, 'bash', {
      description: 'Prove the replacement provider ran',
      workdir: privateDir,
      command: "printf 'replacement-shell'",
    }, session)
    assert.match(shell, /\[fixture\]/u, `the replacement provider must mark its output; got ${shell}`)
    assert.match(shell, /replacement-shell/, `the command must still run; got ${shell}`)

    // The other providers are separate rows and are unaffected.
    assert.match(await tool(direct.port, admin, 'write', { file_path: privateFile, content: 'replacement-private' }, session),
      /create|wrote|write|success/i)
    assert.match(await tool(direct.port, admin, 'read', { file_path: privateFile }, session), /replacement-private/)
    assert.ok((await tool(direct.port, admin, 'working_directory', {}, session)).includes(privateDir),
      'the working-directory provider must still report the private space')
  } finally {
    if (child !== undefined) await stopChild(child)
    await model.close()
  }
})

test('an invalid row config fails at load and names the row and field', async () => {
  const home = freshHome('ourfairy-row-address-invalid-')
  const overlay = writeOverlay(home, [{ id: 'identity', config: { sessionTtlDays: 30 } }], 'invalid-identity.patch.yml')
  try {
    // The launcher waits for the probe's ready report; bound that wait so the
    // load failure is observed promptly instead of after the default two minutes.
    const run = await runBackendAsync([...startArgs([overlay]), '--ready-timeout-ms', '30000'], {
      OURFAIRY_HOME: home,
      OURFAIRY_PHAETHON_PASSWORD: password,
    })
    assert.notEqual(run.code, 0,
      `a start with a missing identity.path must fail during load: ${describeRun('start', run)}`)
    assert.doesNotMatch(run.stdout, /"ready":\s*true/u,
      `the failed start must not report readiness: ${run.stdout}`)
    assert.equal(run.stdout.includes('listeningPorts'), false,
      `the failed start must not report a listening port: ${run.stdout}`)
    assert.match(run.stderr, /identity/u, `the failure must name the row: ${run.stderr}`)

    // The field error is in the boot log the launcher points at; its stderr is
    // the probe's failure summary plus that pointer. The operator sees both.
    const logLine = /^log (.+):$/mu.exec(run.stderr)
    assert.ok(logLine !== null, `the failure must point at the boot log: ${run.stderr}`)
    const log = readFileSync(logLine[1], 'utf8')
    assert.match(log, /identity/u, `the boot log must name the row: ${log}`)
    assert.match(log, /\$\.path/u, `the boot log must name the missing field: ${log}`)

    // The report the start wrote records the same failed row a probe would.
    const report = JSON.parse(readFileSync(join(home, 'run', 'start-report.json'), 'utf8'))
    assert.equal(report.ok, false, `the start report must record failure: ${JSON.stringify(report)}`)
    assert.equal(report.rows.find(row => row.id === 'identity')?.fiberState, 'failed',
      `the invalid row must be reported failed: ${JSON.stringify(report.rows)}`)
    assert.match(report.failures.join('\n'),
      /bundle product row "identity" \(@ourfairy\/dsh-identity\) is not active/u,
      `the report must name the failing row; got ${JSON.stringify(report.failures)}`)
  } finally {
    await stopLauncher(home, { assertOk: false }).catch(() => {})
  }
})
