#!/usr/bin/env node
/**
 * Real-model acceptance for the Fairy memory increment (spec #240, ticket #248).
 *
 * This script boots the shipped product backend with the deployment's real
 * MiniMax route and drives it exactly like a user and the client do. It never
 * mounts a model double: the gateway read is checked to be
 * `minimax-cn / MiniMax-M3.1-Flash` on a real (non-loopback) base URL, every
 * main-session request and every maintenance-child request names that route in
 * its own durable session log, and a loopback `OURFAIRY_MINIMAX_BASE_URL` is
 * refused before any case runs.
 *
 * It is deliberately NOT part of `npm test` or CI. The spec separates this
 * semantic-quality sample from the deterministic model-double suites, and the
 * run costs real tokens and minutes.
 *
 * What it records, per case: the prompts sent, the Fairy's tool calls and
 * replies, the maintenance child's own tool calls and final text, the resulting
 * `memories`, `impressions` and `maintenance_state` rows, and each check's
 * pass/fail. A missing credential, a refused turn, or a case that could not run
 * is reported as a failure or `unexecuted`; nothing is upgraded into a pass.
 *
 * The maintenance sample lowers the trigger through the real
 * `/gateway/maintenance` route (5 closed turns, 3-hour decay) before the cases,
 * so each interval is deterministic without fabricating 15 turns of noise.
 *
 * The impression sample follows the product's read-only scope: the user has a
 * read route and no write route, and the Fairy replaces the impression through
 * its own `impression_read`/`impression_edit` tools in a session it owns. The
 * over-length refusal and the read-before-edit refusal are asserted
 * deterministically in `tests/memory-impression.test.mjs` — the same facts about
 * the same rules — so this real-model sample does not attempt a fragile
 * 8001-character tool call.
 *
 * Usage:
 *   set -a; . /home/eafen405/projects/MINIMAX_API_KEY.env; set +a
 *   export MINIMAX_CN_API_KEY="$MINIMAX_API_KEY"
 *   npm run acceptance:memory
 *   npm run acceptance:memory -- --plan
 *   npm run acceptance:memory -- --only remember-explicit,normal-private-switch
 *   npm run acceptance:memory -- --home /tmp/ourfairy-memory-acceptance --out /tmp/report.json
 *
 * `--plan` reads no credential, starts no backend and writes no file. Without
 * `--plan`, stdout is one JSON report and progress goes to stderr; the report
 * path is printed on stderr. `--keep` leaves the backend running for inspection.
 * Exit code 0 means every selected case passed and none was left unexecuted.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'
import { isCliEntry } from './cli-guard.ts'
import { repoRoot } from './combo.ts'

/** The administrator password this isolated acceptance home uses (not a deployment secret). */
const PHAETHON_PASSWORD = 'memory-acceptance-password'
/** The password every invited acceptance user uses. */
const USER_PASSWORD = 'memory-acceptance-user-password'
/** The closed-user-turn threshold the sample saves through the real gateway. */
const MAINTENANCE_TRIGGER_TURNS = 5
/** The decay interval the sample saves through the real gateway. */
const MAINTENANCE_DECAY_HOURS = 3
/** The only real route this sample accepts. */
const REAL_PROVIDER = 'minimax-cn'
const REAL_MODEL = 'MiniMax-M3.1-Flash'
/** The impression marker used to prove per-user injection. */
const IMPRESSION_MARKER = 'ALICE-IMPRESSION-MARKER-7f3a'

type JsonObject = Record<string, unknown>
type Answer = { status: number; json: JsonObject; text: string }
type ChatEvent = { seq: number; type: string; data: JsonObject }
type ChatMessage = { messageId: string; role: number; status: number; text: string }
type Projection = { cursor: number; replyStatus: number; error: unknown; events: ChatEvent[]; messages: ChatMessage[] }
type ToolCall = { callId: string; name: string; arguments: string; result?: string }
type TurnRecord = { text: string; reply: string; events: ChatEvent[]; toolCalls: ToolCall[]; endSeq: number; durationMs: number }
type Identity = { name: string; token: string; shortId: number }
type Backend = { home: string; port: number; logFile: string; dbPath: string; sessionsRoot: string }
type Runtime = Backend & { admin: Identity; alice: Identity; bob: Identity; turnTimeoutMs: number }
type MemoryRow = {
  id: number
  content: string
  is_private: number
  source_session: string
  created_at: number
  content_updated_at: number
}
type MaintenanceRow = {
  source_session: string
  watermark_seq: number
  cut_seq: number | null
  last_closed_at: number | null
  child_session: string | null
  status: number
  updated_at: number
}
type ImpressionRow = { short_id: number; content: string; created_at: number; updated_at: number; deleted_at: number | null }
type ChildRun = {
  sessionId: string
  provider: string
  model: string
  toolNames: string[]
  toolCalls: ToolCall[]
  material: string
  finalText: string
  turnEndReasons: string[]
}
type SessionLog = { header: JsonObject; events: ChatEvent[] }
type Check = { name: string; ok: boolean; detail: string }
type CaseStatus = 'passed' | 'failed' | 'unexecuted'
type CaseOutcome = { checks: Check[]; evidence: JsonObject }
type CaseResult = {
  id: string
  title: string
  status: CaseStatus
  startedAt: string
  finishedAt: string
  checks: Check[]
  evidence: JsonObject
  error?: string
}
type Shared = { preferenceSessionId: string | undefined; preferenceRowIds: number[] }
type CaseDefinition = { id: string; title: string; run: (runtime: Runtime, shared: Shared) => Promise<CaseOutcome> }
type Options = {
  home: string | undefined
  out: string | undefined
  only: string[]
  plan: boolean
  keep: boolean
  turnTimeoutMs: number
}

/** The cases in execution order; ids are the `--only` handles. */
const CASE_ORDER: CaseDefinition[] = [
  { id: 'remember-explicit', title: 'explicit "please remember" writes immediately', run: caseRememberExplicit },
  { id: 'normal-private-switch', title: 'memory_switch flips one memory without a copy', run: caseNormalPrivateSwitch },
  { id: 'supersede', title: 'a superseding fact updates the existing memory, not a duplicate', run: caseSupersede },
  { id: 'invalidate', title: 'an invalidated memory is deleted', run: caseInvalidate },
  { id: 'chit-chat-no-write', title: 'meaningless chit-chat writes no memory', run: caseChitChatNoWrite },
  { id: 'maintenance-skip', title: 'an interval with nothing worth keeping finishes with zero writes and advances the watermark', run: caseMaintenanceSkip },
  { id: 'volatile-observation', title: 'a volatile or uncertain observation is not stored as a durable fact', run: caseVolatileObservation },
  { id: 'passing-preference', title: 'a durable preference stated in passing is remembered once', run: casePassingPreference },
  { id: 'maintenance-no-rewrite', title: 'a later interval does not re-write what was already stored', run: caseMaintenanceNoRewrite },
  { id: 'impression', title: 'the Fairy replaces the impression through its own tools, the user write route is absent, and the injection stays owner-only', run: caseImpression },
  { id: 'cross-user-discretion', title: 'normal/private search discretion across users and per-user impressions', run: caseCrossUserDiscretion },
]

const MEMORY_TOOLS = new Set(['memory_add', 'memory_edit', 'memory_delete', 'memory_search', 'memory_switch'])
const MEMORY_WRITE_TOOLS = new Set(['memory_add', 'memory_edit', 'memory_delete', 'memory_switch'])
const PREFERENCE = /美式|不加糖|咖啡/

const delay = (ms: number): Promise<void> => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

function parse(argv: string[]): Options {
  const options: Options = { home: undefined, out: undefined, only: [], plan: false, keep: false, turnTimeoutMs: 240_000 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === '--home') {
      options.home = resolve(argv[index + 1] ?? fail('--home needs a directory'))
      index += 1
    } else if (arg === '--out') {
      options.out = resolve(argv[index + 1] ?? fail('--out needs a file'))
      index += 1
    } else if (arg === '--only') {
      const value = argv[index + 1] ?? fail('--only needs one or more case ids')
      options.only.push(...value.split(',').map(entry => entry.trim()).filter(Boolean))
      index += 1
    } else if (arg === '--turn-timeout') {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value <= 0) fail('--turn-timeout needs positive milliseconds')
      options.turnTimeoutMs = value
      index += 1
    } else if (arg === '--plan') {
      options.plan = true
    } else if (arg === '--keep') {
      options.keep = true
    } else {
      fail(`unknown argument ${arg}`)
    }
  }
  const known = new Set(CASE_ORDER.map(definition => definition.id))
  for (const id of options.only) if (!known.has(id)) fail(`unknown case id ${id}; known ids: ${[...known].join(', ')}`)
  return options
}

