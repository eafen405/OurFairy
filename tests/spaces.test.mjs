import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun } from './helpers/backend.mjs'

const home = makeHome('ourfairy-spaces-')
const password = 'space-test-password'
let port, model, modelPort, admin, alice, bob
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
async function tool(user, name, args, sessionId) {
  sessionId ??= (await request('/sessions/create', user.token)).session.id
  const old = (await request('/chat/read', user.token, { sessionId })).projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:')).length
  await request('/chat/send', user.token, { sessionId, requestId: `tool-request-${++requestNo}`, text: JSON.stringify({ name, args }) })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', user.token, { sessionId })
    const terminal = projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:'))
    if (terminal.length > old) return terminal.at(-1).text.slice(7)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`tool reply was not returned to original chat; last model request ${JSON.stringify(modelRequests.at(-1))}`)
}
before(async () => {
  const packageDir = join(home, 'fixture', 'package')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'ourfairy-fixture-dep', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(packageDir, 'index.js'), "module.exports = 'shared-dependency-ok'\n")
  execFileSync('tar', ['-czf', join(home, 'fixture.tgz'), '-C', join(home, 'fixture'), 'package'])
  model = http.createServer(async (req, res) => {
    if (req.url === '/fixture.tgz') { res.setHeader('content-type', 'application/gzip'); res.end(readFileSync(join(home, 'fixture.tgz'))); return }
    if (req.url === '/network-probe') { res.end('network-ok'); return }
    let data = ''; for await (const chunk of req) data += chunk
    const body = JSON.parse(data); modelRequests.push(body)
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const commandIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = blocks.slice(commandIndex + 1).findLast(c => c.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'space-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result.content)}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'space-call', name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-space-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('space-alice'); bob = await user('space-bob')
})
after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run)); await new Promise(resolve => model.close(resolve)); removeHome(home)
})
test('chat tools write own private files, share public files, and deny another user including administrator', async () => {
  const root = join(home, 'dsh-home', 'spaces')
  const privateFile = join(root, 'private', String(alice.user.shortId), 'hello.txt')
  assert.match(await tool(alice, 'write', { file_path: privateFile, content: 'private-alice' }), /create|wrote|write|success/i)
  assert.equal(readFileSync(privateFile, 'utf8'), 'private-alice')
  assert.match(await tool(alice, 'read', { file_path: privateFile }), /private-alice/)
  for (const other of [bob, admin]) assert.match(await tool(other, 'read', { file_path: privateFile }), /denied|outside|permission/i)
  const publicFile = join(root, 'public', 'shared.txt')
  await tool(alice, 'write', { file_path: publicFile, content: 'shared-value' })
  assert.match(await tool(bob, 'read', { file_path: publicFile }), /shared-value/)
})

test('real child processes share public files, keep private boundaries after cd, and retain networking', async () => {
  const root = join(home, 'dsh-home', 'spaces')
  const own = join(root, 'private', String(alice.user.shortId))
  const foreign = join(root, 'private', String(bob.user.shortId), 'secret.txt')
  await tool(bob, 'write', { file_path: foreign, content: 'bob-only-secret' })
  const result = await tool(alice, 'bash', { description: 'Verify actual process file and network scope', command:
    `printf child-ok > '${own}/child.txt'; cd '${root}/public'; printf public-child > child.txt; cat '${foreign}'; printf '\\n'; curl --noproxy '*' -fsS http://127.0.0.1:${modelPort}/network-probe; test ! -e '${home}/dsh-home/identity/identity.sqlite'; test -z "$DEEPSEEK_API_KEY"` })
  assert.match(result, /network-ok/)
  assert.doesNotMatch(result, /bob-only-secret/)
  assert.equal(readFileSync(join(own, 'child.txt'), 'utf8'), 'child-ok')
  assert.match(await tool(bob, 'read', { file_path: join(root, 'public', 'child.txt') }), /public-child/)
  const denial = await tool(alice, 'bash', { description: 'Try foreign private file in another cwd', workdir: join(root, 'public'), command: `cat '${foreign}'` })
  assert.match(denial, /No such file|denied|not found/)
  const escalated = await tool(alice, 'bash', { description: 'Request disallowed broader execution', command: `cat '${foreign}'`, sandbox_permissions: 'danger-full-access', justification: 'read another user file' })
  assert.match(escalated, /denied|approval|unavailable|not available/i)
})

