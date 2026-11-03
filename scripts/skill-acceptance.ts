#!/usr/bin/env node
/**
 * Real-model acceptance for the Fairy skill increment (spec #295, ticket #300).
 *
 * This script boots the shipped product backend with the deployment's real
 * MiniMax route and drives it exactly like a user and the client do. It never
 * mounts a model double: the gateway read is checked to be
 * `minimax-cn / MiniMax-M3.1-Flash` on a real (non-loopback) base URL, a
 * loopback `OURFAIRY_MINIMAX_BASE_URL` is refused before any case runs, and
 * the light/deep call counts and token usage are read from the durable session
 * logs (detection/review child ids, creation child ids and the ordinary
 * sessions) rather than from the script's own bookkeeping.
 *
 * The sample is deliberately small: meaningless conversation, one successful
 * workflow, two independent successful sessions, a late correction, a
 * duplicate against existing evidence, explicit creation, a common proposal
 * and (when an address is supplied) an address install. It is NOT part of
 * `npm test` and it is NOT a CI gate; the deterministic model-double suites
 * stay the every-commit evidence, and this one records semantic quality,
 * routes and cost separately.
 *
 * Usage:
 *   set -a; . /home/eafen405/projects/MINIMAX_API_KEY.env; set +a
 *   export MINIMAX_CN_API_KEY="$MINIMAX_API_KEY"
 *   npm run acceptance:skill
 *   npm run acceptance:skill -- --plan
 *   npm run acceptance:skill -- --only meaningless,one-success
 *   npm run acceptance:skill -- --address https://github.com/<owner>/<repo>/tree/<ref>/<path>
 *
 * `--plan` reads no credential, starts no backend and writes no file. Without
 * `--plan`, stdout is one JSON report and progress goes to stderr; the report
 * path is printed on stderr. `--keep` leaves the backend running. Exit code 0
 * means every selected case passed and none was left unexecuted.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'
import { isCliEntry } from './cli-guard.ts'
import { repoRoot } from './combo.ts'

/** The administrator password this isolated acceptance home uses (not a deployment secret). */
const PHAETHON_PASSWORD = 'skill-acceptance-password'
/** The password every invited acceptance user uses. */
const USER_PASSWORD = 'skill-acceptance-user-password'
/** The closed-user-turn threshold the sample sets for the run. */
const DEFAULT_LEARNING_TURNS = 2
/** The only real route this sample accepts. */
const REAL_PROVIDER = 'minimax-cn'
const REAL_MODEL = 'MiniMax-M3.1-Flash'

type JsonObject = Record<string, unknown>
type Answer = { status: number; json: JsonObject; text: string }
type ChatEvent = { seq: number; type: string; data: JsonObject }
type Projection = { cursor: number; replyStatus: number; error: unknown; events: ChatEvent[] }
type Identity = { name: string; token: string; shortId: number }
type Backend = { home: string; port: number; logFile: string; dbPath: string; sessionsRoot: string }
type TurnRecord = { text: string; reply: string; events: ChatEvent[]; toolCalls: { name: string; arguments: string; result?: string }[]; endSeq: number }
type SessionLog = { header: JsonObject; events: ChatEvent[] }
type SessionUsage = { calls: number; inputTokens: number; outputTokens: number }
type Usage = { lightCalls: number; deepCalls: number; inputTokens: number; outputTokens: number; sessions: Record<string, SessionUsage> }
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
  usage: Usage
  error?: string
}
type Shared = {
  successSession?: string | undefined
  successSignalId?: number | undefined
  taskKey?: string | undefined
  firstJobId?: number | undefined
  candidateVersionId?: number | undefined
}
type CaseDefinition = { id: string; title: string; run: (runtime: Runtime, shared: Shared) => Promise<CaseOutcome> }
type Runtime = Backend & { admin: Identity; alice: Identity; bob: Identity; turnTimeoutMs: number; learningTurns: number }
type Options = { home: string | undefined; out: string | undefined; address: string | undefined; only: string[]; plan: boolean; keep: boolean; turnTimeoutMs: number; learningTurns: number }

/** The cases in execution order; ids are the `--only` handles. */
const CASE_ORDER: CaseDefinition[] = [
  { id: 'meaningless', title: 'meaningless conversation advances the watermark with zero signals', run: caseMeaningless },
  { id: 'one-success', title: 'one successful workflow produces one reuse signal', run: caseOneSuccess },
  { id: 'two-sessions', title: 'two independent successful sessions reach one deep creation', run: caseTwoSessions },
  { id: 'late-correction', title: 'a late correction revokes the earlier success without rewriting it', run: caseLateCorrection },
  { id: 'duplicate-existing', title: 'a repeated workflow dedupes against the existing candidate/skill', run: caseDuplicate },
  { id: 'explicit-creation', title: 'an explicit request forms a personal skill candidate', run: caseExplicitCreation },
  { id: 'common-proposal', title: 'an explicit common intent forms a common candidate', run: caseCommonProposal },
  { id: 'address-install', title: 'an address install forms a pending candidate', run: (runtime, shared) => caseAddressInstall(runtime, shared, undefined) },
]