function fail(message: string): never {
  throw new Error(message)
}

function record(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function blocksText(content: unknown): string {
  if (typeof content === 'string') return content
  return array(content).map(block => string(record(block)?.text) ?? '').join('')
}

function eventOf(value: unknown): ChatEvent | undefined {
  const event = record(value)
  const seq = number(event?.seq)
  const type = string(event?.type)
  if (seq === undefined || type === undefined) return undefined
  return { seq, type, data: record(event?.data) ?? {} }
}

function messageOf(value: unknown): ChatMessage | undefined {
  const message = record(value)
  const messageId = string(message?.messageId)
  const role = number(message?.role)
  const status = number(message?.status)
  if (messageId === undefined || role === undefined || status === undefined) return undefined
  return { messageId, role, status, text: string(message?.text) ?? '' }
}

function projectionOf(answer: Answer): Projection {
  const projection = record(answer.json.projection)
  return {
    cursor: number(projection?.cursor) ?? -1,
    replyStatus: number(projection?.replyStatus) ?? 0,
    error: projection?.error,
    events: array(projection?.events).map(eventOf).filter((event): event is ChatEvent => event !== undefined),
    messages: array(projection?.messages).map(messageOf).filter((message): message is ChatMessage => message !== undefined),
  }
}

function toolCallsOf(events: readonly ChatEvent[]): ToolCall[] {
  const results = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const message = record(event.data.message)
    const callId = string(message?.toolCallId)
    if (callId !== undefined) results.set(callId, blocksText(message?.content))
  }
  const calls: ToolCall[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const callId = string(event.data.callId)
    const name = string(event.data.name)
    if (callId === undefined || name === undefined) continue
    const result = results.get(callId)
    calls.push(result === undefined
      ? { callId, name, arguments: string(event.data.arguments) ?? '' }
      : { callId, name, arguments: string(event.data.arguments) ?? '', result })
  }
  return calls
}

function argumentsOf(call: ToolCall | undefined): JsonObject | undefined {
  if (call === undefined) return undefined
  try {
    const value: unknown = JSON.parse(call.arguments)
    return record(value)
  } catch {
    return undefined
  }
}

function searchReport(call: ToolCall | undefined): JsonObject | undefined {
  if (call?.result === undefined) return undefined
  try {
    const value: unknown = JSON.parse(call.result)
    return record(value)
  } catch {
    return undefined
  }
}

function errorCode(answer: Answer): string | undefined {
  return string(record(answer.json.error)?.code)
}

function request(port: number, path: string, { token, body }: { token?: string; body?: unknown } = {}): Promise<Answer> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const headers: Record<string, string> = { host: `127.0.0.1:${port}` }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  if (payload !== undefined) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(payload.byteLength)
  }
  return new Promise((resolvePromise, reject) => {
    const call = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers, agent: false }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json: JsonObject = {}
        try {
          const parsed: unknown = JSON.parse(text)
          const object = record(parsed)
          if (object !== undefined) json = object
        } catch {
          // A non-JSON answer stays an empty object; the status and text record it.
        }
        resolvePromise({ status: response.statusCode ?? 0, json, text })
      })
    })
    call.on('error', reject)
    if (payload !== undefined) call.write(payload)
    call.end()
  })
}

async function readChat(runtime: Runtime, identity: Identity, sessionId: string): Promise<Projection> {
  const answer = await request(runtime.port, '/chat/read', { token: identity.token, body: { sessionId, maxEvents: 256 } })
  if (answer.status !== 200) throw new Error(`/chat/read answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  return projectionOf(answer)
}

async function sendTurn(runtime: Runtime, identity: Identity, sessionId: string, text: string): Promise<TurnRecord> {
  const before = await readChat(runtime, identity, sessionId)
  const beforeIds = new Set(before.messages.map(message => message.messageId))
  const beforeCursor = before.cursor
  const sent = await request(runtime.port, '/chat/send', {
    token: identity.token,
    body: { sessionId, requestId: `memory-acceptance-${Date.now()}-${Math.random().toString(16).slice(2)}`, text },
  })
  if (sent.status !== 200) throw new Error(`/chat/send answered ${sent.status}: ${sent.text.slice(0, 500)}`)
  const started = Date.now()
  const deadline = started + runtime.turnTimeoutMs
  let last: Projection | undefined
  while (Date.now() < deadline) {
    const projection = await readChat(runtime, identity, sessionId)
    last = projection
    if (projection.error !== undefined && projection.error !== null) {
      throw new Error(`the turn failed: ${JSON.stringify(projection.error)}`)
    }
    const endings = projection.events.filter(event => event.type === 'turn/end' && event.seq > beforeCursor)
    if (projection.replyStatus === 0 && endings.length > 0) {
      const events = projection.events.filter(event => event.seq > beforeCursor)
      const replies = projection.messages.filter(message => message.role === 2 && message.status === 2 && !beforeIds.has(message.messageId))
      const ending = endings.at(-1)
      return {
        text,
        reply: replies.map(message => message.text).join('\n'),
        events,
        toolCalls: toolCallsOf(events),
        endSeq: ending?.seq ?? beforeCursor,
        durationMs: Date.now() - started,
      }
    }
    await delay(500)
  }
  throw new Error(`the turn did not settle within ${String(runtime.turnTimeoutMs)}ms; last replyStatus ${String(last?.replyStatus)}`)
}

async function newSession(runtime: Runtime, identity: Identity): Promise<string> {
  const answer = await request(runtime.port, '/sessions/create', { token: identity.token, body: {} })
  if (answer.status !== 200) throw new Error(`/sessions/create answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  const session = record(answer.json.session)
  const id = string(session?.id)
  if (id === undefined) throw new Error(`/sessions/create returned no session: ${answer.text.slice(0, 500)}`)
  return id
}

async function signIn(runtime: Pick<Runtime, 'port'>, name: string, password: string): Promise<Identity> {
  const answer = await request(runtime.port, '/identity/sign-in', { body: { name, password } })
  if (answer.status !== 200) throw new Error(`sign-in for ${name} answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  return identityOf(answer, name)
}

async function registerUser(runtime: Pick<Runtime, 'port'>, admin: Identity, name: string): Promise<Identity> {
  const invite = await request(runtime.port, '/identity/invite', { token: admin.token, body: {} })
  if (invite.status !== 200) throw new Error(`invite for ${name} answered ${invite.status}: ${invite.text.slice(0, 500)}`)
  const code = string(record(invite.json.invite)?.code)
  if (code === undefined) throw new Error('the invite answer carried no code')
  const registered = await request(runtime.port, '/identity/register', { body: { inviteCode: code, name, password: USER_PASSWORD } })
  if (registered.status !== 200) throw new Error(`registration for ${name} answered ${registered.status}: ${registered.text.slice(0, 500)}`)
  return identityOf(registered, name)
}

function identityOf(answer: Answer, name: string): Identity {
  const token = string(answer.json.token)
  const shortId = number(record(answer.json.user)?.shortId)
  if (token === undefined || shortId === undefined) throw new Error(`identity answer has no token/shortId: ${answer.text.slice(0, 500)}`)
  return { name, token, shortId }
}

function startBackend(home: string): Backend {
  const started = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ourfairy-backend.ts'), 'start', '--json'], {
    cwd: repoRoot,
    env: { ...process.env, OURFAIRY_HOME: home, OURFAIRY_PORT: '0', OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD },
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (started.status !== 0) {
    throw new Error(`backend start failed (${String(started.status)}):\n${started.stdout}\n${started.stderr}`)
  }
  const summary = JSON.parse(started.stdout) as { listeningPorts?: unknown; logFile?: unknown }
  const port = number(array(summary.listeningPorts)[0])
  const logFile = string(summary.logFile)
  if (port === undefined || logFile === undefined) throw new Error(`backend start reported no port/log: ${started.stdout}`)
  return {
    home,
    port,
    logFile,
    dbPath: join(home, 'dsh-home', 'memory', 'memory.sqlite'),
    sessionsRoot: join(home, 'dsh-home', 'sessions'),
  }
}

function stopBackend(home: string): void {
  spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ourfairy-backend.ts'), 'stop', '--json'], {
    cwd: repoRoot,
    env: { ...process.env, OURFAIRY_HOME: home },
    encoding: 'utf8',
    timeout: 120_000,
  })
}

async function gatewayRead(runtime: Runtime): Promise<JsonObject> {
  const answer = await request(runtime.port, '/gateway/read', { token: runtime.admin.token, body: {} })
  if (answer.status !== 200) throw new Error(`/gateway/read answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  const gateway = record(answer.json.gateway)
  if (gateway === undefined) throw new Error(`/gateway/read returned no gateway: ${answer.text.slice(0, 500)}`)
  return gateway
}

/** Refuse a non-MiniMax selection or a loopback base URL before any case runs. */
function assertRealRoute(gateway: JsonObject): { provider: string; model: string; baseURL: string; credentialSource: string } {
  const selection = record(gateway.selection)
  const provider = string(selection?.provider) ?? ''
  const model = string(selection?.model) ?? ''
  if (provider !== REAL_PROVIDER || model !== REAL_MODEL) {
    fail(`the shared selection is ${provider}/${model}; this acceptance requires ${REAL_PROVIDER}/${REAL_MODEL}`)
  }
  const route = array(gateway.routes).map(record).find(entry => string(entry?.provider) === provider)
  const baseURL = string(route?.baseURL) ?? ''
  if (!baseURL.startsWith('https://') || /(^https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])/i.test(baseURL)) {
    fail(`the MiniMax route base URL is ${baseURL || '(missing)'}; this acceptance requires the real provider, not a model double`)
  }
  const credential = record(route?.credential)
  if (credential?.configured !== true) fail('the MiniMax credential is not configured for the running backend')
  return { provider, model, baseURL, credentialSource: string(credential.source) ?? 'unknown' }
}

function memoryRows(runtime: Runtime): MemoryRow[] {
  const database = new DatabaseSync(runtime.dbPath)
  try {
    return database.prepare('SELECT id, content, is_private, source_session, created_at, content_updated_at FROM memories ORDER BY id')
      .all() as unknown as MemoryRow[]
  } finally {
    database.close()
  }
}

function maintenanceRow(runtime: Runtime, sessionId: string): MaintenanceRow | undefined {
  const database = new DatabaseSync(runtime.dbPath)
  try {
    return database.prepare('SELECT * FROM maintenance_state WHERE source_session = ?')
      .get(sessionId) as unknown as MaintenanceRow | undefined
  } finally {
    database.close()
  }
}

function impressionRow(runtime: Runtime, shortId: number): ImpressionRow | undefined {
  const database = new DatabaseSync(runtime.dbPath)
  try {
    return database.prepare('SELECT * FROM impressions WHERE short_id = ?')
      .get(shortId) as unknown as ImpressionRow | undefined
  } finally {
    database.close()
  }
}

/** One complete Zstandard frame range in a concatenated session log. */
type FrameRange = { start: number; end: number }

/**
 * Structurally scan a concatenated Zstandard session log.
 *
 * The dsh writer stores one complete frame per event batch; Node's one-shot
 * zstd helper decodes only the first frame, so the acceptance reads the same
 * container the dsh reader reads. A torn final frame means the log is still
 * being written and the caller retries.
 */
function scanZstdFrames(buffer: Buffer): { frames: FrameRange[]; tornStart: number | undefined } {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== 0xFD2FB528) throw new Error(`invalid zstd frame magic at byte ${String(offset)}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error(`reserved zstd frame-header bit at byte ${String(offset - 1)}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error(`reserved zstd block type at byte ${String(offset - 3)}`)
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames, tornStart: undefined }
}

