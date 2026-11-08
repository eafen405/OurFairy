/**
 * Ticket #300: background workflow learning through the real composition.
 *
 * Every case boots the shipped launcher, the real API server, the real SQLite
 * store and real child agents. One model double speaks the Messages protocol
 * and distinguishes the main session from the detection/review/creation
 * children by the structured tools each child was given; the child's own
 * requests prove its tools, prompt material and model route, and the durable
 * session log proves its header. Expected rows and seq positions come from the
 * design (design.md D21), never from re-running the implementation.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'
import { after, before, describe, test } from 'node:test'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const { readSkillFrontmatter } = await import('../backend/skill-creator/dist/package.js')

const home = makeHome('ourfairy-skill-learning-')
const password = 'skill-learning-password'
const skillRoot = join(home, 'dsh-home', 'skill')
const databasePath = join(skillRoot, 'skill.sqlite')
const sessionsRoot = join(home, 'dsh-home', 'sessions')

let model
let port
let admin
let alice
let bob
let run
let requestNo = 0
let callNo = 0

/** What the double should do for the next child requests; reset per case. */
const script = {
  /** The detection submission for one request; undefined ends the child's turn. */
  detection: () => ({ signals: [] }),
  /** Fail this many detection child requests with an HTTP error. */
  failDetection: 0,
  /** The review decision list, or undefined to fail the review child. */
  review: undefined,
  /** The creation child's action list; each entry is `[tool, args]`, then a text reply. */
  creation: [],
  /** Fail this many creation child requests with an HTTP error. */
  failCreation: 0,
  /** Hold the main-session request that carries this text until the test releases it. */
  holdText: undefined,
  /** Hold the next detection child request until the test releases it. */
  holdDetection: undefined,
  /**
   * Answer main-session requests with plain text only. The default emits one
   * harmless `bash` step on the first request of each turn so the interval has
   * a real tool call and the detection engine's no-action pre-check lets it
   * through; tests about that pre-check set this.
   */
  plainMain: false,
}

/** A detection callback that submits one payload once per run, and again after a recovery instruction. */
function submittedOnce(submission) {
  return body => {
    const blocks = (body?.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : [])
    const lastText = blocks.filter(block => block.type === 'text').at(-1)?.text ?? ''
    const used = blocks.filter(block => block.type === 'tool_use' && block.name === 'submit_signals').length
    return used === 0 || /上一轮检测没有完成/u.test(lastText) ? submission : undefined
  }
}

/**
 * A detection callback that submits the next list per request.
 *
 * The index counts the child's own submit_signals tool calls, and a recovery
 * instruction restarts from the next unused list, so a refused-then-resumed
 * run submits again instead of ending silently.
 */
function submissions(...lists) {
  return body => {
    const blocks = (body?.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : [])
    const lastText = blocks.filter(block => block.type === 'text').at(-1)?.text ?? ''
    const used = blocks.filter(block => block.type === 'tool_use' && block.name === 'submit_signals').length
    const retry = /上一轮检测没有完成/u.test(lastText)
    const index = retry ? Math.min(used, lists.length - 1) : used
    return index < lists.length ? { signals: lists[index] } : undefined
  }
}

/** Every request the double saw, classified. */
const seen = {
  main: [],
  detection: [],
  review: [],
  creation: [],
}

/** A promise resolved by the test to release a held main request. */
let heldRelease
/** Whether the double is currently holding its one scripted request. */
let held = false
/** Release for a held detection child request. */
let heldDetection

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** The background creation attempt ceiling the bundle defaults to. */
const CREATION_ATTEMPT_CAP = 5

/**
 * Run one write against the live SQLite file through a second connection.
 *
 * The tests only use this where a durable state cannot be forced through the
 * model double: an interrupted claim's persisted attempt count, a persisted
 * running interval whose child is gone, and a settled review decision.
 */
function exec(sql, ...parameters) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA busy_timeout = 3000')
    database.prepare(sql).run(...parameters)
  } finally {
    database.close()
  }
}

/** Start the backend on the shared isolated home; `extraEnv` overrides row config env. */
function startRun(extraEnv = {}) {
  return runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-learning-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    OURFAIRY_SKILL_LEARNING_TURNS: '1',
    OURFAIRY_SKILL_LEARNING_MODEL: 'MiniMax-M3.1-Flash',
    ...extraEnv,
  })
}

/** Stop the running backend and start a fresh one on the same home. */
async function restartBackend(extraEnv = {}) {
  const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(stopped.code, 0, describeRun('stop', stopped))
  run = await startRun(extraEnv)
  port = startedPort(run)
}

/** One product POST, asserting the HTTP status through the shared helper. */
function request(path, token, body = {}) {
  return httpJson(port, path, { token, body })
}

/** Poll one predicate until it answers a truthy value or the deadline passes. */
async function waitFor(label, predicate, timeout = 25_000) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    last = await predicate()
    if (last) return last
    await delay(25)
  }
  let diagnostics
  try {
    diagnostics = {
      jobs: creationJobs(),
      signals: signals(),
      states: rows('SELECT * FROM skill_learning_state'),
      seenCreation: seen.creation.length,
      seenDetection: seen.detection.length,
    }
  } catch {
    diagnostics = undefined
  }
  assert.fail(`timed out waiting for ${label}; last value ${JSON.stringify(last)}; diagnostics ${JSON.stringify(diagnostics)}`)
}

/** The rows the SQLite file holds, through a second connection. */
function rows(sql, ...parameters) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

/** All text blocks of one model request, joined. */
function requestText(body) {
  return (body?.messages ?? []).flatMap(message => {
    const content = message.content
    if (typeof content === 'string') return [content]
    return Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text) : []
  }).join('\n')
}

/** The system prompt text of one model request. */
function systemText(body) {
  const system = body?.system
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return ''
  return system.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** Dedicated children do not inherit unrelated native tool guidance. */
function assertNoInheritedToolGuidance(body) {
  const prompt = systemText(body)
  assert.equal(prompt.includes('Check the [exit code: N] marker'), false, 'bash operations guidance is excluded')
  assert.equal(prompt.includes('Track every background job id you start'), false, 'jobs operations guidance is excluded')
}

/** How many assistant tool_use blocks one request already carries. */
function toolUses(body) {
  return (body?.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block.type === 'tool_use').length
}

/** One chat turn; answers its held release function when the double was told to hold. */
async function sendPlain(identity, sessionId, text) {
  const seenIds = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `learning-${++requestNo}`, text })
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seenIds.has(message.messageId) && message.text.startsWith('REPLY:'))
    if (reply) return projection
    if (projection.error) assert.fail(`the chat failed before the reply: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the reply never returned to ${sessionId}`)
}

/** One turn, sent without waiting for its reply (used while holding a turn open). */
async function sendWithoutWaiting(identity, sessionId, text) {
  await request('/chat/send', identity.token, { sessionId, requestId: `learning-${++requestNo}`, text })
}