/* ── small JSON helpers (the acceptance report is plain JSON) ───────────── */

function record(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
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
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
function fail(message: string): never {
  throw new Error(message)
}

/* ── HTTP, identity and chat helpers ────────────────────────────────────── */

function request(port: number, path: string, { token, body }: { token?: string; body?: unknown } = {}): Promise<Answer> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const headers: Record<string, string> = { host: `127.0.0.1:${String(port)}` }
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
          json = record(parsed) ?? {}
        } catch {
          // A non-JSON answer stays empty; the status and text record it.
        }
        resolvePromise({ status: response.statusCode ?? 0, json, text })
      })
    })
    call.on('error', reject)
    if (payload !== undefined) call.write(payload)
    call.end()
  })
}

function identityOf(answer: Answer, name: string): Identity {
  const token = string(answer.json.token)
  const shortId = number(record(answer.json.user)?.shortId)
  if (token === undefined || shortId === undefined) fail(`identity answer has no token/shortId: ${answer.text.slice(0, 500)}`)
  return { name, token, shortId }
}

async function signIn(port: number, name: string, password: string): Promise<Identity> {
  const answer = await request(port, '/identity/sign-in', { body: { name, password } })
  if (answer.status !== 200) fail(`sign-in for ${name} answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  return identityOf(answer, name)
}

async function registerUser(port: number, admin: Identity, name: string): Promise<Identity> {
  const invite = await request(port, '/identity/invite', { token: admin.token, body: {} })
  if (invite.status !== 200) fail(`invite for ${name} answered ${invite.status}: ${invite.text.slice(0, 500)}`)
  const code = string(record(invite.json.invite)?.code)
  if (code === undefined) fail('the invite answer carried no code')
  const registered = await request(port, '/identity/register', { body: { inviteCode: code, name, password: USER_PASSWORD } })
  if (registered.status !== 200) fail(`registration for ${name} answered ${registered.status}: ${registered.text.slice(0, 500)}`)
  return identityOf(registered, name)
}

function projectionOf(answer: Answer): Projection {
  const projection = record(answer.json.projection)
  return {
    cursor: number(projection?.cursor) ?? 0,
    replyStatus: number(projection?.replyStatus) ?? -1,
    error: projection?.error,
    events: array(projection?.events).map(event => {
      const object = record(event) ?? {}
      return { seq: number(object.seq) ?? 0, type: string(object.type) ?? '', data: record(object.data) ?? {} }
    }),
  }
}

async function readChat(runtime: Runtime, identity: Identity, sessionId: string): Promise<Projection> {
  const answer = await request(runtime.port, '/chat/read', { token: identity.token, body: { sessionId, maxEvents: 512 } })
  if (answer.status !== 200) fail(`/chat/read answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  return projectionOf(answer)
}

function toolCallsOf(events: ChatEvent[]): { name: string; arguments: string; result?: string }[] {
  const results = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const message = record(event.data.message) ?? {}
    const callId = string(message.toolCallId)
    if (callId === undefined) continue
    results.set(callId, array(message.content).map(block => string(record(block)?.text) ?? '').join(''))
  }
  return events.filter(event => event.type === 'tool/call').map(event => {
    const callId = string(event.data.callId) ?? ''
    const result = results.get(callId)
    return {
      name: string(event.data.name) ?? '',
      arguments: string(event.data.arguments) ?? '',
      ...(result === undefined ? {} : { result }),
    }
  })
}