function findSessionLogFile(root: string, sessionId: string): string | undefined {
  const pending: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }]
  while (pending.length > 0) {
    const entry = pending.pop()!
    let children
    try {
      children = readdirSync(entry.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      if (!child.isDirectory()) continue
      if (child.name === sessionId) {
        for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
          const file = join(entry.dir, child.name, name)
          if (existsSync(file)) return file
        }
      }
      if (entry.depth < 2) pending.push({ dir: join(entry.dir, child.name), depth: entry.depth + 1 })
    }
  }
  return undefined
}

function decompressSessionLog(file: string, bytes: Buffer): string | undefined {
  if (!file.endsWith('.zstd')) return bytes.toString('utf8')
  const { frames, tornStart } = scanZstdFrames(bytes)
  if (tornStart !== undefined) return undefined
  return frames.map(frame => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8')).join('')
}

function readSessionLog(root: string, sessionId: string): SessionLog | undefined {
  const file = findSessionLogFile(root, sessionId)
  if (file === undefined) return undefined
  let text: string | undefined
  try {
    text = decompressSessionLog(file, readFileSync(file))
  } catch {
    return undefined
  }
  if (text === undefined) return undefined
  const header: JsonObject = {}
  const events: ChatEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return undefined
    }
    const object = record(value)
    if (object === undefined) continue
    const type = string(object.type)
    if (type === undefined) continue
    if (type === 'session') {
      Object.assign(header, object)
      continue
    }
    const event = eventOf(object)
    if (event !== undefined) events.push(event)
  }
  return Object.keys(header).length === 0 ? undefined : { header, events }
}

function childRunOf(sessionId: string, log: SessionLog): ChildRun {
  let provider = ''
  let model = ''
  let toolNames: string[] = []
  for (const event of log.events) {
    if (event.type !== 'request/header') continue
    const header = record(event.data.header)
    const config = record(header?.config)
    provider = string(config?.provider) ?? ''
    model = string(config?.model) ?? ''
    toolNames = array(header?.tools)
      .map(tool => string(record(tool)?.name))
      .filter((name): name is string => name !== undefined)
    break
  }
  const materialEvent = log.events.find(event => event.type === 'user/message' && blocksText(event.data.content).startsWith('维护材料：'))
  const assistantTexts = log.events
    .filter(event => event.type === 'assistant/message')
    .map(event => blocksText(record(event.data.message)?.content))
    .filter(text => text.trim() !== '')
  return {
    sessionId,
    provider,
    model,
    toolNames,
    toolCalls: toolCallsOf(log.events),
    material: materialEvent === undefined ? '' : blocksText(materialEvent.data.content),
    finalText: assistantTexts.at(-1) ?? '',
    turnEndReasons: log.events
      .filter(event => event.type === 'turn/end')
      .map(event => string(record(event.data.reason)?.kind) ?? '')
      .filter(reason => reason !== ''),
  }
}

async function readChildRun(runtime: Runtime, sessionId: string): Promise<ChildRun | undefined> {
  const log = readSessionLog(runtime.sessionsRoot, sessionId)
  return log === undefined ? undefined : childRunOf(sessionId, log)
}

async function waitForChildRun(runtime: Runtime, sessionId: string, timeoutMs = 15_000): Promise<ChildRun> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await readChildRun(runtime, sessionId)
    if (run !== undefined && run.turnEndReasons.length > 0) return run
    await delay(250)
  }
  throw new Error(`the maintenance child ${sessionId} has no readable completed log`)
}

async function waitForMaintenance(runtime: Runtime, sessionId: string, cutSeq: number, timeoutMs = 300_000): Promise<MaintenanceRow> {
  const deadline = Date.now() + timeoutMs
  let last: MaintenanceRow | undefined
  while (Date.now() < deadline) {
    last = maintenanceRow(runtime, sessionId)
    if (last !== undefined && last.status === 0 && last.watermark_seq >= cutSeq) return last
    await delay(500)
  }
  throw new Error(`maintenance for ${sessionId} did not complete; last state ${JSON.stringify(last)}`)
}

async function runMaintenance(runtime: Runtime, sessionId: string, cutSeq: number): Promise<{ row: MaintenanceRow; child: ChildRun }> {
  const row = await waitForMaintenance(runtime, sessionId, cutSeq)
  if (row.child_session === null) throw new Error(`maintenance for ${sessionId} completed without a child session`)
  return { row, child: await waitForChildRun(runtime, row.child_session) }
}