/** The text of one tool_result block, which the wire may carry as a string or text blocks. */
function toolResultText(result) {
  const content = result?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
  return ''
}

/** The JSON value of the latest tool result block in a request, if it parses. */
function latestToolResult(body) {
  const blocks = (body?.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : [])
  const result = blocks.filter(block => block.type === 'tool_result').at(-1)
  if (result === undefined) return undefined
  try {
    return JSON.parse(toolResultText(result))
  } catch {
    return undefined
  }
}

/** The first contributing source session a read_evidence metadata answer listed. */
function firstEvidenceSession(body) {
  const result = latestToolResult(body)
  const sessions = Array.isArray(result?.sessions) ? result.sessions : []
  return sessions[0]?.sourceSession
}

/** One SSE stream emitting a single tool call (or a text reply). */
function answer(response, action) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: 'skill-learning-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  if (action !== undefined) {
    const callId = `mock-call-${++callNo}`
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: callId, name: action[0], input: {} } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(action[1]) } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
  } else {
    const reply = `REPLY:${seen.main.length}`
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  }
  emit({ type: 'message_stop' })
  response.end()
}

/** Answer one request with an HTTP error, as a refused model turn. */
function refuse(response) {
  response.writeHead(400, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'the double refuses this turn' } }))
}

/** The creation child's next scripted action, or undefined to end its turn. */
function nextCreationAction(body) {
  const action = script.creation[toolUses(body)]
  return typeof action === 'function' ? action(body) : action
}

before(async () => {
  model = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool.name) : []
    if (tools.includes('submit_signals')) {
      seen.detection.push({ body, tools })
      if (script.failDetection > 0) {
        script.failDetection -= 1
        refuse(response)
        return
      }
      if (script.holdDetection !== undefined) {
        script.holdDetection = false
        await new Promise(resolve => { heldDetection = resolve })
      }
      const submission = script.detection(body)
      answer(response, submission === undefined ? undefined : ['submit_signals', submission])
      return
    }
    if (tools.includes('submit_review')) {
      seen.review.push({ body, tools })
      if (script.review === undefined) {
        refuse(response)
        return
      }
      answer(response, toolUses(body) === 0 ? ['submit_review', { decisions: script.review }] : undefined)
      return
    }
    if (tools.includes('read_evidence')) {
      seen.creation.push({ body, tools })
      if (script.failCreation > 0) {
        script.failCreation -= 1
        refuse(response)
        return
      }
      answer(response, nextCreationAction(body))
      return
    }
    seen.main.push({ body, tools })
    // Keep the main-session branch observable but realistic: one real tool
    // call per turn unless the case is about a text-only interval. The engine's
    // no-action pre-check would otherwise complete every test interval before
    // a child ran.
    const action = script.plainMain || toolUses(body) > 0
      ? undefined
      : ['bash', { command: 'printf skill-learning-action', description: 'do the reusable step' }]
    if (script.holdText !== undefined && !held && requestText(body).includes(script.holdText)) {
      // Hold exactly the first request whose conversation carries the marker;
      // later turns repeat earlier messages, so the marker is consumed once.
      script.holdText = undefined
      held = true
      await new Promise(resolve => { heldRelease = resolve })
      held = false
    }
    answer(response, action)
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')

  run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-learning-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    OURFAIRY_SKILL_LEARNING_TURNS: '1',
    OURFAIRY_SKILL_LEARNING_MODEL: 'MiniMax-M3.1-Flash',
  })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'learning-alice', password)
  bob = await registerUser(port, admin.token, 'learning-bob', password)
})