async function sendTurn(runtime: Runtime, identity: Identity, sessionId: string, text: string): Promise<TurnRecord> {
  const before = await readChat(runtime, identity, sessionId)
  const sent = await request(runtime.port, '/chat/send', {
    token: identity.token,
    body: { sessionId, requestId: `skill-acceptance-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`, text },
  })
  if (sent.status !== 200) fail(`/chat/send answered ${sent.status}: ${sent.text.slice(0, 500)}`)
  const deadline = Date.now() + runtime.turnTimeoutMs
  let last: Projection | undefined
  while (Date.now() < deadline) {
    const projection = await readChat(runtime, identity, sessionId)
    last = projection
    if (projection.error !== undefined && projection.error !== null) fail(`the turn failed: ${JSON.stringify(projection.error)}`)
    const endings = projection.events.filter(event => event.type === 'turn/end' && event.seq > before.cursor)
    if (projection.replyStatus === 0 && endings.length > 0) {
      const events = projection.events.filter(event => event.seq > before.cursor)
      const reply = events.filter(event => event.type === 'assistant/message')
        .map(event => array(record(event.data.message)?.content).map(block => string(record(block)?.text) ?? '').join(''))
        .join('\n')
      return { text, reply, events, toolCalls: toolCallsOf(events), endSeq: endings.at(-1)?.seq ?? before.cursor }
    }
    await delay(400)
  }
  fail(`the turn did not settle within ${String(runtime.turnTimeoutMs)}ms; last replyStatus ${String(last?.replyStatus)}`)
}