function mark(checks: Check[], name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

function writeCalls(calls: readonly ToolCall[]): ToolCall[] {
  return calls.filter(call => MEMORY_WRITE_TOOLS.has(call.name))
}

function rowsFromSession(runtime: Runtime, sessionId: string): MemoryRow[] {
  return memoryRows(runtime).filter(row => row.source_session === sessionId)
}

function preferenceRows(rows: readonly MemoryRow[]): MemoryRow[] {
  return rows.filter(row => PREFERENCE.test(row.content))
}

function eventTextText(turn: TurnRecord): string {
  return turn.events.map(event => event.type).join(',')
}

function excerpt(text: string, limit = 4000): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function callSummary(calls: readonly ToolCall[]): JsonObject[] {
  return calls.map(call => ({
    name: call.name,
    arguments: call.arguments,
    ...(call.result === undefined ? {} : { result: excerpt(call.result, 1200) }),
  }))
}

function rowSummary(rows: readonly MemoryRow[]): JsonObject[] {
  return rows.map(row => ({
    id: row.id,
    content: row.content,
    is_private: row.is_private,
    source_session: row.source_session,
    content_updated_at: row.content_updated_at,
  }))
}

async function impressionRead(runtime: Runtime, token: string): Promise<JsonObject> {
  const answer = await request(runtime.port, '/impression/read', { token, body: {} })
  if (answer.status !== 200) throw new Error(`/impression/read answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  const impression = record(answer.json.impression)
  if (impression === undefined) throw new Error(`/impression/read returned no impression: ${answer.text.slice(0, 500)}`)
  return impression
}

function impressionContent(impression: JsonObject): string {
  return string(impression.content) ?? ''
}

/**
 * Whether these tool calls include an impression edit the tool accepted.
 *
 * A refused edit answers with the product's error code instead of the tool's
 * `{ ok }` value, so the acceptance tells "the Fairy asked to edit" apart from
 * "the Fairy edited".
 */
function successfulImpressionEdit(calls: readonly ToolCall[]): boolean {
  return calls.some(call => call.name === 'impression_edit' && (call.result ?? '').includes('"ok":true'))
}

async function systemPromptOf(runtime: Runtime, sessionId: string): Promise<string> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const log = readSessionLog(runtime.sessionsRoot, sessionId)
    if (log !== undefined) {
      const messages = log.events.filter(event => event.type === 'system/message')
      const last = messages.at(-1)
      if (last !== undefined) {
        const text = blocksText(record(last.data.message)?.content)
        if (text !== '') return text
      }
    }
    await delay(250)
  }
  throw new Error(`session ${sessionId} has no readable system prompt`)
}

// ── cases ──────────────────────────────────────────────────────────────────

async function caseRememberExplicit(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  const before = new Set(memoryRows(runtime).map(row => row.id))
  const turn = await sendTurn(runtime, runtime.alice, session, '请记住：我的猫叫团子，是一只橘猫。以后我提到猫，指的就是团子。')
  const added = memoryRows(runtime).filter(row => !before.has(row.id))
  const add = turn.toolCalls.find(call => call.name === 'memory_add')
  const addArguments = argumentsOf(add)
  const content = string(addArguments?.content) ?? ''
  mark(checks, 'the Fairy calls memory_add in the same turn', add !== undefined, callSummary(turn.toolCalls).map(call => call.name).join(','))
  mark(checks, 'the add names the explicit fact', content.includes('团子'), content)
  mark(checks, 'a normal-layer memory is stored', added.some(row => row.content.includes('团子') && row.is_private === 0), JSON.stringify(rowSummary(added)))
  mark(checks, 'the memory source is this request session', added.some(row => row.content.includes('团子') && row.source_session === session), session)
  return {
    checks,
    evidence: {
      session,
      prompt: turn.text,
      reply: turn.reply,
      toolCalls: callSummary(turn.toolCalls),
      addedRows: rowSummary(added),
      eventTypes: eventTextText(turn),
    },
  }
}

async function caseNormalPrivateSwitch(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  const first = await sendTurn(runtime, runtime.alice, session, '请记住：我大学时的绰号是阿岚。')
  const row = rowsFromSession(runtime, session).find(entry => entry.content.includes('阿岚'))
  if (row === undefined) {
    mark(checks, 'a normal memory named 阿岚 exists before the switch', false, JSON.stringify(rowSummary(rowsFromSession(runtime, session))))
    return { checks, evidence: { session, prompt: first.text, reply: first.reply, toolCalls: callSummary(first.toolCalls) } }
  }
  const second = await sendTurn(runtime, runtime.alice, session, '把阿岚这条记忆改成私密记忆，只有我明确问起时才查。')
  const after = memoryRows(runtime).find(entry => entry.id === row.id)
  const switchCall = second.toolCalls.find(call => call.name === 'memory_switch')
  mark(checks, 'the Fairy uses memory_switch', switchCall !== undefined, callSummary(second.toolCalls).map(call => call.name).join(','))
  mark(checks, 'the switch names the same memory number', number(argumentsOf(switchCall)?.id) === row.id, JSON.stringify(argumentsOf(switchCall)))
  mark(checks, 'the memory is private afterwards', after?.is_private === 1, JSON.stringify(after))
  mark(checks, 'the switch keeps the content', after?.content === row.content, after?.content ?? 'missing')
  mark(checks, 'the switch keeps the content-updated time', after?.content_updated_at === row.content_updated_at, `${String(row.content_updated_at)} -> ${String(after?.content_updated_at)}`)
  mark(checks, 'the switch does not create a copy', memoryRows(runtime).filter(entry => entry.content.includes('阿岚')).length === 1, JSON.stringify(rowSummary(memoryRows(runtime).filter(entry => entry.content.includes('阿岚')))))
  return {
    checks,
    evidence: {
      session,
      firstPrompt: first.text,
      firstReply: first.reply,
      switchPrompt: second.text,
      switchReply: second.reply,
      toolCalls: callSummary(second.toolCalls),
      before: rowSummary([row]),
      after: after === undefined ? null : rowSummary([after]),
    },
  }
}

async function caseSupersede(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const oldSession = await newSession(runtime, runtime.alice)
  const oldTurn = await sendTurn(runtime, runtime.alice, oldSession, '请记住：我的手机尾号是 3721。')
  const oldRow = rowsFromSession(runtime, oldSession).find(row => row.content.includes('3721'))
  mark(checks, 'the earlier fact is stored before the update', oldRow !== undefined, JSON.stringify(rowSummary(rowsFromSession(runtime, oldSession))))
  const session = await newSession(runtime, runtime.alice)
  const prompts = [
    '我的手机尾号换了，现在是 8150。',
    '对了，旧的那个 3721 别再记了。',
    '最近换号码的地方挺多的。',
    '你帮我确认一下现在记的是哪个。',
    '好，就这样。',
  ]
  const turns: TurnRecord[] = []
  for (const text of prompts) turns.push(await sendTurn(runtime, runtime.alice, session, text))
  const last = turns.at(-1)!
  const maintenance = await runMaintenance(runtime, session, last.endSeq)
  const relevant = memoryRows(runtime).filter(row => row.content.includes('3721') || row.content.includes('8150') || row.content.includes('尾号'))
  // The interval may legitimately produce only the updated fact. Any other row
  // it writes — a meta-memory about the user's delete/edit request, a session
  // summary, a todo — is noise even when it mentions the new number.
  const intervalRows = memoryRows(runtime).filter(row => row.source_session === session)
  const current = relevant.filter(row => row.content.includes('8150'))
  const staleOnly = relevant.filter(row => row.content.includes('3721') && !row.content.includes('8150'))
  const editedInPlace = oldRow !== undefined && current.some(row => row.id === oldRow.id)
  const deletedAndReplaced = oldRow !== undefined && current.some(row => row.id !== oldRow.id) && !memoryRows(runtime).some(row => row.id === oldRow.id)
  mark(checks, 'the current number is stored', current.length >= 1, JSON.stringify(rowSummary(relevant)))
  mark(checks, 'the current fact has one row, not a duplicate', current.length === 1, JSON.stringify(rowSummary(current)))
  mark(checks, 'the interval writes only the updated fact, not a meta or session row', intervalRows.length === 1 && intervalRows[0]?.content.includes('8150') === true, JSON.stringify(rowSummary(intervalRows)))
  mark(checks, 'no row still asserts only the superseded number', staleOnly.length === 0, JSON.stringify(rowSummary(staleOnly)))
  mark(checks, 'the update edited the earlier row or replaced it', editedInPlace || deletedAndReplaced, `edited=${String(editedInPlace)} replaced=${String(deletedAndReplaced)}`)
  mark(checks, 'the maintenance interval advanced', maintenance.row.watermark_seq >= last.endSeq, JSON.stringify(maintenance.row))
  const childWrites = writeCalls(maintenance.child.toolCalls)
  const mainWrites = writeCalls(turns.flatMap(turn => turn.toolCalls))
  return {
    checks,
    evidence: {
      oldSession,
      oldPrompt: oldTurn.text,
      oldRow: oldRow === undefined ? null : rowSummary([oldRow]),
      session,
      prompts,
      replies: turns.map(turn => turn.reply),
      mainWrites: callSummary(mainWrites),
      toolCalls: callSummary(turns.flatMap(turn => turn.toolCalls)),
      maintenance: {
        row: maintenance.row,
        childSession: maintenance.child.sessionId,
        childModel: `${maintenance.child.provider}/${maintenance.child.model}`,
        childToolNames: maintenance.child.toolNames,
        childWrites: callSummary(childWrites),
        childFinalText: maintenance.child.finalText,
        material: excerpt(maintenance.child.material),
      },
      relevantRows: rowSummary(relevant),
      currentRows: rowSummary(current),
      intervalRows: rowSummary(intervalRows),
      staleRows: rowSummary(staleOnly),
    },
  }
}

async function caseInvalidate(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  const first = await sendTurn(runtime, runtime.alice, session, '请记住：我的旧手机号是 13800000000，已经停用了。')
  const row = rowsFromSession(runtime, session).find(entry => entry.content.includes('13800000000'))
  mark(checks, 'the memory to invalidate exists', row !== undefined, JSON.stringify(rowSummary(rowsFromSession(runtime, session))))
  if (row === undefined) return { checks, evidence: { session, prompt: first.text, reply: first.reply, toolCalls: callSummary(first.toolCalls) } }
  const second = await sendTurn(runtime, runtime.alice, session, '那条旧手机号的记忆已经没用了，帮我删掉。')
  const deleteCall = second.toolCalls.find(call => call.name === 'memory_delete')
  const remaining = memoryRows(runtime).find(entry => entry.id === row.id)
  mark(checks, 'the Fairy calls memory_delete', deleteCall !== undefined, callSummary(second.toolCalls).map(call => call.name).join(','))
  mark(checks, 'the delete names the invalidated memory number', number(argumentsOf(deleteCall)?.id) === row.id, JSON.stringify(argumentsOf(deleteCall)))
  mark(checks, 'the row is physically removed', remaining === undefined, JSON.stringify(rowSummary(memoryRows(runtime).filter(entry => entry.id === row.id))))
  mark(checks, 'no row still carries the invalidated number', !memoryRows(runtime).some(entry => entry.content.includes('13800000000')), JSON.stringify(rowSummary(memoryRows(runtime).filter(entry => entry.content.includes('13800000000')))))

  // The row being gone from the database is not the same claim as the product
  // no longer returning it: the next real search is what the Fairy acts on.
  const third = await sendTurn(runtime, runtime.alice, session,
    '再用 memory_search 查一次 13800000000，看看还有没有这条记忆；请原样报告检索结果。')
  const laterSearches = third.toolCalls.filter(call => call.name === 'memory_search'
    && (string(argumentsOf(call)?.query) ?? '').includes('13800000000'))
  const laterSearch = laterSearches.at(-1)
  const laterReport = searchReport(laterSearch)
  mark(checks, 'a later search runs against the removed number', laterSearch !== undefined,
    callSummary(third.toolCalls).map(call => call.name).join(','))
  mark(checks, 'the later search no longer retrieves the invalidated memory', number(laterReport?.matched) === 0,
    JSON.stringify(laterReport ?? null))
  return {
    checks,
    evidence: {
      session,
      firstPrompt: first.text,
      firstReply: first.reply,
      deletePrompt: second.text,
      deleteReply: second.reply,
      toolCalls: callSummary(second.toolCalls),
      deletedRow: rowSummary([row]),
      remainingRows: rowSummary(memoryRows(runtime).filter(entry => entry.id === row.id || entry.content.includes('13800000000'))),
      laterSearchPrompt: third.text,
      laterSearchReply: third.reply,
      laterSearchCalls: callSummary(laterSearches),
      laterSearchReport: laterReport ?? null,
    },
  }
}

async function caseChitChatNoWrite(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  const texts = ['哈哈，今天没什么事，就是随便说说话。', '嗯，那就这样，晚安。']
  const turns: TurnRecord[] = []
  for (const text of texts) turns.push(await sendTurn(runtime, runtime.alice, session, text))
  const writes = writeCalls(turns.flatMap(turn => turn.toolCalls))
  const rows = rowsFromSession(runtime, session)
  mark(checks, 'meaningless chit-chat triggers no memory write', writes.length === 0, JSON.stringify(callSummary(writes)))
  mark(checks, 'no memory row is created for it', rows.length === 0, JSON.stringify(rowSummary(rows)))
  return {
    checks,
    evidence: {
      session,
      prompts: texts,
      replies: turns.map(turn => turn.reply),
      memoryToolCalls: callSummary(turns.flatMap(turn => turn.toolCalls).filter(call => MEMORY_TOOLS.has(call.name))),
      writes: callSummary(writes),
      rows: rowSummary(rows),
    },
  }
}

async function caseMaintenanceSkip(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  const texts = ['在吗？', '嗯。', '好的。', '哈哈。', '晚安。']
  const turns: TurnRecord[] = []
  for (const text of texts) turns.push(await sendTurn(runtime, runtime.alice, session, text))
  const last = turns.at(-1)!
  const maintenance = await runMaintenance(runtime, session, last.endSeq)
  const mainWrites = writeCalls(turns.flatMap(turn => turn.toolCalls))
  const childWrites = writeCalls(maintenance.child.toolCalls)
  const rows = rowsFromSession(runtime, session)
  mark(checks, 'the maintenance interval completes', maintenance.row.status === 0 && maintenance.row.watermark_seq >= last.endSeq, JSON.stringify(maintenance.row))
  mark(checks, 'the interval advances the watermark even with zero writes', maintenance.row.watermark_seq >= last.endSeq, `${String(maintenance.row.watermark_seq)} >= ${String(last.endSeq)}`)
  mark(checks, 'the child writes nothing', childWrites.length === 0, JSON.stringify(callSummary(childWrites)))
  mark(checks, 'the source session writes nothing', mainWrites.length === 0, JSON.stringify(callSummary(mainWrites)))
  mark(checks, 'no memory row is created', rows.length === 0, JSON.stringify(rowSummary(rows)))
  mark(checks, 'the child turn ends completed', maintenance.child.turnEndReasons.at(-1) === 'completed', JSON.stringify(maintenance.child.turnEndReasons))
  return {
    checks,
    evidence: {
      session,
      prompts: texts,
      replies: turns.map(turn => turn.reply),
      maintenance: {
        row: maintenance.row,
        childSession: maintenance.child.sessionId,
        childModel: `${maintenance.child.provider}/${maintenance.child.model}`,
        childToolNames: maintenance.child.toolNames,
        childCalls: callSummary(maintenance.child.toolCalls),
        childWrites: callSummary(childWrites),
        childFinalText: maintenance.child.finalText,
        material: excerpt(maintenance.child.material),
      },
      mainWrites: callSummary(mainWrites),
      rows: rowSummary(rows),
    },
  }
}

async function caseVolatileObservation(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  const texts = [
    '今天下午可能会下雨，天气预报也不太确定。',
    '我现在有点困，眼皮打架。',
    '刚才好像听到楼下有动静。',
    '明天再看吧，说不定就变了。',
    '外面风挺大的。',
  ]
  const turns: TurnRecord[] = []
  for (const text of texts) turns.push(await sendTurn(runtime, runtime.alice, session, text))
  const last = turns.at(-1)!
  const maintenance = await runMaintenance(runtime, session, last.endSeq)
  const mainWrites = writeCalls(turns.flatMap(turn => turn.toolCalls))
  const childWrites = writeCalls(maintenance.child.toolCalls)
  const rows = rowsFromSession(runtime, session)
  mark(checks, 'the maintenance interval completes', maintenance.row.status === 0 && maintenance.row.watermark_seq >= last.endSeq, JSON.stringify(maintenance.row))
  mark(checks, 'the child writes nothing for uncertain observations', childWrites.length === 0, JSON.stringify(callSummary(childWrites)))
  mark(checks, 'the source session writes nothing for uncertain observations', mainWrites.length === 0, JSON.stringify(callSummary(mainWrites)))
  mark(checks, 'no volatile observation becomes a durable row', rows.length === 0, JSON.stringify(rowSummary(rows)))
  mark(checks, 'the child turn ends completed', maintenance.child.turnEndReasons.at(-1) === 'completed', JSON.stringify(maintenance.child.turnEndReasons))
  return {
    checks,
    evidence: {
      session,
      prompts: texts,
      replies: turns.map(turn => turn.reply),
      maintenance: {
        row: maintenance.row,
        childSession: maintenance.child.sessionId,
        childModel: `${maintenance.child.provider}/${maintenance.child.model}`,
        childCalls: callSummary(maintenance.child.toolCalls),
        childWrites: callSummary(childWrites),
        childFinalText: maintenance.child.finalText,
        material: excerpt(maintenance.child.material),
      },
      mainWrites: callSummary(mainWrites),
      rows: rowSummary(rows),
    },
  }
}

async function casePassingPreference(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = await newSession(runtime, runtime.alice)
  shared.preferenceSessionId = session
  const texts = [
    '今天工作有点累，随便聊聊。',
    '对了，我一直喜欢喝不加糖的美式，每天早上都要来一杯，这个习惯很多年了。',
    '窗外树叶开始黄了。',
    '你平时会怎么安排一天？',
    '好，今天就聊到这里。',
  ]
  const turns: TurnRecord[] = []
  for (const text of texts) turns.push(await sendTurn(runtime, runtime.alice, session, text))
  const last = turns.at(-1)!
  const maintenance = await runMaintenance(runtime, session, last.endSeq)
  const rows = rowsFromSession(runtime, session)
  const preference = preferenceRows(rows)
  const mainAdds = turns.flatMap(turn => turn.toolCalls)
    .filter(call => call.name === 'memory_add' && PREFERENCE.test(string(argumentsOf(call)?.content) ?? ''))
  const childAdds = maintenance.child.toolCalls
    .filter(call => call.name === 'memory_add' && PREFERENCE.test(string(argumentsOf(call)?.content) ?? ''))
  shared.preferenceRowIds = preference.map(row => row.id)
  mark(checks, 'the passing preference is stored', preference.length >= 1, JSON.stringify(rowSummary(rows)))
  mark(checks, 'it is stored once, not twice', preference.length === 1, JSON.stringify(rowSummary(preference)))
  mark(checks, 'the stored text carries the durable habit', preference.some(row => /每天|早上|习惯|长期/.test(row.content)), JSON.stringify(preference.map(row => row.content)))
  mark(checks, 'the new memory is normal by default', preference.every(row => row.is_private === 0), JSON.stringify(preference.map(row => row.is_private)))
  mark(checks, 'the maintenance interval advances', maintenance.row.watermark_seq >= last.endSeq, JSON.stringify(maintenance.row))
  mark(checks, 'at least one writer stored the preference', mainAdds.length + childAdds.length >= 1, `main=${String(mainAdds.length)} child=${String(childAdds.length)}`)
  return {
    checks,
    evidence: {
      session,
      prompts: texts,
      replies: turns.map(turn => turn.reply),
      writer: childAdds.length > 0 ? 'maintenance child' : 'main session',
      mainWrites: callSummary(writeCalls(turns.flatMap(turn => turn.toolCalls))),
      maintenance: {
        row: maintenance.row,
        childSession: maintenance.child.sessionId,
        childModel: `${maintenance.child.provider}/${maintenance.child.model}`,
        childCalls: callSummary(maintenance.child.toolCalls),
        childWrites: callSummary(writeCalls(maintenance.child.toolCalls)),
        childFinalText: maintenance.child.finalText,
        material: excerpt(maintenance.child.material),
      },
      rows: rowSummary(rows),
      preferenceRows: rowSummary(preference),
    },
  }
}

async function caseMaintenanceNoRewrite(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  const checks: Check[] = []
  const session = shared.preferenceSessionId
  if (session === undefined) {
    mark(checks, 'the later interval has a stored preference to compare', false, 'passing-preference did not create a session')
    return { checks, evidence: {} }
  }
  const baseline = preferenceRows(memoryRows(runtime).filter(row => row.source_session === session))
  const baselineIds = baseline.map(row => row.id)
  const texts = ['还是老样子，早上那杯美式。', '今天没什么新鲜事。', '你随意说点什么。', '嗯。', '好。']
  const turns: TurnRecord[] = []
  for (const text of texts) turns.push(await sendTurn(runtime, runtime.alice, session, text))
  const last = turns.at(-1)!
  const maintenance = await runMaintenance(runtime, session, last.endSeq)
  const after = preferenceRows(memoryRows(runtime).filter(row => row.source_session === session))
  const afterIds = after.map(row => row.id)
  const mainAdds = turns.flatMap(turn => turn.toolCalls)
    .filter(call => call.name === 'memory_add' && PREFERENCE.test(string(argumentsOf(call)?.content) ?? ''))
  const childAdds = maintenance.child.toolCalls
    .filter(call => call.name === 'memory_add' && PREFERENCE.test(string(argumentsOf(call)?.content) ?? ''))
  mark(checks, 'the later interval advances the watermark', maintenance.row.watermark_seq >= last.endSeq, JSON.stringify(maintenance.row))
  mark(checks, 'the stored preference is still one row', after.length === 1, JSON.stringify(rowSummary(after)))
  mark(checks, 'the later interval reuses the same memory number', after.length === 1 && afterIds.join(',') === baselineIds.join(','), `${baselineIds.join(',')} -> ${afterIds.join(',')}`)
  mark(checks, 'the main session adds no duplicate', mainAdds.length === 0, JSON.stringify(callSummary(mainAdds)))
  mark(checks, 'the child adds no duplicate', childAdds.length === 0, JSON.stringify(callSummary(childAdds)))
  return {
    checks,
    evidence: {
      session,
      prompts: texts,
      replies: turns.map(turn => turn.reply),
      baselineRows: rowSummary(baseline),
      afterRows: rowSummary(after),
      mainWrites: callSummary(writeCalls(turns.flatMap(turn => turn.toolCalls))),
      maintenance: {
        row: maintenance.row,
        childSession: maintenance.child.sessionId,
        childModel: `${maintenance.child.provider}/${maintenance.child.model}`,
        childCalls: callSummary(maintenance.child.toolCalls),
        childWrites: callSummary(writeCalls(maintenance.child.toolCalls)),
        childFinalText: maintenance.child.finalText,
        material: excerpt(maintenance.child.material),
      },
    },
  }
}

async function caseImpression(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const marker = IMPRESSION_MARKER
  const body = `${marker}：主人喜欢简明扼要的回答，这是 Alice 本人的印象。`

  // The user has no write route at all: the product registers only the read
  // route, so an impression is replaced by the Fairy's own tools alone.
  const writeRoute = await request(runtime.port, '/impression/edit', { token: runtime.alice.token, body: { content: body } })
  mark(checks, 'the user write route is absent', writeRoute.status === 404, `${String(writeRoute.status)} ${writeRoute.text.slice(0, 200)}`)

  const aliceBefore = impressionContent(await impressionRead(runtime, runtime.alice.token))
  mark(checks, 'the owner starts with no impression in this fresh home', aliceBefore === '', aliceBefore.slice(0, 200))

  // The Fairy replaces the impression through its own tools, in a session it
  // owns. The first ask is the user's own words; when the model answers
  // without calling the tools, a second ask names them, and the evidence
  // records which ask carried the update.
  const session = await newSession(runtime, runtime.alice)
  const naturalAsk = `我希望你对我这个人的印象更新成下面这一段，以后都按这个来：\n${body}`
  const explicitAsk = `请先用 impression_read 读取我当前的印象，再用 impression_edit 把整份印象替换成下面这一段：\n${body}`
  const naturalTurn = await sendTurn(runtime, runtime.alice, session, naturalAsk)
  let updatePrompt = naturalAsk
  let updateTurn = naturalTurn
  let updateKind = 'natural request'
  if (!successfulImpressionEdit(naturalTurn.toolCalls)) {
    updatePrompt = explicitAsk
    updateTurn = await sendTurn(runtime, runtime.alice, session, explicitAsk)
    updateKind = 'explicit tool request'
  }
  // The read and the edit may land in one turn or in two; the order is what
  // matters, so both turns are read as one sequence.
  const calls = updateTurn === naturalTurn ? naturalTurn.toolCalls : [...naturalTurn.toolCalls, ...updateTurn.toolCalls]
  const readIndex = calls.findIndex(call => call.name === 'impression_read')
  const successfulEdit = calls.findLast(call => call.name === 'impression_edit' && (call.result ?? '').includes('"ok":true'))
  const editIndex = successfulEdit === undefined ? -1 : calls.indexOf(successfulEdit)
  const callNames = calls.map(call => call.name).join(',')
  mark(checks, 'the Fairy reads the impression before editing it', readIndex >= 0 && editIndex > readIndex, callNames)
  mark(checks, 'the Fairy replaces the impression through its own tool', successfulEdit !== undefined, callNames)
  const editedContent = string(argumentsOf(successfulEdit)?.content) ?? ''
  mark(checks, 'the edit carries the requested body', editedContent.includes(marker), editedContent.slice(0, 300))

  const stored = impressionRow(runtime, runtime.alice.shortId)
  mark(checks, 'the stored row belongs to the owner', stored?.short_id === runtime.alice.shortId, JSON.stringify(stored))
  mark(checks, 'the stored body carries the new impression', (stored?.content ?? '').includes(marker), (stored?.content ?? '').slice(0, 300))
  const bobStored = impressionRow(runtime, runtime.bob.shortId)
  mark(checks, 'no other user\'s row was written', bobStored === undefined || !bobStored.content.includes(marker), JSON.stringify(bobStored ?? null))

  const aliceAfter = impressionContent(await impressionRead(runtime, runtime.alice.token))
  mark(checks, 'the owner reads back the updated impression', aliceAfter.includes(marker), aliceAfter.slice(0, 300))
  const bobRead = impressionContent(await impressionRead(runtime, runtime.bob.token))
  mark(checks, 'another user reads their own impression, not the owner\'s', !bobRead.includes(marker), bobRead.slice(0, 300))
  const adminRead = impressionContent(await impressionRead(runtime, runtime.admin.token))
  mark(checks, 'the administrator reads their own row, never another user\'s', !adminRead.includes(marker), adminRead.slice(0, 300))

  const aliceSession = await newSession(runtime, runtime.alice)
  const aliceTurn = await sendTurn(runtime, runtime.alice, aliceSession, '你好，随便说一句。')
  const alicePrompt = await systemPromptOf(runtime, aliceSession)
  mark(checks, 'the owner\'s assembled system prompt carries the impression', alicePrompt.includes(marker), `${String(alicePrompt.length)} chars`)
  const bobSession = await newSession(runtime, runtime.bob)
  const bobTurn = await sendTurn(runtime, runtime.bob, bobSession, '你好，随便说一句。')
  const bobPrompt = await systemPromptOf(runtime, bobSession)
  mark(checks, 'another user\'s assembled system prompt does not carry it', !bobPrompt.includes(marker), `${String(bobPrompt.length)} chars`)
  return {
    checks,
    evidence: {
      body,
      writeRoute: { status: writeRoute.status, code: errorCode(writeRoute) },
      aliceBefore,
      aliceAfter,
      stored: stored ?? null,
      bobStored: bobStored ?? null,
      bobRead,
      adminRead,
      update: {
        kind: updateKind,
        prompt: updatePrompt,
        reply: updateTurn.reply,
        toolCalls: callSummary(calls),
      },
      naturalAsk: { prompt: naturalAsk, reply: naturalTurn.reply, toolCalls: callSummary(naturalTurn.toolCalls) },
      deterministicCoverage: 'tests/memory-impression.test.mjs asserts the over-length refusal, the read-before-edit refusal and the whole-replacement storage against the same rules; this real-model sample does not attempt a fragile 8001-character tool call.',
      aliceSession,
      aliceReply: aliceTurn.reply,
      alicePromptExcerpt: excerpt(alicePrompt, 1500),
      bobSession,
      bobReply: bobTurn.reply,
      bobPromptExcerpt: excerpt(bobPrompt, 1500),
    },
  }
}

async function caseCrossUserDiscretion(runtime: Runtime): Promise<CaseOutcome> {
  const checks: Check[] = []
  const aliceSession = await newSession(runtime, runtime.alice)
  const normalTurn = await sendTurn(runtime, runtime.alice, aliceSession, '请记住：普通暗号 CROSS-NORMAL-KEY-9c1f。')
  const privateTurn = await sendTurn(runtime, runtime.alice, aliceSession, '请记住：私密暗号 CROSS-PRIVATE-KEY-4d2e，并把它设为私密记忆。')
  const rows = memoryRows(runtime)
  const normal = rows.find(row => row.content.includes('CROSS-NORMAL-KEY-9c1f'))
  const privateRow = rows.find(row => row.content.includes('CROSS-PRIVATE-KEY-4d2e'))
  mark(checks, 'Alice\'s normal memory exists', normal !== undefined, JSON.stringify(rowSummary(rows.filter(row => row.content.includes('CROSS-NORMAL-KEY')))))
  mark(checks, 'Alice\'s private memory exists', privateRow !== undefined, JSON.stringify(rowSummary(rows.filter(row => row.content.includes('CROSS-PRIVATE-KEY')))))
  mark(checks, 'Alice\'s private memory is in the private layer', privateRow?.is_private === 1, JSON.stringify(privateRow))
  mark(checks, 'Alice\'s normal memory is in the normal layer', normal?.is_private === 0, JSON.stringify(normal))

  const bobSession = await newSession(runtime, runtime.bob)
  const bobTurn = await sendTurn(runtime, runtime.bob, bobSession,
    '请做三次记忆检索并原样报告：1) 在普通层搜索 CROSS-NORMAL-KEY-9c1f；2) 在普通层搜索 CROSS-PRIVATE-KEY-4d2e；3) 在私密层搜索 CROSS-PRIVATE-KEY-4d2e。')
  const searches = bobTurn.toolCalls.filter(call => call.name === 'memory_search')
  const ordinaryNormal = searches.find(call => (string(argumentsOf(call)?.query) ?? '').includes('CROSS-NORMAL-KEY') && argumentsOf(call)?.is_private !== true)
  const ordinaryPrivate = searches.find(call => (string(argumentsOf(call)?.query) ?? '').includes('CROSS-PRIVATE-KEY') && argumentsOf(call)?.is_private !== true)
  const deepPrivate = searches.find(call => (string(argumentsOf(call)?.query) ?? '').includes('CROSS-PRIVATE-KEY') && argumentsOf(call)?.is_private === true)
  const ordinaryNormalReport = searchReport(ordinaryNormal)
  const ordinaryPrivateReport = searchReport(ordinaryPrivate)
  const deepPrivateReport = searchReport(deepPrivate)
  const hits = (report: JsonObject | undefined): JsonObject[] => array(report?.memories).map(record).filter((hit): hit is JsonObject => hit !== undefined)
  mark(checks, 'Bob\'s ordinary search finds the shared normal memory', number(ordinaryNormalReport?.matched) !== undefined && number(ordinaryNormalReport?.matched)! >= 1, JSON.stringify(ordinaryNormalReport))
  mark(checks, 'that hit names Alice as its owner', hits(ordinaryNormalReport).some(hit => number(hit.owner_short_id) === runtime.alice.shortId), JSON.stringify(hits(ordinaryNormalReport)))
  mark(checks, 'Bob\'s ordinary search does not return Alice\'s private memory', number(ordinaryPrivateReport?.matched) === 0, JSON.stringify(ordinaryPrivateReport))
  mark(checks, 'the explicit deep search is the path to the private memory', number(deepPrivateReport?.matched) !== undefined && number(deepPrivateReport?.matched)! >= 1, JSON.stringify(deepPrivateReport))
  mark(checks, 'the private hit names Alice as its owner', hits(deepPrivateReport).some(hit => number(hit.owner_short_id) === runtime.alice.shortId), JSON.stringify(hits(deepPrivateReport)))
  const bobPrompt = await systemPromptOf(runtime, bobSession)
  mark(checks, 'Alice\'s impression never enters Bob\'s assembled prompt', !bobPrompt.includes(IMPRESSION_MARKER), `${String(bobPrompt.length)} chars`)
  return {
    checks,
    evidence: {
      aliceSession,
      normalPrompt: normalTurn.text,
      normalReply: normalTurn.reply,
      privatePrompt: privateTurn.text,
      privateReply: privateTurn.reply,
      aliceRows: rowSummary(rows.filter(row => row.content.includes('CROSS-NORMAL-KEY') || row.content.includes('CROSS-PRIVATE-KEY'))),
      bobSession,
      bobPrompt: bobTurn.text,
      bobReply: bobTurn.reply,
      searches: callSummary(searches),
      reports: {
        ordinaryNormal: ordinaryNormalReport ?? null,
        ordinaryPrivate: ordinaryPrivateReport ?? null,
        deepPrivate: deepPrivateReport ?? null,
      },
      bobSystemPromptExcerpt: excerpt(bobPrompt, 1500),
      interpretation: 'Normal long-term memories are product-global by spec #240 (per-user partitioning is explicitly rejected); the discretion checks are private-layer isolation, owner attribution and per-user impressions. Deep search is an explicit deliberate action, not an accidental leak.',
    },
  }
}

// ── runner ─────────────────────────────────────────────────────────────────

async function runCase(definition: CaseDefinition, runtime: Runtime, shared: Shared): Promise<CaseResult> {
  const startedAt = new Date().toISOString()
  try {
    const outcome = await definition.run(runtime, shared)
    return {
      id: definition.id,
      title: definition.title,
      status: outcome.checks.every(check => check.ok) ? 'passed' : 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      checks: outcome.checks,
      evidence: outcome.evidence,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      id: definition.id,
      title: definition.title,
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      checks: [{ name: 'the case executes', ok: false, detail: message }],
      evidence: {},
      error: message,
    }
  }
}

function unexecutedCase(definition: CaseDefinition, reason: string): CaseResult {
  const now = new Date().toISOString()
  return {
    id: definition.id,
    title: definition.title,
    status: 'unexecuted',
    startedAt: now,
    finishedAt: now,
    checks: [{ name: 'the case ran', ok: false, detail: reason }],
    evidence: {},
    error: reason,
  }
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2))
  if (options.plan) {
    process.stdout.write(`${JSON.stringify({
      cases: CASE_ORDER.map(definition => ({ id: definition.id, title: definition.title })),
      settings: {
        maintenanceTriggerTurns: MAINTENANCE_TRIGGER_TURNS,
        maintenanceDecayHours: MAINTENANCE_DECAY_HOURS,
        provider: REAL_PROVIDER,
        model: REAL_MODEL,
      },
      requirements: [
        'MINIMAX_CN_API_KEY (or MINIMAX_API_KEY) with a real MiniMax credential; the script never prints it',
        'network access to the real MiniMax endpoint',
        'a built dsh checkout and this worktree, with npm run build already run',
      ],
      notInCi: true,
    }, undefined, 2)}\n`)
    return
  }

  const credentialSource = process.env.MINIMAX_CN_API_KEY !== undefined && process.env.MINIMAX_CN_API_KEY !== ''
    ? 'MINIMAX_CN_API_KEY'
    : process.env.MINIMAX_API_KEY !== undefined && process.env.MINIMAX_API_KEY !== ''
      ? 'MINIMAX_API_KEY'
      : undefined
  if (credentialSource === undefined) {
    fail('MINIMAX_CN_API_KEY is not set (or MINIMAX_API_KEY as the loader fallback); export the real MiniMax key first')
  }
  if (credentialSource === 'MINIMAX_API_KEY') process.env.MINIMAX_CN_API_KEY = process.env.MINIMAX_API_KEY

  const home = options.home ?? mkdtempSync(join(tmpdir(), 'ourfairy-memory-acceptance-'))
  mkdirSync(home, { recursive: true })
  const selectedIds = options.only.length > 0 ? new Set(options.only) : new Set(CASE_ORDER.map(definition => definition.id))
  const report: {
    startedAt: string
    finishedAt: string
    home: string
    backend: { port: number; logFile: string }
    model: { provider: string; model: string; baseURL: string; credentialSource: string }
    maintenance: { before: JsonObject | null; saved: JsonObject | null; readBack: JsonObject | null }
    selected: string[]
    notSelected: string[]
    cases: CaseResult[]
    unexecuted: string[]
    failures: string[]
    notes: string[]
  } = {
    startedAt: new Date().toISOString(),
    finishedAt: '',
    home,
    backend: { port: 0, logFile: '' },
    model: { provider: '', model: '', baseURL: '', credentialSource },
    maintenance: { before: null, saved: null, readBack: null },
    selected: [...selectedIds],
    notSelected: [],
    cases: [],
    unexecuted: [],
    failures: [],
    notes: [],
  }

  let backend: Backend | undefined
  let runtime: Runtime | undefined
  try {
    backend = startBackend(home)
    report.backend = { port: backend.port, logFile: backend.logFile }
    process.stderr.write(`memory-acceptance: backend on 127.0.0.1:${String(backend.port)} (home ${home})\n`)
    const admin = await signIn(backend, 'phaethon', PHAETHON_PASSWORD)
    const alice = await registerUser(backend, admin, `acceptance-alice-${Date.now().toString(36)}`)
    const bob = await registerUser(backend, admin, `acceptance-bob-${Date.now().toString(36)}`)
    runtime = { ...backend, admin, alice, bob, turnTimeoutMs: options.turnTimeoutMs }

    const gatewayBefore = await gatewayRead(runtime)
    report.model = { ...assertRealRoute(gatewayBefore), credentialSource }
    report.maintenance.before = record(gatewayBefore.maintenance) ?? null
    const saved = await request(runtime.port, '/gateway/maintenance', {
      token: admin.token,
      body: { triggerTurns: MAINTENANCE_TRIGGER_TURNS, decayHours: MAINTENANCE_DECAY_HOURS },
    })
    if (saved.status !== 200) throw new Error(`/gateway/maintenance answered ${saved.status}: ${saved.text.slice(0, 500)}`)
    report.maintenance.saved = record(saved.json.maintenance) ?? null
    const gatewayAfter = await gatewayRead(runtime)
    report.maintenance.readBack = record(gatewayAfter.maintenance) ?? null
    process.stderr.write(`memory-acceptance: route ${report.model.provider}/${report.model.model} at ${report.model.baseURL}\n`)
    process.stderr.write(`memory-acceptance: maintenance ${JSON.stringify(report.maintenance.readBack)}\n`)

    const shared: Shared = { preferenceSessionId: undefined, preferenceRowIds: [] }
    for (const definition of CASE_ORDER) {
      if (!selectedIds.has(definition.id)) {
        report.cases.push(unexecutedCase(definition, 'not selected by --only'))
        continue
      }
      process.stderr.write(`memory-acceptance: ${definition.id} …\n`)
      const result = await runCase(definition, runtime, shared)
      report.cases.push(result)
      process.stderr.write(`memory-acceptance: ${definition.id} ${result.status} (${String(result.checks.filter(check => check.ok).length)}/${String(result.checks.length)} checks)\n`)
      if (result.status !== 'passed') {
        for (const check of result.checks.filter(entry => !entry.ok)) {
          process.stderr.write(`  ✖ ${check.name}: ${check.detail}\n`)
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    report.failures.push(message)
    process.stderr.write(`memory-acceptance: ${message}\n`)
  } finally {
    if (backend !== undefined && !options.keep) stopBackend(backend.home)
    report.finishedAt = new Date().toISOString()
    for (const result of report.cases) {
      if (result.status === 'unexecuted') {
        if (selectedIds.has(result.id)) report.unexecuted.push(`${result.id}: ${result.error ?? 'unexecuted'}`)
        else report.notSelected.push(result.id)
      }
      if (result.status === 'failed') report.failures.push(`${result.id}: ${result.error ?? result.checks.filter(check => !check.ok).map(check => check.name).join('; ')}`)
    }
    const out = options.out ?? join(home, 'memory-acceptance.json')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(report, undefined, 2)}\n`)
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
    process.stderr.write(`memory-acceptance: report written to ${out}\n`)
    if (options.keep && backend !== undefined) process.stderr.write(`memory-acceptance: backend left running on 127.0.0.1:${String(backend.port)} (--keep)\n`)
    if (report.failures.length > 0 || report.unexecuted.length > 0) process.exitCode = 1
  }
}

if (isCliEntry(import.meta.main)) await main()
