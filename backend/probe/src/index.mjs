/**
 * OurFairy baseline liveness probe (test-only), mounted above the product bundle
 * by `backend/probe/overlay.patch.yml`.
 *
 * Once the launcher commits readiness it waits for the Loader tree to settle,
 * checks every service the v1 backend promises is live and its row active,
 * reports the composed row ids, optionally drives one real model turn, and
 * writes a machine-readable report before requesting a bounded process exit.
 *
 * Environment:
 *   OURFAIRY_PROBE_REPORT  absolute path of the JSON report to write
 *   OURFAIRY_PROBE_MODE    `boot` (default), `turn`, or `hold`
 *   OURFAIRY_PROBE_HOLD_MS bounded hold in `hold` mode (0 = until a signal)
 *   DSH_HOME               the isolated harness home the launcher pinned
 *
 * `hold` keeps the real composition alive after a successful check so the
 * launcher's start/stop supervision can be exercised; it still exits non-zero
 * when a check fails, so a supervisor never mistakes a broken boot for ready.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { ownerOf } from '@ourfairy/dsh-identity/owner'

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
  ['settings', 'settings', '@deepseek-ai/dsh-settings'],
  ['configEditor', 'config-editor', '@deepseek-ai/dsh-config-editor'],
  ['identity', 'identity', '@ourfairy/dsh-identity'],
  ['agentDefaultModel', 'agent-default-model', '@deepseek-ai/dsh-agent-default-model'],
  ['ourfairyChat', 'chat', '@ourfairy/dsh-chat'],
  ['ourfairyGateway', 'gateway', '@ourfairy/dsh-gateway'],
  ['jobs', 'jobs-local', '@deepseek-ai/dsh-jobs-local'],
  ['attachments', 'attachment-local', '@deepseek-ai/dsh-attachment-local'],
  ['ourfairyAttachments', 'attachments', '@ourfairy/dsh-attachments'],
  ['ourfairySpaces', 'spaces', '@ourfairy/dsh-spaces'],
  ['fs', 'scoped-fs', '@ourfairy/dsh-spaces'],
  ['shell', 'scoped-bash', '@ourfairy/dsh-spaces'],
  ['sandbox', 'scoped-sandbox', '@ourfairy/dsh-spaces'],
  ['workingDirectory', 'scoped-directory', '@ourfairy/dsh-spaces'],
  ['sandboxPolicy', 'sandbox-policy', '@ourfairy/dsh-spaces/policy'],
]

const FIBER_STATES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']

/**
 * A required configuration fact the requested run needs and the environment did
 * not provide. Distinguished from a liveness failure so the process exit code
 * tells a supervisor which one it is (3 = configuration, 1 = composition).
 */
class ProbeConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProbeConfigError'
  }
}

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

/** The probe's own row: test machinery mounted above the bundle, not a product row. */
const PROBE_ROW_ID = 'ourfairy-baseline-probe'
const PROBE_PACKAGE = '@ourfairy/dsh-baseline-probe'

/**
 * Every product row the bundle mounts must be active.
 *
 * A row whose config the loader rejects (or whose `apply` throws) leaves its
 * fiber failed or waiting; reporting ready in that state would let a later
 * request discover the missing capability. Naming the row and package here is
 * what makes the configuration failure act on the boot instead. A row an
 * operator disabled through an overlay is a deliberate absence, not an
 * activation failure, so it is skipped.
 */
