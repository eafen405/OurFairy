/**
 * Model-interface evidence for ticket #24.
 *
 * The backend boots against an EXTERNAL model double: a real loopback HTTP
 * process speaking the Messages protocol (`@deepseek-ai/dsh-llm-mock-server`),
 * selected through the same `OURFAIRY_MINIMAX_BASE_URL` / `MINIMAX_CN_API_KEY` deployment
 * surface a real endpoint would use. The assertions are about what actually
 * crossed the wire — the double's captured requests — not about a Loader that
 * did not throw.
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { dshDir, describeRun, DURABLE_LOG, makeHome, readReport, removeHome, runBackendAsync } from './helpers/backend.mjs'

const { startMockLlmServer } = await import(join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js'))

const home = makeHome('ourfairy-model-double-')
const reportPath = join(home, 'turn-report.json')
let server
after(async () => {
  if (server !== undefined) await server.close()
  removeHome(home)
})

test('one real turn reaches the external model double, registers tools, and persists the session', async () => {
  server = await startMockLlmServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: 'mock-key',
    sequence: ['success'],
  })

  const run = await runBackendAsync(['probe', '--turn', '--report', reportPath], {
    OURFAIRY_HOME: home,
    OURFAIRY_MINIMAX_BASE_URL: `${server.baseURL}`,
    MINIMAX_CN_API_KEY: 'mock-key',
  })
  assert.equal(run.code, 0, describeRun('probe --turn against the external model double', run))

  const report = readReport(reportPath)
  assert.deepEqual(report.failures, [], `probe failures:\n${(report.failures ?? []).join('\n')}`)

  // The model interface is live: a request crossed the loopback wire.
  assert.ok(
    server.requests.length >= 1,
    `no request reached the external model double; report.model=${JSON.stringify(report.model)}`,
  )
  const request = server.requests[0]
  assert.equal(request.path, '/v1/messages', `model request must use the Messages path; got ${request.path}`)

  // Tool registration is observable to the model: the request advertises the v1 tool catalog.
  const tools = Array.isArray(request.body?.tools) ? request.body.tools : undefined
  assert.ok(
    tools !== undefined,
    `model request carried no tool catalog; body keys were ${JSON.stringify(Object.keys(request.body ?? {}))}`,
  )
  const toolNames = tools.map(tool => tool?.name)
  assert.ok(
    toolNames.includes('todo_write'),
    `the mounted tool-todo row must advertise todo_write to the model; catalog was ${JSON.stringify(toolNames)}`,
  )
  // 手写预期工具列表，独立检查已审查的注册项，防止意外暴露工具。
  assert.deepEqual([...toolNames].sort(), [
    'bash',
    'conversation_read',
    'conversation_search',
    'deliver_message',
    'edit',
    'group_create',
    'groups',
    'impression_edit',
    'impression_read',
    'job_kill',
    'job_list',
    'job_output',
    'memory_add',
    'memory_delete',
    'memory_edit',
    'memory_search',
    'memory_switch',
    'pdf_info',
    'pdf_read_pages',
    'pdf_render_pages',
    'read',
    'read_image',
    'todo_write',
    'working_directory',
    'write',
  ], `the model receives only the adapted v1 tool catalog: ${JSON.stringify(toolNames)}`)

  // The model interface worked end to end: the turn produced assistant text.
  assert.ok(
    typeof report.model?.output === 'string' && report.model.output.length > 0,
    `the turn produced no assistant text; report.model=${JSON.stringify(report.model)}`,
  )

  // Persistence基础 is durable: the session log landed in the isolated home.
  // The durable artifact is the compressed session log (`session.v4.jsonl.zstd`);
  // an uncompressed `.jsonl` is equally acceptable when compression is off.
  assert.ok(
    Array.isArray(report.sessions?.files)
      && report.sessions.files.some(name => DURABLE_LOG.test(name)),
    `no durable session log under ${report.sessions?.root}; report.sessions=${JSON.stringify(report.sessions)}`,
  )
})

test('a turn without credentials fails with a diagnostic naming the missing variable', async () => {
  const keylessHome = makeHome('ourfairy-model-keyless-')
  try {
    const run = await runBackendAsync(['probe', '--turn', '--report', join(keylessHome, 'report.json')], {
      OURFAIRY_HOME: keylessHome,
      MINIMAX_CN_API_KEY: undefined,
      OURFAIRY_MINIMAX_BASE_URL: undefined,
    })
    assert.notEqual(run.code, 0, describeRun('probe --turn without credentials must fail', run))
    assert.ok(
      `${run.stdout}\n${run.stderr}`.includes('MINIMAX_CN_API_KEY'),
      `diagnostic must name MINIMAX_CN_API_KEY; output was:\n${run.stdout}\n${run.stderr}`,
    )
  } finally {
    removeHome(keylessHome)
  }
})
