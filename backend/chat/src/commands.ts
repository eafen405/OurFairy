/** Two session operations over native maintenance and the existing ordered writer. */
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import { COMMAND_NAME, commandInput, commandInputSchema, commandResult } from './command-events.js'
import type { CommandInput, CommandResult } from './command-events.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { LiveSession, SessionOwner, SessionRuntime } from './runtime.js'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-token-meter'

// A source extension, not an event extension: native cold readers already know user/message.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'ourfairy-context-reset': { kind: 'ourfairy-context-reset'; commandId: CommandId }
  }
}

type Run = SessionEvent<'command/run'>
interface Snapshot extends CommandInput {
  sessionId: SessionId
  commandId: CommandId
  status: number
  acceptedSeq: number
  completedSeq?: number
  error?: CommandResult['error']
}
const busy = () => new SessionScopeError(409, 'chat/session-busy', '会话正在回复、有排队输入或未结束任务；请等待完成或停止后重试。')
const interrupted: CommandResult = { status: 5, error: { code: 1, message: '上次命令已中断，未重新执行；请用新请求显式重试。' } }

export class SessionCommands {
  /** Admission only; results and recovery always come from the session log. */
  #active = new Map<SessionId, { requestId: string; command: number }>()
  constructor(private ctx: Context, private runtime: SessionRuntime) {}

  async execute(owner: SessionOwner, body: Record<string, unknown>): Promise<Snapshot> {
    const parsed = commandInputSchema.safeParse(body)
    if (!parsed.success || !parsed.data.requestId.trim() || (body.uploadIds !== undefined && (!Array.isArray(body.uploadIds) || body.uploadIds.length !== 0))) {
      throw new SessionScopeError(400, 'chat/invalid-command', 'provide a stable requestId and command 1 (compact) or 2 (clear), without attachments')
    }
    const input = parsed.data
    const state = await this.runtime.open(owner, body.sessionId, { titleBackfill: false })
    const existing = this.#find(state, input.requestId)
    if (existing !== undefined) {
      if (commandInput(existing)?.command !== input.command) throw new SessionScopeError(409, 'chat/request-conflict', 'this requestId already names a different command')
      return (await this.#status(state, input.requestId)) as Snapshot
    }
    if (this.#active.has(state.sessionId) || this.runtime.sessionWritePending(state.sessionId)) throw busy()
    this.#checkIdle(state)
    // Claim before entering the promise queue; a simultaneous distinct command
    // must be refused immediately, never wait behind the summary model.
    this.#active.set(state.sessionId, input)
    const accepted = Promise.withResolvers<Snapshot>()
    void this.runtime.runSession(state.sessionId, async () => {
      try {
        this.#checkIdle(state)
        const agent = state.agent as Agent
        const commandId = CommandId(randomUUID())
        let run: Run | undefined
        // compactNow owns the native maintenance call. Its documented minimal
        // agent seam lets admission persist inside that same lease, without a
        // nested maintenance task or a gap between idle and accepted.
        const maintenance = <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
          try {
            return agent.runMaintenance(async signal => {
              this.#checkIdle(state)
              run = state.session.append('command/run', { commandId, name: COMMAND_NAME,
                args: JSON.stringify(input), source: { kind: 'user' } })
              await this.runtime.barrier(state)
              accepted.resolve(this.#snapshot(state, run))
              return task(signal)
            })
          } catch { throw busy() }
        }
        let result: CommandResult
        let sourceEventSeq: SessionSeq | undefined
        try {
          if (input.command === 1) {
            const compacted = await this.ctx.compaction.compactNow({ session: agent.session, options: agent.options, runMaintenance: maintenance }, new AbortController().signal, commandId)
            sourceEventSeq = compacted?.summarySeq
            result = { status: compacted === null ? 3 : 2 }
          } else {
            sourceEventSeq = await maintenance(async signal => this.#clear(state, commandId, signal))
            result = { status: 4 }
          }
        } catch (error) {
          if (run === undefined) throw busy()
          // A native flush error can follow a committed replacement. Recover
          // that effect before settling, so retry never erases later input.
          const effect = this.#effect(state, run)
          sourceEventSeq = effect?.seq
          result = effect?.result ?? { status: 5, error: { code: 2, message: error instanceof Error ? error.message : String(error) } }
        }
        if (run === undefined) throw new Error('native command maintenance did not enter')
        this.#done(state, run, result, sourceEventSeq)
        await this.runtime.barrier(state)
        accepted.resolve(this.#snapshot(state, run))
      } finally {
        this.#active.delete(state.sessionId)
      }
    }).catch(error => {
      accepted.reject(error)
      this.ctx.logger.warn(`chat command: ${String(error)}`)
    })
    return accepted.promise
  }

  async status(owner: SessionOwner, body: Record<string, unknown>): Promise<Snapshot | null> {
    if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128) {
      throw new SessionScopeError(400, 'chat/invalid-command', 'provide the original stable requestId')
    }
    return this.#status(await this.runtime.open(owner, body.sessionId, { titleBackfill: false }), body.requestId)
  }

  #find(state: LiveSession, requestId: string): Run | undefined {
    return state.session.snapshotEvents().find((event): event is Run => event.type === 'command/run' && commandInput(event)?.requestId === requestId)
  }

  #snapshot(state: LiveSession, run: Run): Snapshot {
    const input = commandInput(run) as CommandInput
    const done = state.session.snapshotEvents().find(event => event.type === 'command/done' && event.data.commandId === run.data.commandId)
    const result = done === undefined ? undefined : commandResult(done)
    return { sessionId: state.sessionId, ...input, commandId: run.data.commandId, acceptedSeq: run.seq,
      status: result?.status ?? 1, ...done === undefined ? {} : { completedSeq: done.seq }, ...result?.error === undefined ? {} : { error: result.error } }
  }

  async #status(state: LiveSession, requestId: string): Promise<Snapshot | null> {
    const run = this.#find(state, requestId)
    if (run === undefined) return null
    const snapshot = this.#snapshot(state, run)
    if (snapshot.status !== 1 || this.#active.get(state.sessionId)?.requestId === requestId) {
      // This read deliberately does not wait in the writer queue: accepted state
      // remains observable while native maintenance waits for its model.
      await this.runtime.barrier(state)
      return snapshot
    }
    return this.runtime.runSession(state.sessionId, async () => {
      if (this.#snapshot(state, run).status === 1) {
        const effect = this.#effect(state, run)
        this.#done(state, run, effect?.result ?? interrupted, effect?.seq)
      }
      await this.runtime.barrier(state)
      return this.#snapshot(state, run)
    })
  }

