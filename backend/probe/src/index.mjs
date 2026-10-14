/**
 * OurFairy baseline liveness probe (test-only).
 *
 * Mounted above the product bundle layers by `backend/probe/overlay.patch.yml`.
 * Once the launcher commits readiness it:
 *
 *   1. waits for the Loader tree to settle,
 *   2. checks every service the v1 backend promises is live and its row ACTIVE,
 *   3. checks the deliberately excluded rows are not mounted,
 *   4. optionally drives one real model turn through the agent loop,
 *   5. writes a machine-readable report and requests a bounded process exit.
 *
 * It asserts observable composition facts, never "the Loader did not throw".
 *
 * Environment:
 *   OURFAIRY_PROBE_REPORT  absolute path of the JSON report to write
 *   OURFAIRY_PROBE_MODE    `boot` (default) or `turn`
 *   DSH_HOME               the isolated harness home the launcher pinned
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export const name = 'ourfairy-baseline-probe'

/** Services the v1 backend promises, with the row and package that must provide each. */
const SERVICE_ROWS = [
  ['sessions', 'session', '@deepseek-ai/dsh-session'],
  ['tools', 'tools', '@deepseek-ai/dsh-tools'],
  ['llm', 'llm', '@deepseek-ai/dsh-llm'],
  ['agents', 'agent', '@deepseek-ai/dsh-agent'],
  ['systemPrompt', 'system-prompt', '@deepseek-ai/dsh-system-prompt'],
  ['sessionProjections', 'session-projection', '@deepseek-ai/dsh-session-projection'],
  ['agentLoop', 'agent-loop', '@deepseek-ai/dsh-agent-loop'],
  ['sessionPersistence', 'session-persistence-jsonl', '@deepseek-ai/dsh-session-persistence-jsonl'],
  ['sessionQuery', 'session-query-sqlite', '@deepseek-ai/dsh-session-query-sqlite'],
  ['jobs', 'jobs-local', '@deepseek-ai/dsh-jobs-local'],
  ['attachments', 'attachment-local', '@deepseek-ai/dsh-attachment-local'],
]

/**
 * Rows the first version must not mount: file/shell/sandbox capabilities whose
 * permission adaptation has not landed, plus capabilities v1 excludes.
 */
const FORBIDDEN_ROWS = [
  'tool-fs', 'tool-fs-search', 'fs-sandbox', 'fs-observation-policy',
  'working-directory', 'tool-working-directory',
  'tool-bash', 'bash-sandbox', 'pwsh-sandbox', 'tool-pwsh',
  'sandbox', 'sandbox-policy', 'approval', 'permission', 'shell-env', 'subprocess',
  'skill', 'skill-filesystem', 'tool-skill',
  'goal', 'goal-round-driver', 'tool-goal', 'command-goal',
  'subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process',
  'tool-subagent', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent-fork',
  'otel', 'session-telemetry-otel',
  'web', 'web-search-deepseek', 'web-fetch-http', 'tool-web', 'mcp-resources',
  'plan-mode', 'workflow-ptc', 'tool-workflow', 'ptc-runtime',
]

const FIBER_STATES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

/** A configuration fact the requested run needs and the environment did not provide. */
class ProbeConfigError extends Error {}

function fiberStateName(entry) {
  const state = entry?.fiber?.state
  return typeof state === 'number' ? (FIBER_STATES[state] ?? `unknown(${state})`) : 'absent'
}

/** Every composed row, with the state that decides whether its service can be used. */
function collectRows(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return []
  const rows = []
  for (const entry of loader.entries()) {
    rows.push({
      id: entry.options?.id ?? null,
      name: entry.options?.name ?? null,
      disabled: entry.disabled === true,
      fiberState: fiberStateName(entry),
    })
  }
  return rows
}

/** Service liveness and the row/package that owns it; every miss names the row. */
function collectServices(ctx, rows) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const services = {}
  const failures = []
  for (const [service, rowId, packageName] of SERVICE_ROWS) {
    const value = ctx.get(service)
    const live = value !== undefined && value !== null
    const row = byId.get(rowId)
    services[service] = {
      live,
      expectedRow: rowId,
      expectedPackage: packageName,
      rowPresent: row !== undefined,
      fiberState: row?.fiberState ?? null,
      ...(row?.disabled === true ? { disabled: true } : {}),
    }
    if (!live) {
      failures.push(`service "${service}" is not live (expected row "${rowId}" = ${packageName})`)
    } else if (row === undefined) {
      failures.push(`service "${service}" is live but its row "${rowId}" (${packageName}) is not in the composed tree`)
    } else if (row.disabled) {
      failures.push(`service "${service}" is live but its row "${rowId}" is disabled`)
    } else if (row.fiberState !== 'active') {
      failures.push(`service "${service}" is registered but row "${rowId}" fiber is ${row.fiberState}, not active`)
    }
  }
  return { services, failures }
}

/**
 * Best-effort tool registry discovery. The authoritative tool catalog evidence
 * is the model request captured by the external model double; this section only
 * reports what the registry exposes to introspection and never claims an empty
 * catalog when it simply could not enumerate.
 */
