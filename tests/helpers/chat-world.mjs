/**
 * The fake native world the chat read tests drive `SessionRuntime` over.
 *
 * One fake `Session` per id whose states are folded by the real projection
 * units, a counted `sessionQuery.observeSession` read (the seed seam) and a
 * counted `sessionPersistence` handle (the cold page seam). Every fake read is
 * recorded, so a test observes the runtime's read behaviour at the native seams
 * production uses instead of inspecting a window shape.
 *
 * The suites import `./dsh-peers.mjs` first, as its own comment requires; this
 * module imports it too, so loading the helper never depends on the caller's
 * import order. The product modules are dynamic imports for the same reason:
 * the resolver hook must be registered before they resolve.
 */
import './dsh-peers.mjs'

const units = await import('../../backend/chat/dist/units.js')
const { SessionRuntime } = await import('../../backend/chat/dist/runtime.js')

/** The owner every fake session belongs to. */
export const OWNER = { shortId: 1 }
/** The session id the single-session tests use. */
export const SESSION = 'session-1'

/** One product user message, in the native message shape the transcript unit reads. */
export const userMessage = (id, text, rpcId) => ({ id, role: 'user', content: [{ type: 'text', text }],
  source: { kind: 'user', rpcId } })
/** One assistant message, in the native message shape the transcript unit reads. */
export const assistantMessage = (id, text) => ({ id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } })
/** One native job row, in the shape the work unit reads. */
export const job = (overrides = {}) => ({ id: 'job-1', owner: SESSION, kind: 'task', label: 'work', status: 'running',
  startedAt: 10, output: { earliest: 0, total: 0 }, ...overrides })

/** Resolve on the next macrotask: enough for the runtime's microtask publications. */
export const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred() {
  let resolve
  const promise = new Promise(settle => { resolve = settle })
  return { promise, resolve }
}

/** The native Agent's scoped context, with only the surfaces the runtime uses. */
function makeChannel() {
  const handlers = new Map()
  const api = {
    systemPrompt: { section() {} },
    on(name, handler) {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
      return () => handlers.set(name, list.filter(item => item !== handler))
    },
    emit(name, ...args) { for (const handler of handlers.get(name) ?? []) handler(...args) },
  }
  return { api }
}

/**
 * The fake native jobs registry behind `ctx.jobs`: the process generation,
 * the live job list and the read/get/kill seams `jobs.ts` uses, each recording
 * its calls. `list` mirrors the registry contract (caller-owned plus unowned);
 * tests set the live list, the output a read returns and the kill result.
 */
function makeJobs() {
  const calls = { list: [], get: [], readAt: [], kill: [] }
  const subscriptions = []
  const outputs = new Map()
  let liveJobs = []
  let killResult = 'requested'
  const find = (id, caller) => liveJobs.find(item => item.id === id && (caller === undefined || item.owner === caller))
  const unknown = (method, id) => new Error(`fake jobs.${method}: no live job ${id}`)
  const registry = {
    generation: 'g1',
    events: {
      subscribe(filter, listener) {
        const subscription = { filter, listener }
        subscriptions.push(subscription)
        return () => {
          const at = subscriptions.indexOf(subscription)
          if (at >= 0) subscriptions.splice(at, 1)
        }
      },
    },
    list(caller) {
      calls.list.push({ caller })
      return liveJobs.filter(item => caller === undefined ? item.owner === undefined : item.owner === caller || item.owner === undefined)
    },
    get(id, caller) {
      calls.get.push({ id, caller })
      const item = find(id, caller)
      if (item === undefined) throw unknown('get', id)
      return item
    },
    readAt(id, from, caller) {
      calls.readAt.push({ id, from, caller })
      const item = find(id, caller)
      if (item === undefined) throw unknown('readAt', id)
      return outputs.get(id) ?? { chunks: [], next: item.output.total, lossy: false }
    },
    kill(id, caller, reason) {
      calls.kill.push({ id, caller, reason })
      if (find(id, caller) === undefined) throw unknown('kill', id)
      return killResult
    },
  }
  return {
    registry, calls,
    setLiveJobs(next) { liveJobs = next },
    setGeneration(value) { registry.generation = value },
    setOutput(id, output) { outputs.set(id, output) },
    setKillResult(value) { killResult = value },
  }
}

/**
 * A fake host: one Session per id, a registry that applies the real units
 * eagerly, one counted `observeSession` read and one counted persistence
 * handle.
 *
 * `reads` records every `sessionQuery.observeSession` call (the window seed);
 * `pageReads` records every `sessionPersistence` range and `pageOpens` every
 * handle open, so the page tests can assert the exact range a page asks for.
 * `jobCalls` records the native jobs registry reads and controls task access
 * makes, and `flushes` every durability barrier.
 */