test('directory changes, edits, image reads and symlinks retain the same owner boundary', async () => {
  const root = join(home, 'dsh-home', 'spaces')
  const own = join(root, 'private', String(alice.user.shortId))
  const foreign = join(root, 'private', String(bob.user.shortId))
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  assert.match(await tool(alice, 'working_directory', { cd: join(root, 'public') }, sessionId), /public/)
  await tool(alice, 'write', { file_path: 'cd-file.txt', content: 'before-edit' }, sessionId)
  await tool(alice, 'edit', { file_path: 'cd-file.txt', old_string: 'before', new_string: 'after' }, sessionId)
  assert.equal(readFileSync(join(root, 'public', 'cd-file.txt'), 'utf8'), 'after-edit')
  assert.match(await tool(alice, 'working_directory', { cd: foreign }, sessionId), /outside|denied/i)
  assert.match(await tool(alice, 'bash', { description: 'Create symlink to another user private directory', command: `ln -s '${foreign}' '${own}/foreign-link' && printf link-created` }), /link-created/)
  assert.match(await tool(alice, 'read', { file_path: join(own, 'foreign-link', 'secret.txt') }), /outside|denied/i)
  assert.match(await tool(alice, 'write', { file_path: join(own, 'foreign-link', 'secret.txt'), content: 'bad' }), /outside|denied/i)
  const image = join(own, 'one.png')
  await tool(alice, 'bash', { description: 'Create one pixel local image', command: `printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=' | base64 -d > '${image}'` })
  assert.match(await tool(alice, 'read_image', { file_path: image }), /image|png/)
  assert.match(await tool(bob, 'read_image', { file_path: image }), /outside|denied/i)
})

test('agentless filesystem and script Interface calls refuse instead of inheriting a default user', () => {
  const report = JSON.parse(readFileSync(join(home, 'run', 'start-report.json'), 'utf8'))
  assert.deepEqual(report.agentless, { file: 'FS_PERMISSION_DENIED', process: 'FS_PERMISSION_DENIED' })
})

test('shell background children stay confined and detached job entry is explicitly unavailable until T13', async () => {
  const root = join(home, 'dsh-home', 'spaces')
  const proof = join(root, 'private', String(alice.user.shortId), 'background-proof.txt')
  const foreign = join(root, 'private', String(bob.user.shortId), 'secret.txt')
  const detached = await tool(alice, 'bash', { description: 'Try not-yet-enabled detached job entry', run_in_background: true, command: `cat '${foreign}'` })
  assert.match(detached, /disabled/)
  await tool(alice, 'bash', { description: 'Verify actual background child file isolation',
    command: `(sleep .1; if cat '${foreign}'; then printf LEAK > '${proof}'; else printf blocked > '${proof}'; fi) & wait` })
  assert.equal(readFileSync(proof, 'utf8'), 'blocked')
})

test('a network-installed dependency is available to both users in the one shared environment', async () => {
  const env = join(home, 'dsh-home', 'env')
  const install = await tool(alice, 'bash', { description: 'Install fixture dependency through actual network', command:
    `npm install --prefix '${env}/node' --ignore-scripts --no-audit --no-fund http://127.0.0.1:${modelPort}/fixture.tgz && node -e "process.stdout.write(require('ourfairy-fixture-dep'))"` })
  assert.match(install, /shared-dependency-ok/)
  assert.match(await tool(bob, 'bash', { description: 'Use dependency installed by another user', command:
    `node -e "process.stdout.write(require('ourfairy-fixture-dep'))"` }), /shared-dependency-ok/)
})

test('ensure restores the owner private root when a persisted working directory disappears', async () => {
  const own = join(home, 'dsh-home', 'spaces', 'private', String(alice.user.shortId))
  const temporary = join(own, 'temporary-cwd')
  await tool(alice, 'bash', { description: 'Create a temporary directory in own space', command: `mkdir -p '${temporary}'` })
  const sessionId = (await request('/sessions/create', alice.token)).session.id
  await tool(alice, 'working_directory', { cd: temporary }, sessionId)
  await tool(alice, 'bash', { description: 'Remove own temporary directory from another session', command: `rmdir '${temporary}'` })
  assert.match(await tool(alice, 'read', { file_path: 'hello.txt' }, sessionId), /private-alice/)
})
