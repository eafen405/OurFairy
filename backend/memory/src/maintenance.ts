/**
 * The per-source-session maintenance engine.
 *
 * One row per source session tracks the last completed watermark, the frozen
 * cut of the interval currently being maintained, and the child that owns it.
 * The engine wakes on a short tick, recomputes "closed user turns after the
 * watermark" and the current threshold from the persisted newest closed-turn
 * time, and starts exactly one native Agent child when the source is quiet and
 * the threshold is met.
 *
 * A child is an ordinary dsh Agent with no owner, no inherited parent context
 * and `parentSession` pointing at the source. Its own scoped setup restricts
 * inherited tools to nothing; the memory row registers the five memory tools on
 * it, and every other product tool row registers only for a user's own session,
 * so none of them registers on the child. The child and its source run in
 * parallel: no work of the source is awaited.
 *
 * Completion is decided from the durable `turn/end` reason, never from
 * `whenIdle()` (which resolves on failure too). A completed turn — including
 * one that wrote nothing — advances the watermark; any other ending keeps the
 * watermark and leaves the same child for a resume.
 *
 * @module @ourfairy/dsh-memory/src/maintenance
 */
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import { MAINTENANCE_DECAY_HOURS, MAINTENANCE_TURNS } from './maintenance-policy.js'
import { MemoryError } from './tool-kit.js'
import { assembleMaterial, closedUserTurns, type ClosedTurn } from './material.js'
import { MAINTENANCE_PRESET } from './preset.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { MaintenanceRow, MemoryStore } from './store.js'
// Type-only: the agent-scoped prompt and tool seams the child setup composes,
// and the query/persistence services the engine reads.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'

/** Default light-model route the maintenance child uses. */
export const DEFAULT_MAINTENANCE_MODEL = 'MiniMax-M3.1-Flash'
/** Provider of the default light-model route. */
export const DEFAULT_MAINTENANCE_PROVIDER = 'minimax-cn'

/** One hour in milliseconds. */
const HOUR = 3_600_000
/** How often the engine re-evaluates persisted source state. */
const TICK_MS = 1_000
/** How long a failed interval waits before resuming its child. */
const RETRY_MS = 2_000

/** One live configuration field: the loader's volatile ref, or a plain value. */
export type MaintenanceField = { readonly get: () => unknown } | string | number | null | undefined

/** The fields of the memory row's config this engine reads. */
export type MaintenanceConfig = {
  readonly maintenanceTurns: MaintenanceField
  readonly maintenanceDecayHours: MaintenanceField
  readonly maintenanceModel: MaintenanceField
  readonly maintenanceProvider: MaintenanceField
}

/** The checked values one evaluation uses. */
export type MaintenanceSettings = {
  readonly turns: number
  readonly decayHours: number
  readonly model: string
  readonly provider: string
}

/** The child's own instruction; none of the source session's prompt enters it. */
const MAINTENANCE_POLICY = '你是长期记忆维护子代理。只根据本封口区间内的维护材料判断；不要读取或假设其他会话的内容，也不要处理区间外的消息。'
  + '只记录用户自己明确说出的、可长期复用的稳定事实、偏好和共同经历；只有用户明确要求记住，或长期不变的属性、重复习惯和明确说出的共同经历才写；不要记录带有「最近」「今天」「现在」「刚才」等时间限定的状态、动向、计划或待办，即使用户自己提到了也不写。'
  + '不要写会话摘要、用户画像、性格推测、IP/位置/设备/天气/时间等环境推断、一次性情绪或身体感受，也不要把 Fairy 的回复或工具结果当成用户事实。'
  + '不要把你执行过的记忆增删改、用户对记忆的增删改或切换要求、以及维护过程本身写成新记忆；不要记录待办、未结项提醒、会话任务状态或 Fairy 的建议。'
  + '材料中的记忆变更已经生效，不要重复添加。'
  + '你可以用 memory_search 查找已有长期记忆，然后用 memory_add、memory_edit、memory_delete 或 memory_switch 增删改、切换层级；区间内没有用户本人明确陈述的、值得长期保留的新事实时直接结束，不要为了记录维护结果而写记忆。'
  + '你只能使用记忆工具，不能修改印象，不能读写文件、执行命令或使用其他工具。'