function collectInactiveProductRows(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return []
  const failures = []
  for (const entry of loader.entries()) {
    const name = entry.options?.name
    if (typeof name !== 'string' || !name.startsWith('@ourfairy/')) continue
    if (name === PROBE_PACKAGE || entry.options?.id === PROBE_ROW_ID) continue
    if (entry.disabled === true) continue
    const state = fiberStateName(entry)
    if (state !== 'active') {
      failures.push(`bundle product row "${entry.options?.id}" (${name}) is not active (fiber ${state})`)
    }
  }
  return failures
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
 * All durable session-log files under a root, relative and sorted.
 *
 * The JSONL persistence writes compressed logs by default, so the artifact on
 * disk is `session.v4.jsonl.zstd`; an uncompressed `.jsonl` appears when
 * compression is off. Both are durable session logs and both must be reported —
 * matching only `.jsonl` would report "no durable log" for a session that was
 * in fact saved.
 */
function listJsonlFiles(root) {
  if (root === undefined || !existsSync(root)) return []
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.jsonl(\.zstd)?$/.test(entry.name)) found.push(relative(root, path))
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

/** Where a reported selection came from, so a reader can tell it from a saved override. */
const MODEL_SELECTION_SOURCE = 'agentDefaultModel.currentSelection()'

/**
 * The shared model selection the composed `agentDefaultModel` row exposes.
 *
 * Read from the live service rather than parsed from the bundle patch or passed
 * in by the launcher: that row is the only initial declaration. The product
 * chat runtime reads the same service at each turn start, so a selection saved
 * through the gateway is what this returns once the running composition has
 * adopted it.
 */
function readAgentDefaultModel(ctx) {
  const service = ctx.get('agentDefaultModel')
  if (service === undefined || typeof service.currentSelection !== 'function') {
    throw new ProbeConfigError(
      'the "agentDefaultModel" service is not live: the probe reads the model selection from the'
      + ' composed agent-default-model row and cannot report or run a turn without it',
    )
  }
  const selection = service.currentSelection()
  if (typeof selection?.provider !== 'string' || selection.provider === ''
    || typeof selection?.model !== 'string' || selection.model === '') {
    throw new ProbeConfigError(
      `the "agentDefaultModel" service returned no usable selection: ${JSON.stringify(selection)}`,
    )
  }
  return selection
}

/** The selection fields every report carries, before any turn outcome is added. */
function selectionReport(selection) {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    selection: MODEL_SELECTION_SOURCE,
  }
}

/**
 * Drive one real model turn: create a session through the agent factory, send
 * one user message, wait for idle, and flush the durable log.
 */
async function runTurn(ctx, report) {
  const agents = ctx.get('agents')
  if (agents === undefined) throw new Error('cannot run a turn: the "agents" service is not live')
  const sessions = ctx.get('sessions')
  if (sessions === undefined) throw new Error('cannot run a turn: the "sessions" service is not live')
  // The composed selection is the authority, read at the start of this turn the
  // same way the product chat runtime reads it. Passing it explicitly is what
  // this probe needs because it creates its own Agent; there is no second
  // declaration to fall back to.
  const selection = readAgentDefaultModel(ctx)
  const { provider, model } = selection
  // The route's credential reference is the authority, not a hardcoded name:
  // resolve the live settings row and let the seam answer presence.
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings !== undefined && credentials !== undefined) {
    const rows = settings.describe()
    const ref = rows.find(row => row.ns === 'llm-pi-ai')?.value?.providers?.[provider]?.apiKeyEnv
      ?? rows.find(row => row.ns === 'llm-deepseek-api-key')?.value?.apiKeyEnv
    const hit = typeof ref === 'string' ? await credentials.resolve(ref).catch(() => undefined) : undefined
    if (typeof ref === 'string' && (hit?.value === undefined || hit.value.trim() === '')) {
      throw new ProbeConfigError(
        `missing required configuration ${ref}: the requested turn needs the credential reference its route`
        + ` "${provider}" declares. Export ${ref} or store it in the backend credential document before starting.`,
      )
    }
  }
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')

  const sessionId = process.env.OURFAIRY_PROBE_SESSION_ID ?? `ourfairy-baseline-${Date.now()}`
  const handle = await agents.create({
    sessionId,
    meta: { owner: ownerOf(1) },
    agentOptions: { provider, model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) },
  })
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
  const flushed = await sessions.flush(agent.session)
  report.model = {
    ...selectionReport(selection),
    sessionId: String(agent.session.id),
    events,
    output: output ?? null,
    flushReturned: flushed === true,
  }
  if (output === undefined) {
    report.failures.push(
      `model turn produced no assistant text through the configured route ${provider}/${model};`
      + ' check the model endpoint override, the route credential and the provider adapter',
    )
  }
}

