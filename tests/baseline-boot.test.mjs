/**
 * Baseline acceptance tests for ticket #24.
 *
 * These drive the real product launcher, which boots the pinned dsh CLI with
 * the OurFairy v1 profile, an isolated OURFAIRY_HOME, and the test-only
 * liveness probe. They assert observable facts about the running composition
 * (live services, composed rows, registered tools, durable session files) —
 * never that "the Loader did not throw".
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { describeRun, makeHome, readReport, removeHome, runBackend } from './helpers/backend.mjs'

/** Services the v1 baseline must provide for a live session, tools, model, and persistence base. */
const REQUIRED_SERVICES = [
  'sessions',
  'tools',
  'llm',
  'agents',
  'sessionPersistence',
  'sessionQuery',
  'sessionProjections',
]

/**
 * Rows the first version must NOT mount: file, shell, and sandbox capabilities
 * whose permission adaptation is not implemented yet, plus capabilities the
 * product decision excluded from v1 entirely.
 */
const FORBIDDEN_ROW_IDS = [
  'tool-fs',
  'tool-fs-search',
  'fs-sandbox',
  'fs-observation-policy',
  'working-directory',
  'tool-working-directory',
  'tool-bash',
  'bash-sandbox',
  'pwsh-sandbox',
  'tool-pwsh',
  'sandbox',
  'sandbox-policy',
  'approval',
  'permission',
  'shell-env',
  'subprocess',
  'skill',
  'skill-filesystem',
  'tool-skill',
  'goal',
  'goal-round-driver',
  'tool-goal',
  'command-goal',
  'subagent',
  'subagent-spawn-in-process',
  'subagent-fork-in-process',
  'tool-subagent',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent-fork',
  'otel',
  'session-telemetry-otel',
  'web',
  'web-search-deepseek',
  'web-fetch-http',
  'tool-web',
  'mcp-resources',
  'plan-mode',
  'workflow-ptc',
  'tool-workflow',
  'ptc-runtime',
]

const sharedHome = makeHome()
const reportPath = join(sharedHome, 'probe-report.json')
after(() => removeHome(sharedHome))

/** Keyless environment: no model credentials may leak in from the test process. */
const keylessEnv = {
  OURFAIRY_HOME: sharedHome,
  DEEPSEEK_API_KEY: undefined,
  DEEPSEEK_BASE_URL: undefined,
}

describe('OurFairy v1 baseline composition', () => {
  test('real profile boot reports every required service live (keyless)', () => {
    const run = runBackend(['probe', '--report', reportPath], keylessEnv)
    assert.equal(run.code, 0, describeRun('probe (keyless boot)', run))
    const report = readReport(reportPath)

    assert.deepEqual(
      report.failures,
      [],
      `probe reported liveness failures:\n${(report.failures ?? []).join('\n')}`,
    )

    const missing = REQUIRED_SERVICES.filter(name => report.services?.[name]?.live !== true)
    assert.deepEqual(
      missing,
      [],
      `required service(s) not live: ${missing.join(', ')} — report.services=${JSON.stringify(report.services)}`,
    )

    const notActive = REQUIRED_SERVICES.filter(name => report.services?.[name]?.fiberState !== 'active')
    assert.deepEqual(
      notActive,
      [],
      `service fiber(s) not ACTIVE: ${notActive.join(', ')} — report.services=${JSON.stringify(report.services)}`,
    )
  })

  test('v1 profile does not mount unadapted file/shell/sandbox or excluded capabilities', () => {
    const run = runBackend(['probe', '--report', reportPath], keylessEnv)
    assert.equal(run.code, 0, describeRun('probe (exclusion check)', run))
    const report = readReport(reportPath)
    const rowIds = new Set((report.rows ?? []).map(row => row.id))
    const mounted = FORBIDDEN_ROW_IDS.filter(id => rowIds.has(id))
    assert.deepEqual(
      mounted,
      [],
      `forbidden row(s) mounted in the v1 profile: ${mounted.join(', ')};`
      + ` mounted rows were ${JSON.stringify([...rowIds])}`,
    )
    // The probe reports the same check from inside the process; both must agree.
    assert.deepEqual(
      report.excluded?.found ?? [],
      [],
      `probe found excluded capabilities mounted: ${(report.excluded?.found ?? []).join(', ')}`,
    )
  })

  test('a requested turn without DEEPSEEK_API_KEY fails loudly, naming the missing configuration', () => {
    const run = runBackend(
      ['probe', '--turn', '--report', join(sharedHome, 'turn-missing-key.json')],
      keylessEnv,
    )
    assert.notEqual(run.code, 0, describeRun('probe --turn (missing key) should fail', run))
    const output = `${run.stdout}\n${run.stderr}`
    assert.ok(
      output.includes('DEEPSEEK_API_KEY'),
      `failure diagnostic must name the missing configuration DEEPSEEK_API_KEY; output was:\n${output}`,
    )
  })

  test('keyless startup without a turn succeeds and writes nothing outside the isolated home', () => {
    const run = runBackend(['probe', '--report', join(sharedHome, 'keyless.json')], keylessEnv)
    assert.equal(run.code, 0, describeRun('probe (keyless startup)', run))
    const report = readReport(join(sharedHome, 'keyless.json'))
    assert.equal(report.ok, true, `probe.ok must be true: ${JSON.stringify(report.failures)}`)

    const isolatedHome = report.dshHome
    assert.ok(
      typeof isolatedHome === 'string' && isolatedHome.startsWith(sharedHome),
      `dsh home ${isolatedHome} must live under the isolated OURFAIRY_HOME ${sharedHome}`,
    )

    // The startup itself must not create durable session files (no turn ran).
    const sessionsRoot = report.sessions?.root
    const files = sessionsRoot !== undefined && existsSync(sessionsRoot)
      ? readdirSync(sessionsRoot, { recursive: true }).filter(name => String(name).endsWith('.jsonl'))
      : []
    assert.deepEqual(files, [], `keyless boot without a turn must not write session logs; found ${files.join(', ')}`)

    // The isolated home must be a real directory tree, not the host home.
    assert.ok(statSync(isolatedHome).isDirectory(), `${isolatedHome} must be a directory`)
  })
})