/** The continuation written when a failed child is resumed. */
const RETRY_MESSAGE = '上一轮维护没有完成。请基于这段子会话中已有的维护材料继续；需要时重新 memory_search，然后完成增删改、切换或直接结束。'

/** Read one volatile field's current value. */
function fieldValue(field: MaintenanceField): unknown {
  if (field !== null && typeof field === 'object' && 'get' in field && typeof field.get === 'function') return field.get()
  return field
}

/** Read and validate one integer setting at the moment it is used. */
function integerSetting(field: MaintenanceField, fallback: number, minimum: number, maximum: number, name: string): number {
  const value = fieldValue(field) ?? fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new MemoryError(500, 'memory/misconfigured', `${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

/** Read and validate one non-empty text setting at the moment it is used. */
function textSetting(field: MaintenanceField, fallback: string, name: string): string {
  const value = fieldValue(field) ?? fallback
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemoryError(500, 'memory/misconfigured', `${name} must be a non-empty string`)
  }
  return value
}

/**
 * Read the maintenance settings now.
 *
 * Every call reads the current value of each field: the loader hands over
 * volatile refs, and a settings write changes what the next evaluation sees.
 * Nothing here is cached across evaluations. The fallbacks and the accepted
 * ranges come from the memory package's maintenance policy
 * (`./maintenance-policy.ts`); `tests/memory-maintenance-recovery.test.mjs`
 * holds this read-time check to that policy's bounds.
 * @param config - the memory row config as the loader handed it over.
 * @returns the checked settings for this evaluation.
 */
export function readMaintenanceSettings(config: MaintenanceConfig): MaintenanceSettings {
  return {
    turns: integerSetting(config.maintenanceTurns, MAINTENANCE_TURNS.default,
      MAINTENANCE_TURNS.min, MAINTENANCE_TURNS.max, 'maintenanceTurns'),
    decayHours: integerSetting(config.maintenanceDecayHours, MAINTENANCE_DECAY_HOURS.default,
      MAINTENANCE_DECAY_HOURS.min, MAINTENANCE_DECAY_HOURS.max, 'maintenanceDecayHours'),
    model: textSetting(config.maintenanceModel, DEFAULT_MAINTENANCE_MODEL, 'maintenanceModel'),
    provider: textSetting(config.maintenanceProvider, DEFAULT_MAINTENANCE_PROVIDER, 'maintenanceProvider'),
  }
}

/**
 * The current closed-turn threshold.
 *
 * One is subtracted for every complete decay interval since the newest closed
 * user turn, and the result never drops below one. A source with no closed turn
 * yet has no threshold.
 * @param settings - the current turn count and decay interval.
 * @param lastClosedAt - the newest closed user turn's time, or undefined.
 * @param now - the current time.
 * @returns the threshold, or undefined when there is no closed turn.
 */
export function currentThreshold(
  settings: Pick<MaintenanceSettings, 'turns' | 'decayHours'>,
  lastClosedAt: number | undefined,
  now: number,
): number | undefined {
  if (lastClosedAt === undefined) return undefined
  const elapsed = Math.max(0, now - lastClosedAt)
  const decayed = Math.floor(elapsed / (settings.decayHours * HOUR))
  return Math.max(1, settings.turns - decayed)
}

/** What one evaluation last learned from a source log, keyed by its live seq or persistence revision. */
type SourceFacts = {
  readonly token: string
  readonly watermark: number
  readonly turns: readonly ClosedTurn[]
}

/** One interval claimed and waiting for (or running in) a child. */
type NewInterval = {
  readonly kind: 'create'
  readonly childSession: SessionId
  readonly cutSeq: number
  readonly material: string
}

/** A failed (or interrupted) interval whose child must be resumed. */
type ResumedInterval = {
  readonly kind: 'resume'
  readonly childSession: SessionId
  readonly cutSeq: number
}

export class MaintenanceEngine {
  readonly #ctx: Context
  readonly #store: MemoryStore
  readonly #settings: () => MaintenanceSettings
  readonly #known = new Set<string>()
  readonly #cache = new Map<string, SourceFacts>()
  readonly #active = new Set<string>()
  readonly #runs = new Set<Promise<void>>()
  readonly #handles = new Map<string, AgentHandle>()
  readonly #retryAt = new Map<string, number>()
  #timer: ReturnType<typeof setInterval> | undefined
  #disposed = false
  #booting = false

  constructor(ctx: Context, store: MemoryStore, settings: () => MaintenanceSettings) {
    this.#ctx = ctx
    this.#store = store
    this.#settings = settings
  }

  /**
   * Follow one live agent as a possible source. Owned user sessions do; the
   * maintenance child (no owner, maintenance preset) never becomes a source.
   */
  watch(agent: Agent): void {
    const header = agent.session.header
    if (header.owner === undefined || header.agentPreset === MAINTENANCE_PRESET) return
    this.#known.add(agent.session.id)
    void this.#evaluate(agent.session.id)
  }

  /** Start the tick and the one restart scan over persisted state. */
  start(): void {
    this.#timer = setInterval(() => { void this.#tick() }, TICK_MS)
    this.#timer.unref()
    void this.#bootstrap()
  }

  /** Stop the timer, abort live children and wait for their runs to finish. */
  async close(): Promise<void> {
    this.#disposed = true
    if (this.#timer !== undefined) clearInterval(this.#timer)
    for (const handle of this.#handles.values()) await handle.dispose().catch(() => undefined)
    await Promise.allSettled([...this.#runs])
  }

  /** Recompute every known source from persisted state and the current clock. */
  async #tick(): Promise<void> {
    if (this.#disposed) return
    await Promise.allSettled([...this.#known].map(source => this.#evaluate(source)))
  }

  /** On boot, find every owned source session without relying on a live Agent. */
  async #bootstrap(): Promise<void> {
    if (this.#booting) return
    this.#booting = true
    try {
      for (const row of this.#store.maintenanceRows()) this.#known.add(row.source_session)
      for (const snapshot of await this.#ctx.sessionPersistence.list()) {
        const header = snapshot.header
        if (header.owner === undefined || header.agentPreset === MAINTENANCE_PRESET) continue
        this.#known.add(header.id)
      }
      await this.#tick()
    } catch {
      // The known maintenance rows are still re-evaluated by the next tick; a
      // failed listing must not take the memory row down.
    } finally {
      this.#booting = false
    }
  }

  /** One source evaluation: resume a failed interval or start a new one. */
  async #evaluate(sourceId: string): Promise<void> {
    if (this.#disposed || this.#active.has(sourceId)) return
    const state = this.#store.maintenance(sourceId)
    if (state !== undefined && state.status !== 0) {
      if (state.child_session !== null && state.cut_seq !== null) {
        if ((this.#retryAt.get(sourceId) ?? 0) > Date.now()) return
        this.#launch(sourceId, { kind: 'resume', childSession: state.child_session as SessionId, cutSeq: state.cut_seq })
        return
      }
      // A run without a resumable child (an interrupted claim with no frozen
      // cut) cannot make progress; release it and observe the source again.
      this.#store.resetMaintenance(sourceId)
    }
    const facts = await this.#observe(sourceId, state)
    if (facts === undefined) {
      this.#forgetIfCold(sourceId)
      return
    }
    const latest = this.#store.maintenance(sourceId)
    if (latest === undefined) return
    const pending = facts.turns.filter(turn => turn.seq > latest.watermark_seq).length
    if (pending === 0) {
      this.#forgetIfCold(sourceId)
      return
    }
    const lastClosedAt = latest.last_closed_at ?? facts.turns.at(-1)?.time
    const threshold = currentThreshold(this.#settings(), lastClosedAt, Date.now())
    if (threshold === undefined || pending < threshold || !this.#quiet(sourceId)) return

    // The interval must be claimed from one exact observation: the last closed
    // turn in the snapshot is the cut, so anything appended afterwards belongs
    // to the next interval.
    const events = await this.#readEvents(sourceId)
    if (events === undefined || !this.#quiet(sourceId)) return
    const cut = closedUserTurns(events).at(-1)
    if (cut === undefined) return
    const claimed = this.#store.claimMaintenance({
      sourceSession: sourceId,
      cutSeq: cut.seq,
      lastClosedAt: cut.time,
      childSession: `ourfairy-memory-${randomUUID()}`,
    })
    if (!claimed) return
    const frozen = this.#store.maintenance(sourceId)
    if (frozen === undefined || frozen.child_session === null) return
    const material = assembleMaterial({ events, watermarkSeq: latest.watermark_seq, cutSeq: cut.seq })
    this.#launch(sourceId, {
      kind: 'create',
      childSession: frozen.child_session as SessionId,
      cutSeq: cut.seq,
      material,
    })
  }

  /**
   * Read one source log, cache what an unchanged revision already answered, and
   * persist the newest closed user turn for the decay clock.
   */
  async #observe(sourceId: string, state: MaintenanceRow | undefined): Promise<SourceFacts | undefined> {
    const live = this.#ctx.agents.get(sourceId as SessionId)
    const token = live !== undefined
      ? `live:${String(live.session.seq)}`
      : await this.#coldToken(sourceId)
    if (token === undefined) return undefined
    const watermark = state?.watermark_seq ?? -1
    const cached = this.#cache.get(sourceId)
    if (cached !== undefined && cached.token === token && cached.watermark === watermark) return cached
    const events = await this.#readEvents(sourceId)
    if (events === undefined) return undefined
    const turns = closedUserTurns(events)
    const latest = turns.at(-1)
    if (latest !== undefined) {
      this.#store.observeMaintenance({ sourceSession: sourceId, lastClosedSeq: latest.seq, lastClosedAt: latest.time })
    }
    const facts: SourceFacts = { token, watermark, turns }
    this.#cache.set(sourceId, facts)
    return facts
  }

  /** A cheap change token for a cold source: the persistence revision. */
  async #coldToken(sourceId: string): Promise<string | undefined> {
    const snapshot = await this.#ctx.sessionPersistence.stat(sourceId as SessionId).catch(() => undefined)
    return snapshot === undefined ? undefined : `cold:${String(snapshot.revision)}`
  }

  /** One source's raw events, or undefined when it cannot be read. */
  async #readEvents(sourceId: string): Promise<readonly SessionEvent[] | undefined> {
    try {
      return (await readSessionEvents(this.#ctx, sourceId as SessionId)).events
    } catch {
      return undefined
    }
  }

  /** Whether the source has no running turn; a cold session counts as quiet. */
  #quiet(sourceId: string): boolean {
    const live = this.#ctx.agents.get(sourceId as SessionId)
    return live === undefined || live.status === 'idle'
  }

  /** Drop a cold source with nothing left to maintain; a live one keeps reporting future turns. */
  #forgetIfCold(sourceId: string): void {
    if (this.#ctx.agents.get(sourceId as SessionId) !== undefined) return
    this.#known.delete(sourceId)
    this.#cache.delete(sourceId)
  }

  /** Launch one child run without blocking the evaluation that decided it. */
  #launch(sourceId: string, interval: NewInterval | ResumedInterval): void {
    this.#active.add(sourceId)
    const run = interval.kind === 'create'
      ? this.#runNew(sourceId, interval)
      : this.#runResume(sourceId, interval)
    let tracked: Promise<void>
    tracked = run.catch(() => {
      // The run handles its own failure; this boundary only keeps a future tick
      // from waiting on a rejected promise.
      this.#retryAt.set(sourceId, Date.now() + RETRY_MS)
    }).finally(() => {
      this.#active.delete(sourceId)
      this.#runs.delete(tracked)
    })
    this.#runs.add(tracked)
  }

  /** Create the child, deliver the frozen material, and settle the interval. */
  async #runNew(sourceId: string, interval: NewInterval): Promise<void> {
    let handle: AgentHandle | undefined
    try {
      handle = await this.#createChild(sourceId, interval.childSession)
      this.#handles.set(sourceId, handle)
      const startSeq = handle.agent.session.seq
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: interval.material }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      const succeeded = await this.#completed(interval.childSession, startSeq)
      this.#finish(sourceId, interval.childSession, interval.cutSeq, succeeded)
    } catch {
      if (handle === undefined) {
        // The session never came into existence, so there is no child to
        // resume; release the claim and let a later tick claim a fresh one.
        this.#store.resetMaintenance(sourceId)
      } else {
        this.#store.failMaintenance({ sourceSession: sourceId, childSession: interval.childSession })
      }
      this.#retryAt.set(sourceId, Date.now() + RETRY_MS)
    } finally {
      this.#handles.delete(sourceId)
      if (handle !== undefined) await handle.dispose().catch(() => undefined)
    }
  }

  /** Resume the same child and continue from its own durable log. */
  async #runResume(sourceId: string, interval: ResumedInterval): Promise<void> {
    let handle: AgentHandle | undefined
    try {
      handle = await this.#resumeChild(interval.childSession)
      this.#handles.set(sourceId, handle)
      const startSeq = handle.agent.session.seq
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: RETRY_MESSAGE }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      const succeeded = await this.#completed(interval.childSession, startSeq)
      this.#finish(sourceId, interval.childSession, interval.cutSeq, succeeded)
    } catch {
      if (handle === undefined) {
        const stored = await this.#ctx.sessionPersistence.stat(interval.childSession).catch(() => undefined)
        if (stored === undefined) this.#store.resetMaintenance(sourceId)
        else this.#store.failMaintenance({ sourceSession: sourceId, childSession: interval.childSession })
      } else {
        this.#store.failMaintenance({ sourceSession: sourceId, childSession: interval.childSession })
      }
      this.#retryAt.set(sourceId, Date.now() + RETRY_MS)
    } finally {
      this.#handles.delete(sourceId)
      if (handle !== undefined) await handle.dispose().catch(() => undefined)
    }
  }

  /** Create one maintenance child under the current light-model route. */
  #createChild(sourceId: string, childSession: SessionId): Promise<AgentHandle> {
    const settings = this.#settings()
    return this.#ctx.agents.create({
      sessionId: childSession,
      meta: { parentSession: sourceId as SessionId, origin: 'subagent', agentPreset: MAINTENANCE_PRESET },
      agentOptions: { provider: settings.provider, model: settings.model },
      setup: agentCtx => this.#composeChild(agentCtx),
    })
  }

  /** Resume one persisted child under the current light-model route. */
  #resumeChild(childSession: SessionId): Promise<AgentHandle> {
    const settings = this.#settings()
    return this.#ctx.agents.resume({
      resumeSessionId: childSession,
      agentOptions: { provider: settings.provider, model: settings.model },
      setup: agentCtx => this.#composeChild(agentCtx),
    })
  }

  /** The child's whole scoped world: no inherited tools and one maintenance instruction. */
  #composeChild(agentCtx: Context): void {
    agentCtx.tools.restrict({ allow: [] })
    agentCtx.systemPrompt.section({
      name: 'ourfairy:memory-maintenance',
      order: 0,
      text: MAINTENANCE_POLICY,
      interpolate: false,
    })
  }

  /**
   * Whether the child's last turn ended in `completed`.
   *
   * `whenIdle()` resolves after a failed driver too, so the durable `turn/end`
   * reason is the only authority. `max-tokens`, `blocked`, `aborted`,
   * `interrupted` and `error` all mean the maintenance did not finish.
   */
  async #completed(childSession: SessionId, startSeq: number): Promise<boolean> {
    const { events } = await readSessionEvents(this.#ctx, childSession)
    const ending = events.filter(event => event.type === 'turn/end' && event.seq >= startSeq).at(-1)
    if (ending === undefined || ending.type !== 'turn/end') return false
    return ending.data.reason.kind === 'completed'
  }

  /** Settle one interval from the child's durable ending. */
  #finish(sourceId: string, childSession: SessionId, cutSeq: number, succeeded: boolean): void {
    if (succeeded) {
      this.#store.completeMaintenance({ sourceSession: sourceId, cutSeq, childSession })
      this.#retryAt.delete(sourceId)
      this.#cache.delete(sourceId)
      return
    }
    this.#store.failMaintenance({ sourceSession: sourceId, childSession })
    this.#retryAt.set(sourceId, Date.now() + RETRY_MS)
  }
}