  #effect(state: LiveSession, run: Run): { result: CommandResult; seq: SessionSeq } | undefined {
    const events = state.session.snapshotEvents()
    for (const event of events) {
      if (event.type !== 'user/message' || event.surfaceOp === 'append') continue
      const source = event.data.source
      if (commandInput(run)?.command === 2 && source.kind === 'ourfairy-context-reset' && source.commandId === run.data.commandId) {
        return { result: { status: 4 }, seq: event.seq }
      }
      if (commandInput(run)?.command !== 1 || source.kind !== 'compact-checkpoint' || source.sourceCommandId !== run.data.commandId) continue
      const paired = events.filter(candidate => (candidate.type === 'compaction/start' || candidate.type === 'compaction/summary' || candidate.type === 'compaction/end')
        && candidate.data.compactionId === source.compactionId && candidate.data.sourceCommandId === run.data.commandId)
      const start = paired.find(candidate => candidate.type === 'compaction/start')
      const summary = paired.find(candidate => candidate.type === 'compaction/summary')
      const end = paired.find(candidate => candidate.type === 'compaction/end')
      if (start !== undefined && summary !== undefined && end?.type === 'compaction/end' && end.data.error === undefined
        && start.seq < summary.seq && summary.seq < event.seq && event.seq < end.seq) return { result: { status: 2 }, seq: summary.seq }
    }
    return undefined
  }

  #done(state: LiveSession, run: Run, result: CommandResult, sourceEventSeq?: SessionSeq): void {
    state.session.append('command/done', { commandId: run.data.commandId, kind: result.status === 5 ? 'error' : 'success', text: JSON.stringify(result),
      ...sourceEventSeq === undefined || result.status === 5 ? {} : { sourceEventSeq } })
  }

  #checkIdle(state: LiveSession): void {
    const agent = state.agent as Agent
    if (agent.status !== 'idle' || agent.inbox.nextTurn.length !== 0 || agent.inbox.nextStep.length !== 0
      || this.ctx.jobs.list(state.sessionId).some(job => job.owner === state.sessionId && !['completed', 'killed', 'failed'].includes(job.status))) throw busy()
  }

  #clear(state: LiveSession, commandId: CommandId, signal: AbortSignal): SessionSeq | undefined {
    signal.throwIfAborted()
    const session = state.session
    const nodes = [...session.surface.nodes]
    if (nodes[0] !== undefined && session.eventAt(nodes[0])?.type === 'system/message') nodes.shift()
    const start = nodes[0]
    const end = nodes.at(-1)
    // Leaving a never-used surface empty lets the next real turn install its
    // system prompt at node 0. The durable done still supplies a boundary.
    if (start === undefined || end === undefined) return undefined
    const selected = new Set(nodes)
    const shadowedTokenCount = this.ctx.tokenMeter.measure(session).nodes
      .filter(node => selected.has(node.seq)).reduce((sum, node) => sum + node.heuristicTokens, 0)
    session.append('compaction/prune', { shadowedRange: { start, end }, shadowedSeqs: nodes, shadowedTokenCount })
    return session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '上下文已重置。' }],
      source: { kind: 'ourfairy-context-reset', commandId } }), {
      surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: nodes,
    }).seq
  }
}