after(async () => {
  try {
    const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
    assert.equal(stopped.code, 0, describeRun('stop', stopped))
  } catch {
    // A failing assertion may have stopped the backend already.
  }
  if (model !== undefined) await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

/* ── the durable session-log reader the child header assertion needs ────── */

/** Frames of a concatenated zstd file, or the torn start offset. */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    const magic = buffer.readUInt32LE(offset)
    if (magic !== 0xFD2FB528) return { frames, tornStart: start }
    offset += 4
    if (buffer.length - offset < 1) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const frameContentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = frameContentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << frameContentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('reserved zstd block type')
      offset += blockType === 0x01 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return { frames, tornStart: undefined }
}

/** The path of one session's durable log. */
function findSessionLog(root, sessionId, depth = 0) {
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

/** One child session's durable header. */
function sessionHeader(sessionId) {
  const file = findSessionLog(sessionsRoot, sessionId)
  assert.ok(file, `the durable log of ${sessionId} must exist`)
  const bytes = readFileSync(file)
  let text
  if (file.endsWith('.zstd')) {
    const { frames, tornStart } = scanZstdFrames(bytes)
    assert.equal(tornStart, undefined, 'the child log must be a complete zstd sequence')
    text = frames.map(frame => zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8')).join('')
  } else {
    text = bytes.toString('utf8')
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const event = JSON.parse(line)
    if (event.type === 'session') return event
  }
  assert.fail('the child log carries no session header')
}

/** Reset the double's script and the observed requests between cases. */
function resetScript(overrides = {}) {
  script.detection = () => ({ signals: [] })
  script.failDetection = 0
  script.review = undefined
  script.creation = []
  script.failCreation = 0
  script.holdText = undefined
  script.holdDetection = undefined
  script.plainMain = false
  held = false
  heldRelease = undefined
  heldDetection = undefined
  seen.detection.length = 0
  seen.review.length = 0
  seen.creation.length = 0
  Object.assign(script, overrides)
}

/** Create one user session. */
async function newSession(identity) {
  return (await request('/sessions/create', identity.token)).session.id
}

/** Rows of the memory database (the maintenance engine's own state). */
function memoryRows(sql, ...parameters) {
  const path = join(home, 'dsh-home', 'memory', 'memory.sqlite')
  if (!existsSync(path)) return []
  const database = new DatabaseSync(path)
  try {
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

/** The newest learning state for one source session, or undefined. */
function learningState(sessionId) {
  return rows('SELECT * FROM skill_learning_state WHERE source_session = ?', sessionId)[0]
}

/** Every reuse signal, newest last. */
function signals() {
  return rows('SELECT * FROM skill_reuse_signal ORDER BY id')
}

/** Every creation claim, newest last. */
function creationJobs() {
  return rows('SELECT * FROM skill_creation_job ORDER BY id')
}

describe('background detection', () => {
  test('one quiet turn opens one child: ownerless header, only submit_signals, light route, frozen material', async () => {
    resetScript({ detection: submissions([{ taskKey: 'release-checklist:changelog', status: 0 }]) })
    const session = await newSession(alice)
    await sendPlain(alice, session, '请把发布清单的流程跑一遍，先把 changelog 整理出来')

    const detection = await waitFor('one detection child request', () => seen.detection[0])
    assert.ok(seen.detection.length >= 1)
    assert.deepEqual(detection.tools.sort(), ['submit_signals'], 'the detection child sees only its structured tool')
    assert.equal(detection.body.model, 'MiniMax-M3.1-Flash', 'the detection child uses the light route')
    assert.match(systemText(detection.body), /技能复用信号的轻量检测/u)
    assert.match(requestText(detection.body), /请把发布清单的流程跑一遍/u, 'the frozen interval user message is the child material')
    assert.match(systemText(detection.body), /现有任务键：无/u)
    assertNoInheritedToolGuidance(detection.body)

    const state = await waitFor('the completed detection interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    })
    const stored = await waitFor('one persisted success signal', () => signals()[0])
    assert.equal(stored.task_key, 'release-checklist:changelog')
    assert.equal(stored.status, 0)
    assert.equal(stored.source_session, session)
    assert.equal(stored.owner_short_id, alice.user.shortId)
    assert.ok(stored.evidence_end_seq <= state.watermark_seq, 'the evidence never reaches past the frozen cut')
    assert.ok(state.child_session.startsWith('ourfairy-skill-learning-'))

    // The child's durable header: a parent session and a preset, but no owner.
    const header = sessionHeader(state.child_session)
    assert.equal(header.parentSession, session, 'the child points at its source session')
    assert.equal(header.agentPreset, 'ourfairy:skill-learning')
    assert.equal(header.origin, 'subagent')
    assert.equal(header.owner, undefined, 'the learning child is ownerless in its header')

    // Neither background engine treats the child as a source: it has no owner
    // and carries the learning preset, so memory's maintenance watch skips it
    // and the learning engine's source predicate does too.
    assert.deepEqual(memoryRows('SELECT * FROM maintenance_state WHERE source_session = ?', state.child_session), [],
      'memory maintenance never observes a learning child')
    assert.deepEqual(rows('SELECT * FROM skill_learning_state WHERE source_session = ?', state.child_session), [],
      'a learning child never becomes a learning source')

    // The child stays out of the user's session list and cannot be read as one.
    const list = await request('/sessions/list', alice.token)
    assert.equal(list.sessions.some(entry => entry.id === state.child_session), false)
    const read = await httpJson(port, '/sessions/read', { token: alice.token, body: { sessionId: state.child_session }, expect: false })
    assert.equal(read.status, 403)
  })

  test('zero signals complete the interval and advance the watermark without rows', async () => {
    resetScript({ detection: submissions([]) })
    const session = await newSession(bob)
    await sendPlain(bob, session, '随便聊两句，今天天气不错')
    const state = await waitFor('the zero-signal interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    })
    assert.equal(signals().filter(row => row.source_session === session).length, 0)
    assert.ok(state.watermark_seq > 0)
    assert.ok(seen.detection.length >= 1, 'the child still ran and submitted an empty list')
  })

  test('a text-only interval with no revocable signal completes without a child', async () => {
    resetScript({ plainMain: true })
    const session = await newSession(bob)
    await sendPlain(bob, session, '今天天气不错，随便聊两句')
    const state = await waitFor('the pre-checked interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    })
    assert.equal(seen.detection.length, 0,
      'no detection child is created for an interval with no tool call and no revocable signal')
    assert.equal(signals().filter(row => row.source_session === session).length, 0)
    assert.ok(state.watermark_seq > 0, 'the cheap pre-check still advances the watermark')
  })

  test('a failed detection keeps the watermark and resumes the same child', async () => {
    resetScript({ detection: submissions([{ taskKey: 'incident:postmortem-draft', status: 0 }]), failDetection: 1 })
    const session = await newSession(alice)
    await sendPlain(alice, session, '写一份事故复盘草稿')

    const failed = await waitFor('the failed interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 2 ? row : undefined
    })
    assert.equal(failed.watermark_seq, -1, 'a failure keeps the watermark')
    const childSession = failed.child_session
    assert.ok(childSession)

    const resumed = await waitFor('the resumed child request', () => seen.detection[1], 30_000)
    // The resumed child is the same durable session: its request carries the
    // previous material plus the recovery instruction only in the durable user message.
    assert.match(requestText(resumed.body), /上一轮检测没有完成/u)
    assert.equal(systemText(resumed.body).includes('上一轮检测没有完成'), false,
      'the recovery instruction is not duplicated into the resumed system prompt')
    const state = await waitFor('the resumed completion', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    })
    assert.equal(state.child_session, childSession, 'the same child owns the resumed interval')
    assert.equal(signals().filter(row => row.source_session === session).length, 1)

    const detectionTools = seen.detection.map(entry => entry.tools.sort().join(','))
    assert.ok(detectionTools.every(tools => tools === 'submit_signals'), 'the resumed child keeps exactly its own tool')
  })

  test('a running source session blocks detection until it is idle', async () => {
    resetScript({ detection: submissions([{ taskKey: 'build:release-notes', status: 0 }]), holdText: '第二条还在进行中' })
    const session = await newSession(alice)
    // Queue both turns before the first reply lands: the second turn keeps the
    // source running when the first one closes, so the threshold is met while
    // the source is not silent.
    await sendWithoutWaiting(alice, session, '先生成发布说明')
    await sendWithoutWaiting(alice, session, '第二条还在进行中')
    await waitFor('the held second turn', () => heldRelease !== undefined && held)
    await delay(2_500)
    assert.equal(seen.detection.length, 0, 'a running source never starts a detection child')
    heldRelease?.()
    const delayed = await waitFor('the delayed detection child', () => seen.detection[0], 30_000)
    assert.match(requestText(delayed.body), /先生成发布说明/u, 'the first interval material carries the closed turns before its cut')
    // The newly idle source opens one interval covering both closed turns; a
    // later turn is the *next* interval and never enters the frozen material.
    await sendPlain(alice, session, '第三条属于下一区间')
    const next = await waitFor('the next interval child', () => seen.detection.find(entry =>
      requestText(entry.body).includes('第三条属于下一区间')), 30_000)
    assert.equal(requestText(next.body).includes('先生成发布说明'), false, 'the frozen cut separates the intervals')
    assert.equal(requestText(next.body).includes('第二条还在进行中'), false)
  })

  test('the detection prompt carries the existing task keys and a malformed key is refused before any row', async () => {
    resetScript({ detection: submissions([{ taskKey: 'Bad Key', status: 0 }], [{ taskKey: 'release-checklist:notes', status: 0 }]) })
    const session = await newSession(alice)
    await sendPlain(alice, session, '把发布清单再跑一遍')

    const state = await waitFor('the interval after the malformed submission', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    })
    assert.ok(seen.detection.length >= 3, 'the child was told the key was invalid and submitted again')
    assert.match(systemText(seen.detection[0].body), /release-checklist:changelog/u, 'the bounded existing key list is in the prompt')
    assert.match(systemText(seen.detection[0].body), /<task-type>:<artifact>/u, 'the grammar is stated in the prompt')
    const stored = signals().filter(row => row.source_session === session)
    assert.equal(stored.length, 1)
    assert.equal(stored[0].task_key, 'release-checklist:notes')
    assert.ok(state.watermark_seq > 0)
  })

  test('an ambiguous signal is resolved by one independent review child and then counts as success', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'review:success', status: 2 }]),
      review: [{ index: 1, status: 0 }],
    })
    const session = await newSession(alice)
    await sendPlain(alice, session, '把审查流程走一遍看看结果')

    const review = await waitFor('one review child request', () => seen.review[0])
    assert.deepEqual(review.tools.sort(), ['submit_review'], 'the review child sees only its structured judgement tool')
    assert.equal(review.body.model, 'MiniMax-M3.1-Flash', 'the review child uses the light route')
    assert.match(systemText(review.body), /独立的轻量审查子代理/u)
    assert.match(systemText(review.body), /review:success/u, 'the review prompt names the candidate task key')
    assertNoInheritedToolGuidance(review.body)

    const stored = await waitFor('the reviewed success signal', () => {
      const row = signals().find(entry => entry.source_session === session)
      return row !== undefined && row.status === 0 ? row : undefined
    })
    assert.equal(stored.task_key, 'review:success')
    assert.equal(seen.creation.length, 0, 'one session never reaches the two-session creation threshold')
  })

  test('a failure signal never counts toward the two-session creation threshold', async () => {
    resetScript({ detection: submissions([{ taskKey: 'failure:only', status: 1 }]) })
    const failedSession = await newSession(alice)
    await sendPlain(alice, failedSession, '这次发布清单做失败了')
    await waitFor('the failure signal', () => signals().find(row => row.source_session === failedSession))
    assert.equal(signals().find(row => row.source_session === failedSession).status, 1)

    script.detection = submissions([{ taskKey: 'failure:only', status: 0 }])
    const successSession = await newSession(alice)
    await sendPlain(alice, successSession, '另一个会话把发布清单做成功了')
    await waitFor('the lone success signal', () => signals().find(row => row.source_session === successSession))
    await delay(2_500)
    assert.equal(creationJobs().filter(row => row.task_key === 'failure:only').length, 0,
      'one success plus one failure is not two independent successful sessions')
    assert.equal(seen.creation.length, 0)
  })

  test('an uncertain review is stored as uncertain and never triggers creation', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'review:uncertain', status: 2 }]),
      review: [{ index: 1, status: 2 }],
    })
    const session = await newSession(alice)
    await sendPlain(alice, session, '有个任务结果不太确定')

    const stored = await waitFor('the uncertain signal', () => {
      const row = signals().find(entry => entry.source_session === session)
      return row !== undefined ? row : undefined
    })
    assert.equal(stored.status, 2, 'a still-uncertain judgement stays uncertain')
    assert.equal(seen.creation.length, 0, 'uncertain evidence never triggers automatic creation')
    // A failure signal and a revocation are the other non-triggering statuses;
    // the store test pins their validity rule.
  })

  test('two independent sessions reach the threshold: one claim, one creation child, explicit no improvement', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'release-notes:publish', status: 0 }]),
      creation: [['finish_no_improvement', { reason: '当前个人技能已经覆盖同一工作流，没有可证明的改进' }]],
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '先按发布清单跑一次')
    await waitFor('the first session signal', () => signals().find(row => row.source_session === first))
    const second = await newSession(alice)
    await sendPlain(alice, second, '再按发布清单跑一次')

    const creation = await waitFor('one creation child request', () => seen.creation[0], 30_000)
    assert.deepEqual(creation.tools.sort(),
      ['finish_no_improvement', 'read_evidence', 'run_verification', 'submit_candidate'],
      'the creation child gets exactly the four cross-session tools')
    assert.equal(creation.body.model, 'MiniMax-M3.1-Flash', 'the creation child uses the deployment route, not the light detection route')
    const prompt = systemText(creation.body)
    assert.match(prompt, /release-notes:publish/u)
    assert.match(prompt, /已有待审候选：/u)
    assert.match(prompt, /当前个人技能：/u)
    const shippedBody = readSkillFrontmatter(join('backend', 'skill-creator', 'bundled', 'skill-creator')).body
    assert.ok(prompt.includes(shippedBody), 'the complete shipped Skill Creator body is reused without excerpting')
    assert.match(prompt, /skill_manage、inspect、review 与等待用户决定的交互步骤均由主会话执行/u,
      'interactive creation and review stay in the main session')
    assert.ok(prompt.indexOf('你是后台技能创建子代理') > prompt.indexOf('# Skill Creator'),
      'the background-specific four-tool contract follows the complete interactive guidance')
    assertNoInheritedToolGuidance(creation.body)
    assert.match(requestText(creation.body), /后台技能创建任务/u)

    // The second session's detection prompt reused the key the first wrote.
    const secondDetection = seen.detection.at(-1)
    assert.match(systemText(secondDetection.body), /- release-notes:publish/u)

    const job = await waitFor('the no-improvement claim outcome', () => creationJobs().find(row => row.task_key === 'release-notes:publish' && row.state === 3))
    assert.equal(job.attempts, 1)
    const contributing = signals().filter(row => row.task_key === 'release-notes:publish')
    assert.equal(contributing.length, 2)
    assert.equal(new Set(contributing.map(row => row.source_session)).size, 2)
    assert.equal(job.through_signal_id, Math.max(...contributing.map(row => row.id)))
    assert.equal(signals().some(row => row.processing === 2 && row.creation_job_id === job.id), true, 'the claim marks its evidence used')

    const header = sessionHeader(job.child_session)
    assert.equal(header.parentSession, second, 'the creation child points at the newest contributing source')
    assert.equal(header.agentPreset, 'ourfairy:skill-learning')
    assert.equal(header.owner, undefined, 'the creation child stays ownerless in its header')

    // Detection still owns its watermarks: both intervals completed.
    assert.ok(learningState(first).watermark_seq > 0)
    assert.ok(learningState(second).watermark_seq > 0)
  })

  test('a background candidate reaches the pending list with the system-recorded verification', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'release-checklist:artifact', status: 0 }]),
      creation: [
        ['read_evidence', {}],
        body => ['read_evidence', { sourceSession: firstEvidenceSession(body) }],
        ['submit_candidate', {
          files: [
            { path: 'SKILL.md', content: '---\nname: background-checklist\ndescription: Use when producing a release checklist from changelog evidence.\n---\n\n# Release checklist\n\n1. Read the changelog.\n2. Run the checks.\n' },
            { path: 'references/guide.md', content: 'GUIDE: the steps\n' },
          ],
          scenarios: [{ name: 'reads the package', command: 'test -f references/guide.md', uses: ['references/guide.md'] }],
          evidence: [{ kind: 'session', ref: 'two successful release checklist sessions' }],
        }],
        ['run_verification', {}],
      ],
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '发布清单：先整理 changelog')
    const second = await newSession(alice)
    await sendPlain(alice, second, '发布清单：再整理一次 changelog')

    const evidence = await waitFor('the creation evidence read', () => seen.creation[1], 30_000)
    assert.match(JSON.stringify(latestToolResult(evidence.body)), /"sourceSession"/u)
    const submitted = await waitFor('the candidate submission request', () => seen.creation[2], 30_000)
    assert.ok(submitted)
    const verified = await waitFor('the verification request', () => seen.creation[3], 30_000)
    assert.ok(verified)

    const job = await waitFor('the candidate claim outcome', () => creationJobs().find(row => row.task_key === 'release-checklist:artifact' && row.state === 2), 30_000)
    assert.ok(job.candidate_version_id, 'the claim names the candidate')
    const version = rows('SELECT * FROM skill_version WHERE id = ?', job.candidate_version_id)[0]
    assert.equal(version.status, 0, 'the candidate is pending, not approved')
    assert.equal(version.source_type, 2, 'the version records background provenance')
    assert.match(version.package_path, /^candidates\//u)
    const provenance = JSON.parse(version.source_location)
    assert.equal(provenance.background.taskKey, 'release-checklist:artifact')
    assert.equal(provenance.background.creationJobId, job.id)
    assert.equal(provenance.background.sourceSessions.length, 2)
    const report = JSON.parse(version.verification)
    assert.equal(report.complete, true)
    assert.equal(report.executed.length, 1)
    assert.equal(report.executed[0].command, 'test -f references/guide.md')
    assert.equal(report.executed[0].exitCode, 0)
    assert.ok(report.executed[0].environment.cwd.includes(`${join(skillRoot, 'verify')}`))

    // The pending candidate appears through the existing client pending state.
    const list = await request('/skills/list', alice.token)
    const pending = list.pending.find(entry => entry.versionId === job.candidate_version_id)
    assert.ok(pending, `the background candidate is in /skills/list pending: ${JSON.stringify(list.pending)}`)
    assert.equal(pending.name, 'background-checklist')
    assert.equal(pending.sourceType, 2)
    assert.equal(pending.nextActions.join(','), 'approve,request_changes,reject')
    assert.ok(list.pendingCount >= 1)
    assert.equal(list.skills.some(entry => entry.name === 'background-checklist'), false, 'a pending candidate is not in the selection pool')
  })

  test('a changed candidate that only reuses the parent report is never settled', async () => {
    // A background revision of a real approved row: the child must be able to
    // name a current parent, so the row is seeded directly (the review path has
    // its own tests). Its package bytes are absent on purpose: a parent package
    // that cannot be read makes the reuse plan rerun every scenario, which is
    // exactly the report this case then overwrites with the pre-fix shape.
    const owner = alice.user.shortId
    const now = Date.now()
    const parentName = 'settle-reuse-parent'
    exec(`INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?, ?, ?)`, parentName, owner, owner, owner, now, now)
    const parentSkillId = rows('SELECT id FROM skill WHERE name = ?', parentName)[0].id
    exec(`INSERT INTO skill_version
      (skill_id, package_path, manifest, manifest_hash, core_characters, source_type, status,
       created_by, created_at, updated_at)
      VALUES (?, ?, '[]', ?, 1000, 5, 3, ?, ?, ?)`,
    parentSkillId, `versions/${parentSkillId}/seed-parent`, 'seed-parent-hash', owner, now, now)
    const parentVersionId = rows('SELECT id FROM skill_version WHERE skill_id = ? AND status = 3', parentSkillId)[0].id
    exec('UPDATE skill SET current_version_id = ? WHERE id = ?', parentVersionId, parentSkillId)

    resetScript({
      detection: submissions([{ taskKey: 'settle:reuse', status: 0 }]),
      creation: [
        ['submit_candidate', {
          files: [{ path: 'SKILL.md', content: `---\nname: ${parentName}\ndescription: Use when settling a changed candidate.\n---\n\n# Changed body\n\nThe parent body is different, so this content changed.\n` }],
          scenarios: [{ name: 'reuse', command: 'true' }],
          parentVersionId,
          targetBenefit: 'keep the reusable command',
          evidence: [{ kind: 'session', ref: 'two background sessions succeeded' }],
        }],
        ['run_verification', {}],
        () => {
          // The real verification recorded a complete report; rewrite it to the
          // pre-fix shape a previous build could have stored: changed bytes whose
          // report only carries the parent's run and no execution of its own.
          const job = creationJobs().find(row => row.task_key === 'settle:reuse')
          assert.ok(job?.candidate_version_id, 'the child submitted a candidate before verifying it')
          const stored = JSON.parse(rows('SELECT verification FROM skill_version WHERE id = ?', job.candidate_version_id)[0].verification)
          assert.equal(stored.executed.length, 1, 'the real verification ran the declared scenario')
          exec('UPDATE skill_version SET verification = ? WHERE id = ?', JSON.stringify({
            ...stored,
            executed: [],
            reused: stored.executed.map(record => ({ ...record, reusedFrom: parentVersionId })),
          }), job.candidate_version_id)
          return undefined
        },
      ],
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '结算复用：第一个会话')
    const second = await newSession(alice)
    await sendPlain(alice, second, '结算复用：第二个会话')

    const failed = await waitFor('the claim refused by its reuse-only report', () =>
      creationJobs().find(row => row.task_key === 'settle:reuse' && row.state === 4), 40_000)
    assert.equal(failed.attempts, 1)
    assert.ok(failed.candidate_version_id, 'the child submitted a draft before verification')
    const draft = rows('SELECT * FROM skill_version WHERE id = ?', failed.candidate_version_id)[0]
    assert.equal(draft.status, 0, 'the claim never settles a candidate the approval gate would refuse')
    assert.equal(draft.parent_version_id, parentVersionId, 'the candidate really revises the parent')
    const report = JSON.parse(draft.verification)
    assert.deepEqual([report.executed.length, report.reused.length], [0, 1],
      'the stored report is the reuse-only shape the settle decision must refuse')

    // Spend the retry budget so this claim does not relaunch into later cases.
    exec('UPDATE skill_creation_job SET attempts = ? WHERE id = ?', CREATION_ATTEMPT_CAP, failed.id)
  })

  test('a failed creation retries only its claim, never the detection watermarks', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'incident:retry', status: 0 }]),
      creation: [['finish_no_improvement', { reason: '已有候选覆盖，重试后明确无改进' }]],
      failCreation: 1,
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '事故复盘：先跑一次')
    const second = await newSession(alice)
    await sendPlain(alice, second, '事故复盘：再跑一次')

    const failed = await waitFor('the failed claim', () => creationJobs().find(row => row.task_key === 'incident:retry' && row.state === 4), 30_000)
    assert.equal(failed.attempts, 1)
    assert.equal(learningState(first).status, 0, 'detection is not blocked by a creation failure')
    assert.equal(learningState(second).status, 0)
    const watermarkFirst = learningState(first).watermark_seq
    const watermarkSecond = learningState(second).watermark_seq

    const settled = await waitFor('the retried claim', () => creationJobs().find(row => row.task_key === 'incident:retry' && row.state === 3), 30_000)
    assert.ok(settled.attempts >= 2, 'the retry counted its attempt on the same claim')
    assert.equal(settled.id, failed.id, 'the retry keeps the claim row')
    assert.equal(learningState(first).watermark_seq, watermarkFirst, 'the retry never rolls a detection watermark back')
    assert.equal(learningState(second).watermark_seq, watermarkSecond)
    assert.ok(seen.creation.length >= 2, 'the creation child was resumed')
    const resumed = seen.creation.at(-1)
    assert.match(requestText(resumed.body), /上一轮创建没有完成/u,
      'the durable user message carries the creation recovery instruction')
    assert.equal(systemText(resumed.body).includes('上一轮创建没有完成'), false,
      'the creation recovery instruction is not duplicated into the resumed system prompt')
  })

  test('a late correction inside a later interval revokes the earlier success and the old evidence is not rewritten', async () => {
    resetScript({ detection: submissions([{ taskKey: 'deploy:hotfix', status: 0 }]) })
    const session = await newSession(alice)
    await sendPlain(alice, session, '按热修流程部署一次')
    const original = await waitFor('the first success signal', () => signals().find(row => row.source_session === session))

    // The next interval carries the user's correction; the detection prompt
    // lists the earlier success so the child can revoke it by id. The
    // correction is text-only, which the no-action pre-check must still send:
    // a revocable signal is exactly the case that pre-check must not drop.
    script.plainMain = true
    script.detection = submittedOnce({ signals: [{ taskKey: 'deploy:hotfix', status: 3, revokesSignalId: original.id }] })
    await sendPlain(alice, session, '刚才那个热修流程不对，你漏了回滚步骤，别记成成功')
    const revocation = await waitFor('the revocation row', () => signals().find(entry => entry.revokes_signal_id === original.id))
    assert.equal(revocation.status, 3)
    assert.equal(revocation.source_session, session)
    assert.equal(revocation.task_key, original.task_key)
    assert.ok(seen.detection.length >= 2)
    assert.match(systemText(seen.detection.at(-1).body), new RegExp(`可撤销的现有成功信号[\\s\\S]*信号 ${original.id}`, 'u'),
      'the later interval names the revocable earlier signal in its prompt')

    const unchanged = signals().find(row => row.id === original.id)
    assert.equal(unchanged.status, 0, 'the original evidence row is never rewritten')
    assert.equal(unchanged.evidence_start_seq, original.evidence_start_seq)
    assert.equal(unchanged.evidence_end_seq, original.evidence_end_seq)

    // A second session's success is the only valid evidence left: one session,
    // so no claim is made and no candidate is produced. This new session has
    // no revocable signal, so it needs a real tool call to pass the pre-check.
    script.plainMain = false
    script.detection = submissions([{ taskKey: 'deploy:hotfix', status: 0 }])
    const other = await newSession(alice)
    await sendPlain(alice, other, '另一个会话成功走完热修流程')
    await waitFor('the second session signal', () => signals().find(row => row.source_session === other))
    await delay(2_500)
    const claims = creationJobs().filter(row => row.task_key === 'deploy:hotfix')
    assert.equal(claims.length, 0, 'one valid session after a revocation is below the two-session threshold')
    assert.equal(seen.creation.length, 0)
  })

  test('the two-session threshold never crosses users: another owner evidence does not claim mine', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'review:summary', status: 0 }]),
      creation: [['finish_no_improvement', { reason: '同一用户已有覆盖，没有改进' }]],
    })
    const bobFirst = await newSession(bob)
    await sendPlain(bob, bobFirst, '写审查小结')
    const bobSecond = await newSession(bob)
    await sendPlain(bob, bobSecond, '再写一次审查小结')
    const aliceOnly = await newSession(alice)
    await sendPlain(alice, aliceOnly, '我也写审查小结')

    const bobJob = await waitFor('the other owner claim', () => creationJobs().find(row => row.task_key === 'review:summary' && row.owner_short_id === bob.user.shortId && row.state === 3), 30_000)
    assert.ok(bobJob)
    await waitFor('this owner single-session signal', () => signals().find(row => row.source_session === aliceOnly))
    const keySignals = signals().filter(row => row.task_key === 'review:summary')
    assert.equal(keySignals.filter(row => row.owner_short_id === bob.user.shortId).length, 2)
    assert.equal(keySignals.filter(row => row.owner_short_id === alice.user.shortId).length, 1)
    assert.equal(creationJobs().filter(row => row.task_key === 'review:summary' && row.owner_short_id === alice.user.shortId).length, 0,
      'one session of another owner never claims')
  })

  test('two detections completing at once produce one claim and one creation child', async () => {
    // Two durable source sessions, each prepared by one settled interval. The
    // preparation intervals write a success signal of their own, which (a) gives
    // each later text-only workflow interval a revocable signal so it reaches a
    // detection child without depending on the one-tool-per-session double, and
    // (b) keeps the script swap from racing a still-pending preparation child.
    resetScript({
      // One success signal per preparation interval; submit exactly once per run
      // like a real child, or the double would loop on its own tool result.
      detection: body => {
        const blocks = (body?.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : [])
        const submitted = blocks.some(block => block.type === 'tool_use' && block.name === 'submit_signals')
        if (submitted) return undefined
        return {
          signals: [{
            taskKey: requestText(body).includes('第一个会话的准备') ? 'prep:one' : 'prep:two',
            status: 0,
          }],
        }
      },
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '并发工作流：第一个会话的准备')
    const second = await newSession(alice)
    await sendPlain(alice, second, '并发工作流：第二个会话的准备')
    await waitFor('both preparation intervals', () => {
      const firstRow = learningState(first)
      const secondRow = learningState(second)
      const prepSignals = signals().filter(row => row.task_key === 'prep:one' || row.task_key === 'prep:two')
      return firstRow?.status === 0 && firstRow.watermark_seq > 0
        && secondRow?.status === 0 && secondRow.watermark_seq > 0
        && prepSignals.length === 2 ? true : undefined
    }, 30_000)

    resetScript({
      detection: submissions([{ taskKey: 'parallel:workflow', status: 0 }]),
      creation: [['finish_no_improvement', { reason: '并发去重后没有新的改进' }]],
    })
    // Both sources finish their workflow turns in the same window, so both
    // intervals call the creation engine concurrently.
    await Promise.all([
      sendWithoutWaiting(alice, first, '并发工作流：第一个会话完成'),
      sendWithoutWaiting(alice, second, '并发工作流：第二个会话完成'),
    ])
    await waitFor('both parallel signals', () => {
      const stored = signals().filter(row => row.task_key === 'parallel:workflow')
      return stored.length === 2 ? stored : undefined
    }, 30_000)
    const job = await waitFor('the single parallel claim', () => creationJobs().find(row => row.task_key === 'parallel:workflow'))
    assert.equal(creationJobs().filter(row => row.task_key === 'parallel:workflow').length, 1, 'two concurrent evaluations produce one claim')
    assert.equal(job.attempts, 1)
    const settled = await waitFor('the parallel claim outcome', () => creationJobs().find(row => row.id === job.id && row.state === 3), 30_000)
    assert.ok(settled)
    assert.equal(new Set(signals().filter(row => row.task_key === 'parallel:workflow').map(row => row.source_session)).size, 2)
    assert.equal(creationJobs().filter(row => row.task_key === 'prep:one' || row.task_key === 'prep:two').length, 0,
      'the single-session preparation signals never claim')
  })

  test('a persisted running interval whose child session is gone is released and re-observed', async () => {
    resetScript({ detection: submissions([{ taskKey: 'missing:child', status: 0 }]) })
    const session = await newSession(bob)
    // Reproduce the crash shape memory maintenance already recovers from: a
    // running interval naming a child session that does not exist. The source
    // has no closed turn yet, so nothing claims before the injection.
    exec(`INSERT OR REPLACE INTO skill_learning_state
      (source_session, watermark_seq, cut_seq, last_closed_at, child_session, status, retry_at, attempts, updated_at)
      VALUES (?, -1, 5, 100, 'ourfairy-skill-learning-ghost', 1, NULL, 1, ?)`, session, Date.now())

    await sendPlain(bob, session, '检测子会话已经丢失的第一条工作流')
    // The resume path must notice the missing child and release the interval;
    // the same source is then observed again and a fresh interval settles.
    const state = await waitFor('the re-observed interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    }, 20_000)
    assert.notEqual(state.child_session, 'ourfairy-skill-learning-ghost', 'a fresh child owns the recovered interval')
    assert.equal(state.attempts, 0, 'a child that never existed does not spend the interval budget')
    assert.equal(signals().filter(row => row.source_session === session).length, 1)
    assert.ok(seen.detection.length >= 1, 'the source was observed again after the release')
  })

  test('a restart resumes the same failed detection child from durable state', async () => {
    resetScript({ detection: submissions([{ taskKey: 'restart:recovery', status: 0 }]), failDetection: 1 })
    const session = await newSession(alice)
    await sendPlain(alice, session, '重启恢复：先失败一次')
    const failed = await waitFor('the failed interval before the restart', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 2 ? row : undefined
    })
    const childBefore = failed.child_session
    assert.ok(childBefore)
    assert.equal(failed.watermark_seq, -1)

    // Stop the real backend and start it again on the same isolated home; the
    // learning row and the child's durable log are the only recovery state.
    const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
    assert.equal(stopped.code, 0, describeRun('stop', stopped))
    const restarted = await runBackendAsync(startArgs(), {
      OURFAIRY_HOME: home,
      OURFAIRY_PHAETHON_PASSWORD: password,
      MINIMAX_CN_API_KEY: 'mock-skill-learning-key',
      OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
      OURFAIRY_SKILL_LEARNING_TURNS: '1',
      OURFAIRY_SKILL_LEARNING_MODEL: 'MiniMax-M3.1-Flash',
    })
    port = startedPort(restarted)
    run = restarted

    const resumed = await waitFor('the resumed child after the restart', () => seen.detection.find(entry => requestText(entry.body).includes('上一轮检测没有完成')), 30_000)
    assert.ok(resumed)
    const completed = await waitFor('the recovered interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > 0 ? row : undefined
    }, 30_000)
    assert.equal(completed.child_session, childBefore, 'the restart resumes the same durable child')
    assert.equal(signals().filter(row => row.source_session === session).length, 1)
    const header = sessionHeader(childBefore)
    assert.equal(header.owner, undefined)
    assert.equal(header.parentSession, session)
  })

  test('the creation prompt carries the user\'s recently rejected skills as dedupe context', async () => {
    // A user refusal has to be visible to the deep-creation dedupe (E6): a
    // rejected workflow must not come back just because two more sessions
    // succeeded. The version row is seeded directly because the review path has
    // its own tests; here only the creation prompt's dedupe input matters.
    const owner = alice.user.shortId
    const now = Date.now()
    exec(`INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at)
      VALUES ('rejected-workflow', 1, ?, ?, ?, ?, ?)`, owner, owner, owner, now, now)
    const skillId = rows("SELECT id FROM skill WHERE name = 'rejected-workflow'")[0].id
    exec(`INSERT INTO skill_version
      (skill_id, package_path, manifest, manifest_hash, core_characters, source_type, status,
       reviewer, reviewed_at, review_note, created_by, created_at, updated_at)
      VALUES (?, 'candidates/rejected-workflow', '[]', 'seed-hash', 10, 2, 2, ?, ?, '用户不需要这个工作流', ?, ?, ?)`,
    skillId, owner, now, owner, now, now)

    resetScript({
      detection: submissions([{ taskKey: 'dedupe:rejected', status: 0 }]),
      creation: [['finish_no_improvement', { reason: '用户拒绝过同类工作流，没有可证明的改进' }]],
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '去重上下文：先跑一次')
    const second = await newSession(alice)
    await sendPlain(alice, second, '去重上下文：再跑一次')

    const creation = await waitFor('the creation child request', () => seen.creation[0], 30_000)
    const prompt = systemText(creation.body)
    assert.match(prompt, /用户最近拒绝\/要求修改的个人技能/u, 'the dedupe section names the refusal history')
    assert.match(prompt, /rejected-workflow/u, 'the rejected skill name reaches the child')
    assert.match(prompt, /已拒绝/u)
    assert.match(prompt, /用户不需要这个工作流/u, 'the recorded review reason reaches the child')
    const job = await waitFor('the no-improvement claim', () => creationJobs().find(row => row.task_key === 'dedupe:rejected' && row.state === 3), 30_000)
    assert.ok(job)
  })

  test('a revocation after the claim settles as no improvement and never names a candidate', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'revoked:claim', status: 0 }]),
      creation: [() => {
        // The claim already froze its two signals and the child is talking to
        // the model; the user's correction lands now. The child then ends with
        // plain text, so only the settlement recheck can notice the revocation.
        const victim = signals().find(row => row.task_key === 'revoked:claim')
        assert.ok(victim, 'the claim has a contributing signal to revoke')
        exec(`INSERT INTO skill_reuse_signal
          (owner_short_id, task_key, source_session, evidence_start_seq, evidence_end_seq, status,
           revokes_signal_id, judged_at, processing, created_at, updated_at)
          VALUES (?, ?, ?, 0, 1, 3, ?, ?, 3, ?, ?)`,
        victim.owner_short_id, victim.task_key, victim.source_session, victim.id, Date.now(), Date.now(), Date.now())
        return undefined
      }],
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '撤销窗口：第一个会话成功')
    const second = await newSession(alice)
    await sendPlain(alice, second, '撤销窗口：第二个会话成功')

    const job = await waitFor('the no-op claim after the revocation', () =>
      creationJobs().find(row => row.task_key === 'revoked:claim' && row.state === 3), 30_000)
    assert.equal(job.candidate_version_id, null, 'a revoked claim never names a candidate')
    assert.equal(rows('SELECT * FROM skill_version WHERE source_location LIKE ?', '%revoked:claim%').length, 0,
      'no draft was created for the invalidated claim')
    // Detection watermarks are never blocked by a claim that lost its evidence.
    assert.ok(learningState(first).watermark_seq > 0)
    assert.ok(learningState(second).watermark_seq > 0)
  })

  test('a failed verification keeps the claim retryable and the draft pending until the budget ends in terminal', async () => {
    resetScript({
      detection: submissions([{ taskKey: 'verify:failing', status: 0 }]),
      creation: [
        ['submit_candidate', {
          files: [{ path: 'SKILL.md', content: '---\nname: broken-verification\ndescription: Use when testing a failing verification report.\n---\n\n# Broken\n' }],
          scenarios: [{ name: 'always fails', command: 'exit 1' }],
          evidence: [{ kind: 'session', ref: 'two failing verification sessions' }],
        }],
        ['run_verification', {}],
      ],
    })
    const first = await newSession(alice)
    await sendPlain(alice, first, '验证必失败：第一个会话')
    const second = await newSession(alice)
    await sendPlain(alice, second, '验证必失败：第二个会话')

    // B2: a failed system verification is not a settle-able outcome; the claim
    // reports failed and the draft stays pending instead of becoming a dead
    // "candidate" the reviewer would see as settled.
    const failed = await waitFor('the claim failed by its verification', () =>
      creationJobs().find(row => row.task_key === 'verify:failing' && row.state === 4), 40_000)
    assert.equal(failed.attempts, 1)
    assert.ok(failed.candidate_version_id, 'the child submitted a draft before verification failed')
    const draft = rows('SELECT * FROM skill_version WHERE id = ?', failed.candidate_version_id)[0]
    assert.equal(draft.status, 0, 'the failed verification never settles a candidate')
    assert.equal(JSON.parse(draft.verification).complete, true, 'the report really was recorded')
    assert.equal(JSON.parse(draft.verification).failed.length, 1)

    // B1: the attempt budget is durable. Spend it down to the last run, so the
    // next failure must end terminal instead of retrying forever.
    exec('UPDATE skill_creation_job SET attempts = ? WHERE id = ?', CREATION_ATTEMPT_CAP - 1, failed.id)
    const terminal = await waitFor('the terminal claim', () =>
      creationJobs().find(row => row.id === failed.id && row.state === 5), 40_000)
    assert.equal(terminal.attempts, CREATION_ATTEMPT_CAP)
    assert.equal(terminal.next_retry_at, null)
    assert.equal(terminal.candidate_version_id, failed.candidate_version_id,
      'the claim still names the draft, but it settled terminal rather than candidate')
    assert.equal(rows('SELECT * FROM skill_version WHERE id = ?', failed.candidate_version_id)[0].status, 0,
      'the draft stays pending for the user to reject; the system does not silently decide it')

    // A terminal claim is not relaunched and spends no further attempt.
    await delay(3_000)
    const still = creationJobs().find(row => row.id === failed.id)
    assert.equal(still.state, 5)
    assert.equal(still.attempts, CREATION_ATTEMPT_CAP, 'a terminal claim never retries automatically')
  })

  test('a terminal claim is not relaunched by a restart', async () => {
    // The previous case leaves a terminal claim in the shared home; a restart
    // rebuilds every claim from durable state and must leave it exactly there.
    const before = creationJobs().find(row => row.task_key === 'verify:failing' && row.state === 5)
    assert.ok(before, 'the terminal claim from the previous case exists')
    const creationsBefore = seen.creation.length

    await restartBackend()

    await delay(3_500)
    const after = creationJobs().find(row => row.id === before.id)
    assert.equal(after.state, 5)
    assert.equal(after.attempts, before.attempts)
    assert.equal(after.next_retry_at, null)
    assert.equal(seen.creation.length, creationsBefore, 'a restart never relaunches a terminal claim')
  })

  test('a detection interval that spends its budget is given up and only a newer closed turn releases it', async () => {
    // A one-attempt budget makes the give-up deterministic without waiting for
    // four failed runs. The row is persisted, so the restart below must see the
    // same budget instead of starting over.
    await restartBackend({ OURFAIRY_SKILL_LEARNING_MAX_TURNS: '1' })
    resetScript({ detection: () => undefined, failDetection: 20 })
    const session = await newSession(alice)
    await sendPlain(alice, session, '检测预算会耗尽的第一个闭合回合')

    const gaveUp = await waitFor('the given-up interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 3 ? row : undefined
    }, 30_000)
    assert.equal(gaveUp.attempts, 1, 'one failed run with a one-attempt budget is given up')
    assert.equal(gaveUp.watermark_seq, -1, 'giving up never advances the watermark')
    assert.ok(gaveUp.cut_seq > 0, 'the abandoned cut stays frozen for the release rule')
    const cut = gaveUp.cut_seq
    const abandonedMaterial = /检测预算会耗尽的第一个闭合回合/u
    const detectionCount = () => seen.detection.filter(entry => abandonedMaterial.test(requestText(entry.body))).length
    assert.equal(detectionCount(), 1, 'the failed attempt created one detection child')

    // No reset-and-reclaim loop on the same cut: the old behaviour started a new
    // child every retry window, burning the deep route forever.
    await delay(3_500)
    assert.equal(detectionCount(), 1, 'a given-up interval never re-claims its own cut')

    // The budget is durable: a restart reads the same attempts and cut and does
    // not resume the abandoned child.
    await restartBackend({ OURFAIRY_SKILL_LEARNING_MAX_TURNS: '1' })
    await delay(3_000)
    const afterRestart = learningState(session)
    assert.deepEqual([afterRestart.status, afterRestart.attempts, afterRestart.cut_seq], [3, 1, cut],
      'a restart cannot reset the detection attempt budget')
    assert.equal(detectionCount(), 1, 'a restart does not resume a given-up interval')

    // Only a newer closed user turn is new evidence: it releases the source and
    // a fresh interval (with a fresh budget) settles.
    resetScript({ detection: submissions([{ taskKey: 'budget:recovered', status: 0 }]) })
    await sendPlain(alice, session, '新回合带来新的证据，释放这个源会话')
    const recovered = await waitFor('the released interval', () => {
      const row = learningState(session)
      return row !== undefined && row.status === 0 && row.watermark_seq > cut ? row : undefined
    }, 30_000)
    assert.equal(recovered.attempts, 0, 'the released interval starts with a fresh attempt budget')
    assert.ok(recovered.watermark_seq > cut, 'the new interval covers the newer closed turn')
    assert.ok(seen.detection.some(entry => requestText(entry.body).includes('新回合带来新的证据')),
      'a new closed turn starts a fresh detection child')
  })
})
