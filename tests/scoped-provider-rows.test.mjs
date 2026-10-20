/**
 * The four scoped providers are rows of their own (ticket #101).
 *
 * The spaces row keeps the scope; each provider is a row with a stable id, so a
 * profile overlay can address it. Disabling one must leave the depending
 * capability waiting — never a quieter, unscoped native provider — and the
 * probe must name the row and service that missed. The shell row is also
 * observed through a real model turn: with it disabled, the model is offered no
 * `bash` tool and a call fails with an explicit unknown-tool error while `read`
 * stays available.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  describeRun, makeHome, readReport, removeHome, repoRoot, runBackend, runBackendAsync, writeOverlay,
} from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json')))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const password = 'scoped-rows-password'
const homes = []
const servers = []
after(async () => {
  for (const server of servers) await server.close()
  for (const home of homes) removeHome(home)
})

/** The four rows and the service/tool row each owns. */
const PROVIDERS = [
  { row: 'scoped-fs', name: '@ourfairy/dsh-spaces/fs', service: 'fs', toolRow: 'tool-fs' },
  { row: 'scoped-sandbox', name: '@ourfairy/dsh-spaces/sandbox', service: 'sandbox', toolRow: 'tool-bash' },
  { row: 'scoped-bash', name: '@ourfairy/dsh-spaces/bash', service: 'shell', toolRow: 'tool-bash' },
  { row: 'scoped-directory', name: '@ourfairy/dsh-spaces/directory', service: 'workingDirectory', toolRow: 'tool-working-directory' },
]

/** Native providers the composition must never mount as a silent fallback. */
const NATIVE_PROVIDER_ROWS = ['fs-sandbox', 'working-directory', 'bash-sandbox', 'sandbox']

function freshHome() {
  const home = makeHome('ourfairy-scoped-rows-')
  homes.push(home)
  return home
}

/** Run one probe with the given overlays and read the report it wrote. */
async function probe(home, { overlays = [], report = 'report.json', turn = false, env = {} } = {}) {
  const reportPath = join(home, report)
  const args = ['probe', '--report', reportPath, ...(turn ? ['--turn'] : [])]
  for (const overlay of overlays) args.push('--patch', overlay)
  const run = await runBackendAsync(args, {
    OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password, ...env,
  }, { timeoutMs: 300_000 })
  assert.ok(existsSync(reportPath), `probe wrote no report: ${describeRun('probe', run)}`)
  return { run, report: readReport(reportPath) }
}

test('the four scoped providers are active bundle rows with their own services', async () => {
  const home = freshHome()
  const { run, report } = await probe(home)
  assert.equal(run.code, 0, `the shipped composition must probe cleanly: ${describeRun('probe', run)}`)
  assert.equal(report.ok, true, `probe failures: ${JSON.stringify(report.failures)}`)

  const rows = new Map(report.rows.map(row => [row.id, row]))
  for (const provider of PROVIDERS) {
    const row = rows.get(provider.row)
    assert.ok(row !== undefined, `the bundle must mount row "${provider.row}"`)
    assert.equal(row.name, provider.name, `row "${provider.row}" must mount ${provider.name}`)
    assert.equal(row.fiberState, 'active', `row "${provider.row}" must be active`)
    assert.equal(report.services[provider.service]?.live, true, `service "${provider.service}" must be live`)
    assert.equal(report.services[provider.service]?.expectedRow, provider.row,
      `service "${provider.service}" must be owned by row "${provider.row}"`)
  }
  // The spaces row no longer mounts the providers itself.
  assert.equal(rows.get('spaces')?.name, '@ourfairy/dsh-spaces')
  assert.equal(report.services.ourfairySpaces?.expectedRow, 'spaces')
})

test('disabling one provider row leaves its capability waiting with no native fallback', async () => {
  const home = freshHome()
  // One installation serves every case; the first probe creates it.
  const installed = await probe(home, { report: 'install.json' })
  assert.equal(installed.run.code, 0, `the baseline probe must install cleanly: ${describeRun('probe', installed.run)}`)

  for (const provider of PROVIDERS) {
    const overlay = writeOverlay(home, [{ id: provider.row, disabled: true }], `disable-${provider.row}.patch.yml`)
    const { run, report } = await probe(home, { overlays: [overlay], report: `report-${provider.row}.json` })
    const failures = report.failures.join('\n')

    assert.notEqual(run.code, 0, `probe must fail with "${provider.row}" disabled: ${describeRun('probe', run)}`)
    assert.equal(report.ok, false, `probe must report failure for "${provider.row}"`)
    assert.equal(report.services[provider.service]?.live, false,
      `service "${provider.service}" must be absent when row "${provider.row}" is disabled, not supplied natively`)
    assert.ok(failures.includes(`service "${provider.service}" is not live`),
      `the failure must name service "${provider.service}"; got:\n${failures}`)
    assert.ok(failures.includes(`expected row "${provider.row}"`),
      `the failure must name row "${provider.row}"; got:\n${failures}`)

    const rows = new Map(report.rows.map(row => [row.id, row]))
    assert.notEqual(rows.get(provider.toolRow)?.fiberState, 'active',
      `tool row "${provider.toolRow}" must wait while row "${provider.row}" is disabled`)
    for (const native of NATIVE_PROVIDER_ROWS) {
      assert.ok(!rows.has(native), `the composition must not mount native provider row "${native}"`)
    }
  }
})

test('a bash call under a disabled shell row fails clearly while read stays offered', async () => {
  const home = freshHome()
  const model = await startMockLlmServer({
    apiKey: 'mock-key',
    sequence: ['tool_call_success', 'success'],
    toolName: 'bash',
    toolArguments: JSON.stringify({ command: 'echo disabled-shell' }),
    successText: 'settled',
  })
  servers.push(model)
  const overlay = writeOverlay(home, [{ id: 'scoped-bash', disabled: true }], 'disable-shell.patch.yml')
  const { run } = await probe(home, {
    overlays: [overlay], report: 'report-shell.json', turn: true,
    env: { MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}` },
  })
  assert.notEqual(run.code, 0, `probe must fail with the shell row disabled: ${describeRun('probe', run)}`)
  assert.ok(model.requests.length >= 2, 'the turn must reach the model twice: the tool call and its result')

  const offered = (model.requests[0].body.tools ?? []).map(tool => tool.name)
  assert.ok(offered.includes('read'), `the model must still be offered read: ${JSON.stringify(offered)}`)
  assert.ok(!offered.includes('bash'), `the model must not be offered bash: ${JSON.stringify(offered)}`)

  const blocks = model.requests.at(-1).body.messages
    .flatMap(message => typeof message.content === 'string' ? [] : (message.content ?? []))
  const result = blocks.filter(block => block.type === 'tool_result').at(-1)
  assert.ok(result !== undefined, 'the tool call must produce a tool result')
  assert.equal(result.is_error, true, 'an unknown tool is a failed tool call')
  const text = typeof result.content === 'string'
    ? result.content
    : (result.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('')
  assert.match(text, /unknown tool "bash"/u, `the failure must name the missing tool; got ${JSON.stringify(text)}`)
})