function collectTools(ctx) {
  const tools = ctx.get('tools')
  if (tools === undefined) return { available: false, discovery: 'service-absent', names: null, count: null }
  for (const method of ['names', 'list', 'specs', 'describe', 'snapshot', 'all', 'entries']) {
    if (typeof tools[method] !== 'function') continue
    try {
      const result = tools[method]()
      if (!Array.isArray(result)) continue
      const names = [...new Set(result
        .map(item => (typeof item === 'string' ? item : item?.name))
        .filter(value => typeof value === 'string'))].sort()
      return { available: true, discovery: `method:${method}`, names, count: result.length }
    } catch {
      // Try the next candidate accessor.
    }
  }
  return { available: true, discovery: 'not-enumerable', names: null, count: null }
}

/** All `.jsonl` files under a root, relative and sorted. */
function listJsonlFiles(root) {
  if (root === undefined || !existsSync(root)) return []
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.jsonl')) found.push(relative(root, path))
    }
  }
  walk(root)
  return found.sort()
}

function assistantTextOf(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return undefined
  const text = content.filter(block => block?.type === 'text').map(block => block.text).join('')
  return text === '' ? undefined : text
}

/**
 * Drive one real model turn: create a session through the agent factory, send
 * one user message, wait for idle, and flush the durable log.
 */
async function runTurn(ctx, report) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (apiKey === undefined || apiKey === '') {
    throw new ProbeConfigError(
      'missing required configuration DEEPSEEK_API_KEY: the requested turn needs a model credential. '
      + 'Export DEEPSEEK_API_KEY (and DEEPSEEK_BASE_URL when driving the external model double) before starting the backend.',
    )
  }
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error('cannot run a turn: the "agents" service is not live')
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')

  const sessionId = process.env.OURFAIRY_PROBE_SESSION_ID ?? `ourfairy-baseline-${Date.now()}`
  const handle = await agents.create({ sessionId, meta: { cwd: process.cwd() } })
  const agent = handle.agent
  let output
  let events = 0
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    events += 1
    const text = assistantTextOf(event)
    if (text !== undefined) output = text
  })
  try {
    await agent.whenIdle()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'OurFairy baseline probe turn.' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    dispose()
  }
  const flushed = await ctx.sessions.flush(agent.session)
  report.model = {
    provider: 'deepseek-official',
    sessionId: String(agent.session.id),
    events,
    output: output ?? null,
    flushReturned: flushed === true,
  }
  if (output === undefined) {
    report.failures.push(
      'model turn produced no assistant text through the configured route;'
      + ' check the external model double (DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY) and the llm-deepseek route',
    )
  }
}

async function runProbe(ctx) {
  const report = {
    ok: false,
    probeVersion: 1,
    startedAt: new Date().toISOString(),
    dshHome: process.env.DSH_HOME ?? null,
    mode: process.env.OURFAIRY_PROBE_MODE ?? 'boot',
    rows: [],
    services: {},
    tools: {},
    excluded: { checked: FORBIDDEN_ROWS, found: [] },
    model: null,
    sessions: { root: null, files: [] },
    failures: [],
  }

  try {
    const loader = ctx.get('loader')
    if (loader === undefined) throw new Error('the Loader service is not live; nothing was composed')
    await loader.await()

    report.rows = collectRows(ctx)
    const services = collectServices(ctx, report.rows)
    report.services = services.services
    report.failures.push(...services.failures)
    report.tools = collectTools(ctx)
    const rowIds = new Set(report.rows.map(row => row.id))
    report.excluded.found = FORBIDDEN_ROWS.filter(id => rowIds.has(id))
    if (report.excluded.found.length > 0) {
      report.failures.push(
        `excluded capability row(s) are mounted in the v1 profile: ${report.excluded.found.join(', ')}`,
      )
    }

    const sessionsRoot = process.env.DSH_HOME === undefined ? undefined : join(process.env.DSH_HOME, 'sessions')
    report.sessions.root = sessionsRoot ?? null

    if (report.mode === 'turn') {
      await runTurn(ctx, report)
      report.sessions.files = listJsonlFiles(sessionsRoot)
      if (report.sessions.files.length === 0) {
        report.failures.push(
          `durable session log missing after the turn: no .jsonl file under ${sessionsRoot}`,
        )
      }
    } else {
      report.sessions.files = listJsonlFiles(sessionsRoot)
    }
  } catch (error) {
    report.failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  }

  report.ok = report.failures.length === 0
  report.finishedAt = new Date().toISOString()

  const reportPath = process.env.OURFAIRY_PROBE_REPORT
  if (reportPath !== undefined && reportPath !== '') {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  }

  const exitCode = report.ok ? 0 : (report.failures.some(line => line.includes('DEEPSEEK_API_KEY')) ? 3 : 1)
  if (!report.ok) {
    process.stderr.write(
      `ourfairy-baseline-probe: ${report.failures.length} failure(s)\n`
      + report.failures.map(line => `  - ${line}\n`).join(''),
    )
  } else {
    process.stdout.write(
      `ourfairy-baseline-probe: ok (${Object.keys(report.services).length} services live,`
      + ` ${report.rows.length} rows composed, mode ${report.mode})\n`,
    )
  }
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    process.exitCode = exitCode
    return
  }
  exit(exitCode)
}

/** Mount the probe and run it once readiness commits. */
export function apply(ctx) {
  const start = () => {
    void runProbe(ctx).catch((error) => {
      process.stderr.write(`ourfairy-baseline-probe: ${error instanceof Error ? error.stack : String(error)}\n`)
      const exit = ctx.get('appExit')
      if (exit === undefined) process.exitCode = 1
      else exit(1)
    })
  }
  const ready = ctx.get('appReady')
  if (ready !== undefined && typeof ready.onReady === 'function') ready.onReady(start)
  else setTimeout(start, 0)
}
