/**
 * The four scoped providers are rows of their own (ticket #101).
 *
 * The spaces row keeps the scope; each provider is a row with a stable id, so a
 * profile overlay can address it. Disabling one must leave the depending
 * capability waiting — never a quieter, unscoped native provider. A disabled
 * expected row is an intentional absence: the probe records the row's disabled
 * flag and does not fail readiness for its own missing service. Dependants that
 * still need it keep failing and are named (fs and working-directory cascade
 * through attachments/chat), while disabling the shell alone leaves the
 * composition ready. The shell row is also observed through a real model turn:
 * with it disabled, the model is offered no `bash` tool and a call fails with an
 * explicit unknown-tool error while `read` stays available.
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

test('disabling one provider row leaves its capability absent or waiting with no native fallback', async () => {
  const home = freshHome()
  // One installation serves every case; the first probe creates it.
  const installed = await probe(home, { report: 'install.json' })
  assert.equal(installed.run.code, 0, `the baseline probe must install cleanly: ${describeRun('probe', installed.run)}`)

  // A disabled expected row is an intentional absence: the probe skips its own
  // missing service instead of failing readiness. The capability's dependants
  // still show the consequence, and for `scoped-bash` nothing else needs the
  // shell, so the whole composition stays healthy (#105: start succeeds while a
  // scoped provider is disabled). `fs` and `workingDirectory` are deeper cuts:
  // attachments (and therefore chat) wait on them, so their compositions fail.
  const DEPENDANT_FAILURES = {
    'scoped-fs': ['service "ourfairyAttachments" is not live'],
    'scoped-sandbox': ['service "shell" is not live'],
    'scoped-directory': ['service "ourfairyAttachments" is not live'],
  }

  for (const provider of PROVIDERS) {
    const overlay = writeOverlay(home, [{ id: provider.row, disabled: true }], `disable-${provider.row}.patch.yml`)
    const { run, report } = await probe(home, { overlays: [overlay], report: `report-${provider.row}.json` })
    const failures = report.failures.join('\n')

    assert.equal(report.services[provider.service]?.live, false,
      `service "${provider.service}" must be absent when row "${provider.row}" is disabled, not supplied natively`)
    assert.equal(report.services[provider.service]?.disabled, true,
      `the report must record the disabled expected row for service "${provider.service}"`)
    // The disabled row's own absence is deliberate, not a readiness failure.
    assert.equal(failures.includes(`service "${provider.service}" is not live`), false,
      `a disabled expected row must not fail the probe as an absent service; got:\n${failures}`)
    assert.equal(failures.includes(`bundle product row "${provider.row}"`), false,
      `a disabled row must not be reported as an inactive product row; got:\n${failures}`)

    if (provider.row === 'scoped-bash') {
      assert.equal(run.code, 0, `probe must succeed with only "${provider.row}" disabled: ${describeRun('probe', run)}`)
      assert.equal(report.ok, true, `probe must report ready: ${JSON.stringify(report.failures)}`)
    } else {
      assert.notEqual(run.code, 0,
        `probe must still fail while "${provider.row}" leaves its dependants waiting: ${describeRun('probe', run)}`)
      assert.equal(report.ok, false, `probe must report the waiting dependants of "${provider.row}"`)
      for (const failure of DEPENDANT_FAILURES[provider.row]) {
        assert.ok(failures.includes(failure),
          `the failure must name the waiting dependant (${failure}); got:\n${failures}`)
      }
    }

    const rows = new Map(report.rows.map(row => [row.id, row]))
    assert.equal(rows.get(provider.row)?.disabled, true,
      `the overlay must disable the addressed row "${provider.row}"`)
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
  const { run, report } = await probe(home, {
    overlays: [overlay], report: 'report-shell.json', turn: true,
    env: { MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}` },
  })
  // The disabled row's expected service is an intentional absence, so the probe
  // still reports ready and the turn runs to completion; the capability itself
  // is gone from the catalog.
  assert.equal(run.code, 0, `probe must succeed with the shell row deliberately disabled: ${describeRun('probe', run)}`)
  assert.equal(report.ok, true, `probe failures: ${JSON.stringify(report.failures)}`)
  assert.equal(report.services.shell?.disabled, true, 'the shell row must be recorded as disabled')
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