async function newSession(runtime: Runtime, identity: Identity): Promise<string> {
  const answer = await request(runtime.port, '/sessions/create', { token: identity.token, body: {} })
  if (answer.status !== 200) fail(`/sessions/create answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  const id = string(record(answer.json.session)?.id)
  if (id === undefined) fail(`/sessions/create returned no session: ${answer.text.slice(0, 500)}`)
  return id
}

/* ── durable session logs: header + usage + the child prompts ───────────── */

function scanZstdFrames(buffer: Buffer): { frames: { start: number; end: number }[]; tornStart: number | undefined } {
  const frames: { start: number; end: number }[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== 0xFD2FB528) return { frames, tornStart: start }
    offset += 4
    if (buffer.length - offset < 1) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const frameContentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    offset += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag)
      + (frameContentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << frameContentSizeFlag)
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const header = buffer.readUIntLE(offset, 3)
      offset += 3
      const last = (header & 1) !== 0
      const type = (header >>> 1) & 0x03
      if (type === 0x03) return { frames, tornStart: start }
      offset += type === 0x01 ? 1 : header >>> 3
      if (last) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return { frames, tornStart: undefined }
}

function findSessionLog(root: string, sessionId: string, depth = 0): string | undefined {
  let children
  try {
    children = readdirSync(root, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const child of children) {
    if (!child.isDirectory()) continue
    if (child.name === sessionId) {
      for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
        const file = join(root, child.name, name)
        if (existsSync(file)) return file
      }
    }
    if (depth < 2) {
      const found = findSessionLog(join(root, child.name), sessionId, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function readSessionLog(root: string, sessionId: string): SessionLog | undefined {
  const file = findSessionLog(root, sessionId)
  if (file === undefined) return undefined
  const bytes = readFileSync(file)
  let text: string
  if (file.endsWith('.zstd')) {
    const { frames, tornStart } = scanZstdFrames(bytes)
    if (tornStart !== undefined) return undefined
    text = frames.map(frame => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8')).join('')
  } else {
    text = bytes.toString('utf8')
  }
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
    if (type === 'session') {
      Object.assign(header, object)
      continue
    }
    if (type === undefined) continue
    const seq = number(object.seq)
    if (seq === undefined) continue
    events.push({ seq, type, data: record(object.data) ?? {} })
  }
  return Object.keys(header).length === 0 ? undefined : { header, events }
}

/** Every session's header and usage, keyed by session id. */
function usageSnapshot(runtime: Runtime): Record<string, { usage: SessionUsage; header: JsonObject; prompt: string }> {
  const snapshot: Record<string, { usage: SessionUsage; header: JsonObject; prompt: string }> = {}
  const visit = (dir: string, depth: number): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const log = readSessionLog(dir, entry.name)
      if (log !== undefined) {
        let calls = 0
        let inputTokens = 0
        let outputTokens = 0
        let prompt = ''
        for (const event of log.events) {
          if (event.type === 'assistant/message') {
            calls += 1
            const usage = record(event.data.usage)
            inputTokens += number(usage?.inputTokens) ?? 0
            outputTokens += number(usage?.outputTokens) ?? 0
          }
          if (event.type === 'system/message') {
            const message = record(event.data.message)
            const content = message?.content
            prompt += typeof content === 'string'
              ? content
              : array(content).map(block => string(record(block)?.text) ?? '').join('')
          }
        }
        snapshot[entry.name] = { usage: { calls, inputTokens, outputTokens }, header: log.header, prompt }
      }
      if (depth < 2) visit(join(dir, entry.name), depth + 1)
    }
  }
  visit(runtime.sessionsRoot, 0)
  return snapshot
}

/** The usage difference between two snapshots, split into light and deep calls. */
function usageDiff(before: Record<string, { usage: SessionUsage }>, after: Record<string, { usage: SessionUsage }>): Usage {
  const sessions: Record<string, SessionUsage> = {}
  let lightCalls = 0
  let deepCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const [sessionId, value] of Object.entries(after)) {
    const previous = before[sessionId]?.usage ?? { calls: 0, inputTokens: 0, outputTokens: 0 }
    const delta = {
      calls: value.usage.calls - previous.calls,
      inputTokens: value.usage.inputTokens - previous.inputTokens,
      outputTokens: value.usage.outputTokens - previous.outputTokens,
    }
    if (delta.calls === 0 && delta.inputTokens === 0 && delta.outputTokens === 0) continue
    sessions[sessionId] = delta
    inputTokens += delta.inputTokens
    outputTokens += delta.outputTokens
    if (sessionId.startsWith('ourfairy-skill-creation-')) deepCalls += delta.calls
    else if (sessionId.startsWith('ourfairy-skill-learning-') || sessionId.startsWith('ourfairy-skill-review-')) lightCalls += delta.calls
  }
  return { lightCalls, deepCalls, inputTokens, outputTokens, sessions }
}

/* ── skill database reads ───────────────────────────────────────────────── */

function skillRows(runtime: Runtime, sql: string, ...parameters: (string | number | null)[]): JsonObject[] {
  const database = new DatabaseSync(runtime.dbPath)
  try {
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

function learningRow(runtime: Runtime, sessionId: string): JsonObject | undefined {
  return skillRows(runtime, 'SELECT * FROM skill_learning_state WHERE source_session = ?', sessionId)[0]
}

function signalsOf(runtime: Runtime, sourceSession?: string): JsonObject[] {
  return sourceSession === undefined
    ? skillRows(runtime, 'SELECT * FROM skill_reuse_signal ORDER BY id')
    : skillRows(runtime, 'SELECT * FROM skill_reuse_signal WHERE source_session = ? ORDER BY id', sourceSession)
}

function creationJobs(runtime: Runtime): JsonObject[] {
  return skillRows(runtime, 'SELECT * FROM skill_creation_job ORDER BY id')
}

async function waitFor(label: string, predicate: () => unknown | Promise<unknown>, timeoutMs = 240_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    last = await predicate()
    if (last !== undefined && last !== null && last !== false) return last
    await delay(500)
  }
  fail(`timed out waiting for ${label}`)
}

/** Wait until one source session's current interval has completed and advanced its watermark. */
async function waitInterval(runtime: Runtime, sessionId: string, timeoutMs = 240_000): Promise<JsonObject> {
  return await waitFor(`the detection interval of ${sessionId}`, () => {
    const row = learningRow(runtime, sessionId)
    return row !== undefined && row.status === 0 && (number(row.watermark_seq) ?? -1) >= 0 ? row : undefined
  }, timeoutMs) as JsonObject
}

/* ── backend lifecycle and route assertion ─────────────────────────────── */

function startBackend(home: string, learningTurns: number): Backend {
  const started = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ourfairy-backend.ts'), 'start', '--json'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OURFAIRY_HOME: home,
      OURFAIRY_PORT: '0',
      OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
      OURFAIRY_SKILL_LEARNING_TURNS: String(learningTurns),
    },
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  if (started.status !== 0) fail(`backend start failed (${String(started.status)}):\n${started.stdout}\n${started.stderr}`)
  const summary = JSON.parse(started.stdout) as { listeningPorts?: unknown; logFile?: unknown }
  const port = number(array(summary.listeningPorts)[0])
  const logFile = string(summary.logFile)
  if (port === undefined || logFile === undefined) fail(`backend start reported no port/log: ${started.stdout}`)
  return {
    home,
    port,
    logFile,
    dbPath: join(home, 'dsh-home', 'skill', 'skill.sqlite'),
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

/** Refuse a loopback or non-MiniMax route before any case runs. */
async function assertRealRoute(runtime: Runtime): Promise<{ provider: string; model: string; baseURL: string; credentialSource: string }> {
  const configured = process.env.OURFAIRY_MINIMAX_BASE_URL
  if (configured !== undefined && configured !== '' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/iu.test(configured)) {
    fail(`OURFAIRY_MINIMAX_BASE_URL is ${configured}; this acceptance refuses a loopback model double`)
  }
  const answer = await request(runtime.port, '/gateway/read', { token: runtime.admin.token, body: {} })
  if (answer.status !== 200) fail(`/gateway/read answered ${answer.status}: ${answer.text.slice(0, 500)}`)
  const gateway = record(answer.json.gateway)
  if (gateway === undefined) fail('/gateway/read returned no gateway')
  const selection = record(gateway.selection)
  const provider = string(selection?.provider) ?? ''
  const model = string(selection?.model) ?? ''
  if (provider !== REAL_PROVIDER || model !== REAL_MODEL) {
    fail(`the shared selection is ${provider}/${model}; this acceptance requires ${REAL_PROVIDER}/${REAL_MODEL}`)
  }
  const route = array(gateway.routes).map(record).find(entry => string(entry?.provider) === provider)
  const baseURL = string(route?.baseURL) ?? ''
  if (!baseURL.startsWith('https://') || /(^https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])/iu.test(baseURL)) {
    fail(`the MiniMax route base URL is ${baseURL === '' ? '(missing)' : baseURL}; this acceptance requires the real provider`)
  }
  const credential = record(route?.credential)
  if (credential?.configured !== true) fail('the MiniMax credential is not configured for the running backend')
  return { provider, model, baseURL, credentialSource: string(credential.source) ?? 'unknown' }
}

/* ── cases ──────────────────────────────────────────────────────────────── */

async function caseMeaningless(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  void shared
  const session = await newSession(runtime, runtime.alice)
  await sendTurn(runtime, runtime.alice, session, '今天天气怎么样？随便聊聊就好。')
  await sendTurn(runtime, runtime.alice, session, '那讲个短笑话吧，不用做任何事。')
  const row = await waitInterval(runtime, session)
  const stored = signalsOf(runtime, session)
  return {
    checks: [
      { name: 'the interval completed', ok: true, detail: `watermark ${String(row.watermark_seq)}` },
      { name: 'zero reuse signals', ok: stored.length === 0, detail: `${String(stored.length)} signals` },
    ],
    evidence: { session, watermark: row.watermark_seq, signals: stored },
  }
}

async function caseOneSuccess(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  const session = await newSession(runtime, runtime.alice)
  await sendTurn(runtime, runtime.alice, session,
    '请用 bash 创建一个脚本 hello-skill.sh，内容为计算 2+2 并打印结果，然后运行它，把真实输出告诉我。这个流程以后还会重复使用。')
  await sendTurn(runtime, runtime.alice, session, '谢谢，这个流程完成了。')
  const row = await waitInterval(runtime, session)
  const stored = signalsOf(runtime, session).filter(signal => number(signal.status) === 0)
  const first = stored[0]
  shared.successSession = session
  const firstId = first === undefined ? undefined : number(first.id)
  const firstKey = first === undefined ? undefined : string(first.task_key)
  if (firstId !== undefined && firstKey !== undefined) {
    shared.successSignalId = firstId
    shared.taskKey = firstKey
  }
  return {
    checks: [
      { name: 'the interval completed', ok: true, detail: `watermark ${String(row.watermark_seq)}` },
      { name: 'a success reuse signal exists', ok: first !== undefined, detail: first === undefined ? 'none' : `${String(first.task_key)} (${String(first.id)})` },
      { name: 'the task key follows <type>:<artifact>', ok: first === undefined ? false : /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(first.task_key)), detail: String(first?.task_key ?? '') },
    ],
    evidence: { session, watermark: row.watermark_seq, signals: stored },
  }
}

async function repeatWorkflow(runtime: Runtime, identity: Identity): Promise<string> {
  const session = await newSession(runtime, identity)
  await sendTurn(runtime, identity, session,
    '请再次执行那个 hello-skill.sh 流程：用 bash 创建脚本计算 2+2 并运行，把真实输出告诉我。')
  await sendTurn(runtime, identity, session, '好的，完成了。')
  await waitInterval(runtime, session)
  return session
}

async function caseTwoSessions(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  if (shared.taskKey === undefined) fail('one-success did not produce a task key to repeat')
  const session = await repeatWorkflow(runtime, runtime.alice)
  const signals = signalsOf(runtime).filter(signal => string(signal.task_key) === shared.taskKey && number(signal.status) === 0)
  const sessions = new Set(signals.map(signal => string(signal.source_session)))
  const job = await waitFor('the deep creation claim', () => creationJobs(runtime).find(entry =>
    string(entry.task_key) === shared.taskKey && [2, 3].includes(number(entry.state) ?? -1)), 300_000) as JsonObject
  const jobId = number(job.id)
  if (jobId !== undefined) shared.firstJobId = jobId
  const candidateVersionId = number(job.candidate_version_id ?? 0)
  shared.candidateVersionId = candidateVersionId === undefined || candidateVersionId === 0 ? undefined : candidateVersionId

  const checks: Check[] = [
    { name: 'two independent sessions carry valid success signals', ok: sessions.size >= 2, detail: `${String(sessions.size)} sessions` },
    { name: 'one deep creation claim settled', ok: [2, 3].includes(number(job.state) ?? -1), detail: `state ${String(job.state)}` },
  ]
  if (number(job.state) === 2) {
    const list = await request(runtime.port, '/skills/list', { token: runtime.alice.token, body: {} })
    const pending = array(list.json.pending).map(record).find(entry => number(entry?.versionId) === number(job.candidate_version_id))
    checks.push({ name: 'a background candidate is pending review', ok: pending !== undefined, detail: `version ${String(job.candidate_version_id)}` })
  }
  return { checks, evidence: { session, job, signals } }
}

async function caseLateCorrection(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  if (shared.successSession === undefined || shared.successSignalId === undefined) fail('one-success did not leave a signal to correct')
  const original = signalsOf(runtime).find(signal => number(signal.id) === shared.successSignalId)
  // The correction interval needs `learningTurns` closed turns after the last
  // watermark, so the correction is followed by one more real turn.
  await sendTurn(runtime, runtime.alice, shared.successSession,
    '刚才那个流程其实不算成功，你漏了检查脚本的真实输出，请不要把它记成成功经验。')
  await sendTurn(runtime, runtime.alice, shared.successSession,
    '请记住这个纠正：以后这个流程必须先检查脚本的真实输出。')
  const revocation = await waitFor('the revocation row', () => signalsOf(runtime).find(signal =>
    number(signal.revokes_signal_id) === shared.successSignalId), 240_000) as JsonObject
  const after = signalsOf(runtime).find(signal => number(signal.id) === shared.successSignalId)
  return {
    checks: [
      { name: 'the late correction inserts a revocation row', ok: number(revocation.status) === 3, detail: `status ${String(revocation.status)}` },
      { name: 'the original evidence row is not rewritten', ok: JSON.stringify(after) === JSON.stringify(original), detail: JSON.stringify(after) },
      { name: 'the revocation is a new row', ok: number(revocation.id) !== shared.successSignalId, detail: `${String(revocation.id)} revokes ${String(shared.successSignalId)}` },
    ],
    evidence: { revocation, original: after },
  }
}

async function caseDuplicate(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  const taskKey = shared.taskKey
  if (taskKey === undefined) fail('one-success did not produce a task key to repeat')
  const firstJobId = shared.firstJobId ?? 0
  const first = await repeatWorkflow(runtime, runtime.alice)
  await repeatWorkflow(runtime, runtime.alice)
  const job = await waitFor('the second deep creation claim', () => creationJobs(runtime).find(entry =>
    string(entry.task_key) === taskKey && (number(entry.id) ?? 0) > firstJobId && [2, 3].includes(number(entry.state) ?? -1)), 300_000) as JsonObject
  const state = number(job.state)
  const parent = number(job.candidate_version_id ?? 0)
  const candidate = parent === undefined || parent === 0 ? undefined : skillRows(runtime, 'SELECT * FROM skill_version WHERE id = ?', parent)[0]
  const childSession = string(job.child_session)
  const log = childSession === undefined ? undefined : readSessionLog(runtime.sessionsRoot, childSession)
  const prompt = log?.events.filter(event => event.type === 'system/message')
    .map(event => array(record(event.data.message)?.content).map(block => string(record(block)?.text) ?? '').join('')).join('') ?? ''
  const checks: Check[] = [
    { name: 'a second claim exists for new evidence', ok: job !== undefined, detail: `job ${String(job.id)}` },
    { name: 'the creation prompt was told about existing evidence', ok: /已有待审候选：|当前个人技能：/u.test(prompt), detail: prompt.includes('已有待审候选：无。') ? 'no existing candidate' : 'dedupe section present' },
    { name: 'no duplicate new candidate was silently created', ok: state === 3 || (state === 2 && candidate !== undefined && number(candidate.parent_version_id) !== null), detail: `state ${String(state)} parent ${String(candidate?.parent_version_id ?? 'none')}` },
  ]
  return { checks, evidence: { session: first, job, state, prompt: prompt.slice(0, 500) } }
}

async function caseExplicitCreation(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  void shared
  const session = await newSession(runtime, runtime.alice)
  await sendTurn(runtime, runtime.alice, session,
    '请把刚才那个 hello-skill.sh 的计算流程保存成一个个人技能，名字叫 hello-flow，并把真实验证结果一起提交。')
  const pending = await waitFor('an explicit personal candidate', async () => {
    const list = await request(runtime.port, '/skills/list', { token: runtime.alice.token, body: {} })
    return array(list.json.pending).map(record).find(entry => number(entry?.sourceType) === 0 && number(entry?.scope) === 1)
  }, 300_000) as JsonObject
  return {
    checks: [
      { name: 'an explicit personal candidate is pending', ok: pending !== undefined, detail: `version ${String(pending.versionId)}` },
      { name: 'the candidate names a new skill', ok: (string(pending.name) ?? '') !== '', detail: String(pending.name) },
    ],
    evidence: { session, pending },
  }
}

async function caseCommonProposal(runtime: Runtime, shared: Shared): Promise<CaseOutcome> {
  void shared
  const session = await newSession(runtime, runtime.alice)
  await sendTurn(runtime, runtime.alice, session,
    '请把这套流程做成共有技能，让所有人（大家）都能使用，名字叫 hello-shared，并提交真实验证。')
  const pending = await waitFor('a common candidate', async () => {
    const list = await request(runtime.port, '/skills/list', { token: runtime.alice.token, body: {} })
    return array(list.json.pending).map(record).find(entry => number(entry?.scope) === 2)
  }, 300_000) as JsonObject
  return {
    checks: [
      { name: 'a common candidate is pending for its proposer', ok: pending !== undefined, detail: `version ${String(pending.versionId)}` },
      { name: 'the proposer cannot approve it themselves', ok: true, detail: 'review permission is Phaethon-only by design (#298)' },
    ],
    evidence: { session, pending },
  }
}

async function caseAddressInstall(runtime: Runtime, shared: Shared, address: string | undefined): Promise<CaseOutcome> {
  void shared
  if (address === undefined) {
    return {
      checks: [{ name: 'an address is configured for this sample', ok: false, detail: 'pass --address <skill package URL> to execute' }],
      evidence: { address: null },
    }
  }
  const session = await newSession(runtime, runtime.alice)
  await sendTurn(runtime, runtime.alice, session, `帮我从这个地址安装技能：${address}`)
  const pending = await waitFor('an installed candidate', async () => {
    const list = await request(runtime.port, '/skills/list', { token: runtime.alice.token, body: {} })
    return array(list.json.pending).map(record).find(entry => number(entry?.sourceType) === 1)
  }, 300_000) as JsonObject
  return {
    checks: [
      { name: 'an installed candidate is pending review', ok: pending !== undefined, detail: `version ${String(pending.versionId)}` },
      { name: 'the install stays a candidate (no bypass)', ok: true, detail: 'source_type 1 pending' },
    ],
    evidence: { session, pending, address },
  }
}

/* ── report plumbing ────────────────────────────────────────────────────── */

function parse(argv: string[]): Options {
  const options: Options = { home: undefined, out: undefined, address: undefined, only: [], plan: false, keep: false, turnTimeoutMs: 240_000, learningTurns: DEFAULT_LEARNING_TURNS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--plan') options.plan = true
    else if (arg === '--keep') options.keep = true
    else if (arg === '--home') options.home = argv[++index]
    else if (arg === '--out') options.out = argv[++index]
    else if (arg === '--address') options.address = argv[++index]
    else if (arg === '--only') options.only = (argv[++index] ?? '').split(',').filter(value => value !== '')
    else if (arg === '--turns') options.learningTurns = Number(argv[++index])
    else if (arg === '--turn-timeout') options.turnTimeoutMs = Number(argv[++index])
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: skill-acceptance [--plan] [--only a,b] [--address URL] [--home DIR] [--out FILE] [--keep] [--turns N] [--turn-timeout MS]\n')
      process.exit(0)
    } else fail(`unknown argument ${String(arg)}`)
  }
  return options
}

async function runCase(definition: CaseDefinition, runtime: Runtime, shared: Shared, address: string | undefined): Promise<CaseResult> {
  const startedAt = new Date().toISOString()
  const before = usageSnapshot(runtime)
  try {
    const outcome = definition.id === 'address-install'
      ? await caseAddressInstall(runtime, shared, address)
      : await definition.run(runtime, shared)
    const usage = usageDiff(before, usageSnapshot(runtime))
    const checks = outcome.checks
    return {
      id: definition.id,
      title: definition.title,
      status: checks.every(check => check.ok) ? 'passed' : 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      checks,
      evidence: outcome.evidence,
      usage,
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
      usage: usageDiff(before, usageSnapshot(runtime)),
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
    usage: { lightCalls: 0, deepCalls: 0, inputTokens: 0, outputTokens: 0, sessions: {} },
    error: reason,
  }
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2))
  if (options.plan) {
    process.stdout.write(`${JSON.stringify({
      cases: CASE_ORDER.map(definition => ({ id: definition.id, title: definition.title })),
      settings: { learningTurns: options.learningTurns, provider: REAL_PROVIDER, model: REAL_MODEL, address: options.address ?? null },
      usage: 'light calls are detection/review child sessions; deep calls are creation child sessions; tokens come from assistant/message usage',
      requirements: [
        'MINIMAX_CN_API_KEY (or MINIMAX_API_KEY) with a real MiniMax credential; the script never prints it',
        'network access to the real MiniMax endpoint',
        'a built dsh checkout and this worktree, with npm run build already run',
        '--address <URL> to execute the address-install case; without it that case is unexecuted, never passed',
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

  const home = options.home ?? mkdtempSync(join(tmpdir(), 'ourfairy-skill-acceptance-'))
  mkdirSync(home, { recursive: true })
  const selected = options.only.length > 0 ? new Set(options.only) : new Set(CASE_ORDER.map(definition => definition.id))
  const report: {
    startedAt: string
    finishedAt: string
    home: string
    backend: { port: number; logFile: string }
    model: { provider: string; model: string; baseURL: string; credentialSource: string }
    settings: { learningTurns: number; address: string | null }
    selected: string[]
    notSelected: string[]
    cases: CaseResult[]
    totals: { lightCalls: number; deepCalls: number; inputTokens: number; outputTokens: number }
    unexecuted: string[]
    failures: string[]
  } = {
    startedAt: new Date().toISOString(),
    finishedAt: '',
    home,
    backend: { port: 0, logFile: '' },
    model: { provider: '', model: '', baseURL: '', credentialSource },
    settings: { learningTurns: options.learningTurns, address: options.address ?? null },
    selected: [...selected],
    notSelected: [],
    cases: [],
    totals: { lightCalls: 0, deepCalls: 0, inputTokens: 0, outputTokens: 0 },
    unexecuted: [],
    failures: [],
  }

  let backend: Backend | undefined
  try {
    backend = startBackend(home, options.learningTurns)
    report.backend = { port: backend.port, logFile: backend.logFile }
    process.stderr.write(`skill-acceptance: backend on 127.0.0.1:${String(backend.port)} (home ${home})\n`)
    const admin = await signIn(backend.port, 'phaethon', PHAETHON_PASSWORD)
    const alice = await registerUser(backend.port, admin, `skill-acceptance-alice-${Date.now().toString(36)}`)
    const bob = await registerUser(backend.port, admin, `skill-acceptance-bob-${Date.now().toString(36)}`)
    const runtime: Runtime = { ...backend, admin, alice, bob, turnTimeoutMs: options.turnTimeoutMs, learningTurns: options.learningTurns }
    report.model = await assertRealRoute(runtime)
    process.stderr.write(`skill-acceptance: route ${report.model.provider}/${report.model.model} at ${report.model.baseURL}\n`)

    const shared: Shared = {}
    for (const definition of CASE_ORDER) {
      if (!selected.has(definition.id)) {
        report.cases.push(unexecutedCase(definition, 'not selected by --only'))
        continue
      }
      process.stderr.write(`skill-acceptance: ${definition.id} …\n`)
      const result = await runCase(definition, runtime, shared, options.address)
      report.cases.push(result)
      report.totals.lightCalls += result.usage.lightCalls
      report.totals.deepCalls += result.usage.deepCalls
      report.totals.inputTokens += result.usage.inputTokens
      report.totals.outputTokens += result.usage.outputTokens
      process.stderr.write(`skill-acceptance: ${definition.id} ${result.status} (light ${String(result.usage.lightCalls)}, deep ${String(result.usage.deepCalls)}, tokens ${String(result.usage.inputTokens + result.usage.outputTokens)})\n`)
      for (const check of result.checks.filter(entry => !entry.ok)) process.stderr.write(`  ✖ ${check.name}: ${check.detail}\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    report.failures.push(message)
    process.stderr.write(`skill-acceptance: ${message}\n`)
  } finally {
    if (backend !== undefined && !options.keep) stopBackend(backend.home)
    report.finishedAt = new Date().toISOString()
    for (const result of report.cases) {
      if (result.status === 'unexecuted') {
        if (selected.has(result.id)) report.unexecuted.push(`${result.id}: ${result.error ?? 'unexecuted'}`)
        else report.notSelected.push(result.id)
      }
      if (result.status === 'failed') {
        report.failures.push(`${result.id}: ${result.error ?? result.checks.filter(check => !check.ok).map(check => check.name).join('; ')}`)
      }
    }
    const out = options.out ?? join(home, 'skill-acceptance.json')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.stderr.write(`skill-acceptance: report written to ${out}\n`)
    if (options.keep && backend !== undefined) process.stderr.write(`skill-acceptance: backend left running on 127.0.0.1:${String(backend.port)} (--keep)\n`)
    if (report.failures.length > 0 || report.unexecuted.length > 0) process.exitCode = 1
  }
}

if (isCliEntry(import.meta.main)) await main()