/**
 * Keep the real composition alive until a stop signal (or a bounded interval).
 *
 * The dsh CLI returns from `runProfile` as soon as readiness commits: a profile
 * whose rows own no long-running work has nothing left to keep the event loop
 * alive, so the process would exit the instant it reported ready and a
 * supervisor would see the backend disappear. The hold therefore owns a ref'd
 * interval for its whole duration — that handle, not the signal listeners, is
 * what keeps the booted composition running until `stop`.
 */
function holdUntilSignal(ms) {
  return new Promise((resolve) => {
    const keepAlive = setInterval(() => {}, 1_000)
    let bounded
    const finish = () => {
      clearInterval(keepAlive)
      if (bounded !== undefined) clearTimeout(bounded)
      process.off('SIGTERM', finish)
      process.off('SIGINT', finish)
      resolve()
    }
    process.once('SIGTERM', finish)
    process.once('SIGINT', finish)
    if (Number.isFinite(ms) && ms > 0) bounded = setTimeout(finish, ms)
  })
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
    model: null,
    sessions: { root: null, files: [] },
    configurationFailure: false,
    failures: [],
  }
  let configurationFailure = false

  try {
    const loader = ctx.get('loader')
    if (loader === undefined) throw new Error('the Loader service is not live; nothing was composed')
    await loader.await()

    report.rows = collectRows(ctx)
    report.failures.push(...collectInactiveProductRows(ctx))
    const services = collectServices(ctx, report.rows)
    report.services = services.services
    report.failures.push(...services.failures)
    // Boot reports the composed selection too, so an external caller can assert
    // which initial model the bundle's row put into effect without running a turn.
    report.model = selectionReport(readAgentDefaultModel(ctx))
    // Direct provider calls have no authenticated session; cwd must never supply one.
    report.agentless = {}
    for (const [name, operation] of [
      ['file', () => ctx.get('fs').resolve(join(process.env.DSH_HOME, 'spaces', 'public'))],
      ['process', () => ctx.get('shell').execute(ctx.get('shell').resolve({ command: 'true' }))],
    ]) {
      try { await operation(); report.agentless[name] = 'ALLOWED'; report.failures.push(`agentless ${name} unexpectedly allowed`) }
      catch (error) { report.agentless[name] = error.code ?? error.message }
    }

    const sessionsRoot = process.env.DSH_HOME === undefined ? undefined : join(process.env.DSH_HOME, 'sessions')
    report.sessions.root = sessionsRoot ?? null

    if (report.mode === 'turn') {
      await runTurn(ctx, report)
      report.sessions.files = listJsonlFiles(sessionsRoot)
      if (report.sessions.files.length === 0) {
        report.failures.push(
          `durable session log missing after the turn: no session log (.jsonl or .jsonl.zstd) under ${sessionsRoot}`,
        )
      }
    } else {
      report.sessions.files = listJsonlFiles(sessionsRoot)
    }
  } catch (error) {
    if (error instanceof ProbeConfigError) configurationFailure = true
    report.failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  }

  report.configurationFailure = configurationFailure
  report.ok = report.failures.length === 0
  report.finishedAt = new Date().toISOString()

  // Publish the report BEFORE holding. The report is the readiness signal a
  // supervisor waits on (`start` polls it), so holding first would deadlock
  // every start until the hold expired, and a failed check would stay invisible
  // for the whole hold window instead of failing the start immediately.
  const reportPath = process.env.OURFAIRY_PROBE_REPORT
  if (reportPath !== undefined && reportPath !== '') {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  }

  if (!report.ok) {
    process.stderr.write(
      `ourfairy-baseline-probe: ${report.failures.length} failure(s)\n`
      + report.failures.map(line => `  - ${line}\n`).join(''),
    )
  }

  if (report.mode === 'hold' && report.ok) {
    process.stdout.write('ourfairy-baseline-probe: ready\n')
    await holdUntilSignal(Number(process.env.OURFAIRY_PROBE_HOLD_MS ?? 0))
  } else if (report.ok) {
    process.stdout.write(
      `ourfairy-baseline-probe: ok (${Object.keys(report.services).length} services live,`
      + ` ${report.rows.length} rows composed, mode ${report.mode})\n`,
    )
  }
  const exit = ctx.get('appExit')
  const exitCode = report.ok ? 0 : (configurationFailure ? 3 : 1)
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
