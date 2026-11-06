/** Native web tools through the shipped chat routes and external HTTP boundaries. @covers backend/v1-bundle */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { describeRun, dshDir, httpJson, makeHome, messageBlocks, registerUser, removeHome, repoRoot, runBackendAsync, startArgs, startedPort, writeOverlay } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

async function harness(t, { searchKey } = {}) {
  const home = makeHome('ourfairy-web-')
  const requests = []
  const networkRequests = []
  const network = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    networkRequests.push({ path: request.url, method: request.method, headers: request.headers, body: raw ? JSON.parse(raw) : undefined })
    if (request.url === '/v1/tools/search') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ results: [{ url: 'http://origin.test/route', title: 'Sixth Street route',
        snippet: 'The shortcut is open after sunset.', date: '2026-11-06' }] }))
    } else if (request.url === 'http://origin.test/route') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<h1>Sixth Street route</h1><p>The shortcut is open after sunset.</p>')
    } else {
      response.writeHead(502)
      response.end('Unexpected test destination')
    }
  })
  network.listen(0, '127.0.0.1')
  await once(network, 'listening')
  const networkURL = `http://127.0.0.1:${network.address().port}`
  const model = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    requests.push(body)
    const blocks = body.messages.flatMap(messageBlocks)
    const at = blocks.findLastIndex(block => block.type === 'text' && block.text.startsWith('{"name":'))
    const command = JSON.parse(blocks[at].text)
    const result = blocks.slice(at + 1).findLast(block => block.type === 'tool_result')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result)}` } })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: randomUUID(), name: command.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(command.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  t.after(async () => {
    const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
    model.closeAllConnections()
    network.closeAllConnections()
    await Promise.all([new Promise(resolve => model.close(resolve)), new Promise(resolve => network.close(resolve))])
    assert.equal(stopped.code, 0, `${describeRun('stop web test backend', stopped)}\nRetained backend home: ${home}`)
    removeHome(home)
  })
  const password = 'web-test-password'
  // A loader patch replaces the whole config; preserve the shipped privacy and credential settings.
  const boot = createRequire(join(dshDir, 'apps/cli/package.json'))('@deepseek-ai/dsh-app-boot')
  const rows = boot.composeEntries([boot.loadOverlayPatches('dsh', join(repoRoot, 'backend/v1-bundle/cordis.patch.yml'))])
  const searchConfig = rows.find(row => row.id === 'plugins').config.find(row => row.id === 'web-deepseek-api').config
  const overlay = writeOverlay(home, [{ id: 'web-deepseek-api', config: { ...searchConfig, baseURL: `${networkURL}/v1/tools` } }])
  const run = await runBackendAsync(startArgs([overlay]), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-model-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    DEEPSEEK_API_KEY: searchKey, OURFAIRY_CREDENTIALS_FILE: join(home, 'credentials.yaml'),
    HTTP_PROXY: networkURL, HTTPS_PROXY: networkURL, NO_PROXY: '127.0.0.1,localhost',
    http_proxy: undefined, https_proxy: undefined, no_proxy: undefined, ALL_PROXY: undefined, all_proxy: undefined })
  const port = startedPort(run)
  const call = (path, token, body = {}) => httpJson(port, path, { token, body })
  const admin = await call('/identity/sign-in', undefined, { name: 'phaethon', password })
  async function tool(user, name, args, sessionId) {
    sessionId ??= (await call('/sessions/create', user.token)).session.id
    const old = new Set((await call('/chat/read', user.token, { sessionId })).projection.messages.map(message => message.messageId))
    await call('/chat/send', user.token, { sessionId, requestId: randomUUID(), text: JSON.stringify({ name, args }) })
    const until = Date.now() + 15_000
    while (Date.now() < until) {
      const { projection } = await call('/chat/read', user.token, { sessionId })
      assert.ok(!projection.error, JSON.stringify(projection.error))
      const reply = projection.messages.find(message => message.role === 2 && !old.has(message.messageId) && message.text.startsWith('RESULT:'))
      if (reply) return JSON.parse(reply.text.slice(7))
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail(`no ${name} result returned to its chat`)
  }
  return { port, admin, requests, networkRequests, call, tool }
}

const textOf = result => messageBlocks(result).filter(block => block.type === 'text').map(block => block.text).join('\n')

test('missing search credentials make no request and still allow anonymous HTTP fetch', async t => {
  const world = await harness(t)
  const result = await world.tool(world.admin, 'web_search', { queries: ['Sixth Street route'] })
  assert.equal(result.is_error, true)
  assert.match(textOf(result), /no API key/)
  assert.match(textOf(result), /DEEPSEEK_API_KEY/)
  assert.deepEqual(world.networkRequests, [])
  assert.ok(world.requests[0].tools.some(tool => tool.name === 'web_fetch'))

  const fetched = await world.tool(world.admin, 'web_fetch', { url: 'http://origin.test/route' })
  assert.notEqual(fetched.is_error, true, textOf(fetched))
  assert.match(textOf(fetched), /# Sixth Street route/)
  assert.match(textOf(fetched), /The shortcut is open after sunset\./)
  assert.deepEqual(world.networkRequests.map(request => [request.method, request.path]), [['GET', 'http://origin.test/route']])
  assert.equal(world.networkRequests[0].headers.authorization, undefined)
})

test('search sends only the model query and returns sources through the conversation', async t => {
  const world = await harness(t, { searchKey: 'mock-search-key' })
  const result = await world.tool(world.admin, 'web_search', { queries: ['Sixth Street route'] })
  assert.notEqual(result.is_error, true, textOf(result))
  assert.match(textOf(result), /\[Sixth Street route\]\(http:\/\/origin\.test\/route\)/)
  assert.match(textOf(result), /The shortcut is open after sunset\./)
  assert.match(textOf(result), /2026-11-06/)
  assert.equal(world.networkRequests.length, 1)
  const [request] = world.networkRequests
  assert.equal(request.path, '/v1/tools/search')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.authorization, 'Bearer mock-search-key')
  assert.deepEqual(request.body, { query: 'Sixth Street route', count: 8, need_content: false })
})

test('owner, agent, and a member working in a group directory can search and fetch', async t => {
  const world = await harness(t, { searchKey: 'mock-search-key' })
  const alice = await registerUser(world.port, world.admin.token, 'web-alice')
  const bob = await registerUser(world.port, world.admin.token, 'web-bob')
  const created = await world.tool(world.admin, 'group_create', { name: 'Route research', ownerShortId: alice.user.shortId })
  assert.notEqual(created.is_error, true, textOf(created))
  const group = JSON.parse(textOf(created))
  const joined = await world.tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 1 })
  assert.notEqual(joined.is_error, true, textOf(joined))
  const groupSession = (await world.call('/sessions/create', bob.token)).session.id
  const changed = await world.tool(bob, 'working_directory', { cd: group.root }, groupSession)
  assert.notEqual(changed.is_error, true, textOf(changed))
  assert.ok(textOf(changed).includes(group.root))

  for (const [role, user, sessionId] of [['owner', world.admin], ['agent', alice], ['group member', bob, groupSession]]) {
    const from = world.requests.length
    const searched = await world.tool(user, 'web_search', { queries: [`Sixth Street route for ${role}`] }, sessionId)
    assert.notEqual(searched.is_error, true, `${role}: ${textOf(searched)}`)
    assert.match(textOf(searched), /http:\/\/origin\.test\/route/)
    const fetched = await world.tool(user, 'web_fetch', { url: 'http://origin.test/route' }, sessionId)
    assert.notEqual(fetched.is_error, true, `${role}: ${textOf(fetched)}`)
    assert.match(textOf(fetched), /The shortcut is open after sunset\./)
    for (const request of world.requests.slice(from)) {
      for (const name of ['web_search', 'web_fetch']) {
        assert.ok(request.tools.some(tool => tool.name === name), `${role} must see ${name}`)
      }
    }
  }
  assert.equal(world.networkRequests.filter(request => request.path === '/v1/tools/search').length, 3)
  assert.equal(world.networkRequests.filter(request => request.path === 'http://origin.test/route').length, 3)
})