export function makeWorld() {
  const sessions = new Map()
  const channels = new Map()
  const reads = []
  const pageReads = []
  const pageOpens = []
  const flushes = []
  const jobs = makeJobs()
  let gate = null

  function sessionOf(id = SESSION) {
    let session = sessions.get(id)
    if (session === undefined) {
      session = {
        id, seq: 0, events: [], header: { id, version: 4, createdAt: 1, isSeeded: false }, inheritedEventCount: 0, states: {},
        append(type, data, extra = {}) {
          const event = { seq: this.seq, type, time: this.seq, data, ...extra }
          this.seq += 1
          this.events.push(event)
          for (const definition of [units.transcriptDefinition, units.workDefinition]) {
            this.states[definition.key] = definition.apply(this.states[definition.key], event)
          }
          channels.get(this.id)?.api.emit('session/event', this, event)
          return event
        },
      }
      session.states[units.transcriptDefinition.key] = units.transcriptDefinition.init(session.header, 0)
      session.states[units.workDefinition.key] = units.workDefinition.init(session.header, 0)
      sessions.set(id, session)
    }
    return session
  }

  const listeners = new Map()
  const emitGlobal = (name, payload) => {
    for (const handler of listeners.get(name) ?? []) handler(payload)
  }
  const ctx = {
    // The native history seam observes agent frames through the host context.
    on(name, handler) {
      const list = listeners.get(name) ?? []
      list.push(handler)
      listeners.set(name, list)
      return () => listeners.set(name, list.filter(item => item !== handler))
    },
    effect(execute) { return execute() },
    ourfairySessions: { async read() {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
    agents: {
      async resume({ resumeSessionId, setup }) {
        const session = sessionOf(resumeSessionId)
        const channel = makeChannel()
        const agent = { id: resumeSessionId, session, status: 'idle', followups: [], cancelled: false,
          followup(message) { this.followups.push(message) },
          cancel() { this.cancelled = true } }
        setup(channel.api, agent)
        const emit = channel.api.emit.bind(channel.api)
        channel.api.emit = (name, ...args) => {
          emit(name, ...args)
          if (name === 'agent/assistant-stream') emitGlobal(name, { agent, frame: args[0].frame })
          if (name === 'agent/disposed') emitGlobal(name, { agent })
        }
        channels.set(resumeSessionId, channel)
        return agent
      },
    },
    sessionQuery: {
      async observeSession(id) {
        reads.push(id)
        const session = sessionOf(id)
        // Snapshot after a delayed gate so the seed can see an event that also
        // reached the buffer; the merge must drop that duplicate.
        if (gate !== null) await gate.promise
        gate = null
        const cut = session.seq
        const events = session.events.slice(0, cut)
        return { events, cursor: cut - 1, [Symbol.dispose]() {} }
      },
    },
    sessionPersistence: {
      async open(sessionId, access) {
        pageOpens.push({ sessionId, access })
        return {
          async read(offset, length) {
            pageReads.push({ offset, length })
            const session = sessionOf(sessionId)
            return { eventState: 'owned', events: session.events.slice(offset, offset + length) }
          },
          async close() {},
        }
      },
    },
    sessions: { async flush(session) { flushes.push(session.id) } },
    sessionProjections: { stateOf: (session, key) => session.states[key] },
    jobs: jobs.registry,
  }

  return {
    ctx, session: sessionOf, reads, pageReads, pageOpens, flushes,
    channel: id => channels.get(id),
    jobCalls: jobs.calls,
    setLiveJobs: jobs.setLiveJobs,
    setJobGeneration: jobs.setGeneration,
    setJobOutput: jobs.setOutput,
    setKillResult: jobs.setKillResult,
    /** Make the next observation read wait until `releaseRead`, exposing the seed race. */
    delayNextRead() { gate = deferred() },
    releaseRead() { gate?.resolve() },
  }
}

/** Open the runtime on a world that already holds its log. */
export async function openWorld(world, sessionId = SESSION) {
  const runtime = new SessionRuntime(world.ctx)
  const state = await runtime.open(OWNER, sessionId)
  return { runtime, state }
}

/** Dense revision/index counters per attempt: the native fold rejects a repeat. */
const streamCursors = new Map()
export function startStream(world, attemptId = 'attempt-1', sessionId = SESSION) {
  streamCursors.set(attemptId, { revision: 1, nextIndex: 0 })
  world.channel(sessionId).api.emit('agent/assistant-stream', { frame: { type: 'start', attemptId, revision: 1, turn: 1, step: 1 } })
}
export function chunkStream(world, text, attemptId = 'attempt-1', sessionId = SESSION) {
  const cursor = streamCursors.get(attemptId) ?? { revision: 1, nextIndex: 0 }
  cursor.revision += 1
  const index = cursor.nextIndex
  cursor.nextIndex += 1
  streamCursors.set(attemptId, cursor)
  world.channel(sessionId).api.emit('agent/assistant-stream', { frame: { type: 'chunk', attemptId, revision: cursor.revision, index, time: 0,
    chunk: { type: 'text-delta', index, text } } })
}
export function endStream(world, seq, attemptId = 'attempt-1', sessionId = SESSION) {
  const cursor = streamCursors.get(attemptId) ?? { revision: 1, nextIndex: 0 }
  world.channel(sessionId).api.emit('agent/assistant-stream', { frame: { type: 'end', attemptId, revision: cursor.revision + 1, index: 0,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq } } })
}
