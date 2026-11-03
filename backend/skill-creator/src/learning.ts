/**
 * The per-source-session background learning engine (#300).
 *
 * One row per source session tracks the last completed watermark, the frozen
 * cut of the interval currently being detected, and the detection child that
 * owns it. The engine wakes on a one-second tick, recomputes "closed user turns
 * after the watermark", and starts exactly one native Agent child when the
 * source is quiet and has at least `learningTurns` closed turns to examine.
 *
 * The child is an ordinary dsh Agent with `parentSession` pointing at the
 * source, `origin: 'subagent'` and the learning preset, and deliberately no
 * `owner` in its header: the owner is captured from the source session and
 * passed through the setup closure. That keeps the memory maintenance watch,
 * the product tool rows and the session lists from treating it as a user
 * session. Its scoped setup restricts every inherited tool to nothing and
 * self-registers the one structured `submit_signals` tool plus the detection
 * prompt.
 *
 * Completion is decided from the durable log: the last `turn/end` must be
 * `completed` and the run must carry exactly one successful `submit_signals`
 * call. The submission is validated again here and only then persisted through
 * one `settleLearning` transaction that stores the evidence and advances the
 * watermark together, so a crash can never leave evidence behind an unadvanced
 * interval. A completed turn with zero signals still advances the watermark;
 * any other ending keeps the watermark and leaves the same child for a resume.
 *
 * Failed runs are budgeted: `skill_learning_state.attempts` persists across a
 * restart, and once `learningMaxTurns` attempts are spent the interval is given
 * up in place instead of being reset and re-claimed in a loop. Only a closed
 * user turn after the abandoned cut releases the source again. A resume whose
 * child session no longer exists releases the interval instead of spending the
 * budget on it (the same recovery the memory maintenance engine has).
 *
 * Ambiguous-but-valuable evidence is resolved by one independent lightweight
 * review child before the interval settles. The review child sees the same
 * material and can answer success, failure or uncertain; uncertain never
 * triggers automatic creation.
 *
 * @module @ourfairy/dsh-skill-creator/src/learning
 */
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { isUserSession } from '@ourfairy/dsh-identity/session'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import {
  DETECTION_POLICY,
  LEARNING_CREATION_ATTEMPTS,
  LEARNING_MAX_MATERIAL_CHARS,
  LEARNING_MAX_TURNS,
  LEARNING_TURNS,
  MAX_EXISTING_TASK_KEYS,
  MAX_REVOCABLE_SIGNALS,
  MAX_SIGNAL_NOTE_CHARACTERS,
  MAX_SIGNALS_PER_SUBMISSION,
  REVIEW_POLICY,
  SKILL_LEARNING_PRESET,
  isValidTaskKey,
} from './learning-policy.js'
import { ChildRuns, learningChildSetup, successfulCalls, turnCompleted } from './learning-child.js'
import { assembleLearningMaterial, closedUserTurns, intervalHasToolCalls, type ClosedTurn } from './material.js'
import { SkillError } from './service.js'
import { LEARNING_STATUS, SIGNAL_STATUS, SkillStoreError, type LearningRow, type NewSignal, type SignalRow, type SkillStore } from './store.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: the agent-scoped prompt/tool seams and the persistence/query
// services the engine reads.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: the product services the source owner is derived from.
import type {} from '@ourfairy/dsh-sessions'

/** The default light-model route the detection child uses. */
export const DEFAULT_LEARNING_MODEL = 'MiniMax-M3.1-Flash'
/** Provider of the default light-model route. */
export const DEFAULT_LEARNING_PROVIDER = 'minimax-cn'

/** How often the engine re-evaluates persisted source state. */
const TICK_MS = 1_000
/** How long a failed interval waits before resuming its child. */
const RETRY_MS = 2_000
/** How long a cold source with too few closed turns is kept before it is forgotten. */
const COLD_SOURCE_RETENTION_MS = 6 * 60 * 60 * 1_000

/** The continuation written when a failed detection child is resumed. */
const DETECTION_RETRY_MESSAGE = '上一轮检测没有完成。请基于这段子会话中已有的学习材料继续；完成时恰好调用一次 submit_signals（可以提交零条信号），然后结束回复。'

/** The signals one detection run submitted, already validated. */
type SubmittedSignal = {
  readonly taskKey: string
  readonly status: number
  readonly evidenceStartSeq: number
  readonly evidenceEndSeq: number
  readonly revokesSignalId?: number
  readonly note?: string
}

/** The frozen interval one detection child owns. */
type DetectionInterval = {
  readonly kind: 'create'
  readonly ownerShortId: number
  readonly childSession: SessionId
  readonly cutSeq: number
  /** Exclusive lower bound of the interval: the watermark it was claimed from. */
  readonly watermarkSeq: number
  readonly material: string
  readonly taskKeys: readonly string[]
  readonly revocable: readonly SignalRow[]
}

/** The interval a failed detection child must resume. */
type DetectionResume = {
  readonly kind: 'resume'
  readonly ownerShortId: number
  readonly childSession: SessionId
  readonly cutSeq: number
}

/** One live configuration field: the loader's volatile ref, or a plain value. */
export type LearningField = { readonly get: () => unknown } | string | number | null | undefined

/** The fields of the skill row's config this engine reads. */
export type LearningConfig = {
  readonly learningTurns: LearningField
  readonly learningModel: LearningField
  readonly learningProvider: LearningField
  readonly learningMaxMaterialChars: LearningField
  readonly learningMaxTurns: LearningField
  /** The creation-claim attempt ceiling; a missing field uses the policy default. */
  readonly learningCreationAttempts?: LearningField
}

/** The checked values one evaluation uses. */
export type LearningSettings = {
  readonly turns: number
  readonly model: string
  readonly provider: string
  readonly maxMaterialChars: number
  /** The detection interval's failed-run budget. */
  readonly maxTurns: number
  /** The background creation claim's failed-run budget. */
  readonly creationAttemptLimit: number
}

/** Read one volatile field's current value. */
function fieldValue(field: LearningField): unknown {
  if (field !== null && typeof field === 'object' && 'get' in field && typeof field.get === 'function') return field.get()
  return field
}

/** Read and validate one integer setting at the moment it is used. */
function integerSetting(field: LearningField, fallback: number, minimum: number, maximum: number, name: string): number {
  const value = fieldValue(field) ?? fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SkillError(500, 'skills/misconfigured', `${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

/** Read and validate one non-empty text setting at the moment it is used. */
function textSetting(field: LearningField, fallback: string, name: string): string {
  const value = fieldValue(field) ?? fallback
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SkillError(500, 'skills/misconfigured', `${name} must be a non-empty string`)
  }
  return value
}

/**
 * Read the learning settings now.
 *
 * Every call re-reads each volatile field: the loader hands over live refs, and
 * a saved value applies to the next evaluation without remounting the row.
 * @param config - the skill row config as the loader handed it over.
 */
export function readLearningSettings(config: LearningConfig): LearningSettings {
  return {
    turns: integerSetting(config.learningTurns, LEARNING_TURNS.default, LEARNING_TURNS.min, LEARNING_TURNS.max, 'learningTurns'),
    model: textSetting(config.learningModel, DEFAULT_LEARNING_MODEL, 'learningModel'),
    provider: textSetting(config.learningProvider, DEFAULT_LEARNING_PROVIDER, 'learningProvider'),
    maxMaterialChars: integerSetting(config.learningMaxMaterialChars, LEARNING_MAX_MATERIAL_CHARS.default,
      LEARNING_MAX_MATERIAL_CHARS.min, LEARNING_MAX_MATERIAL_CHARS.max, 'learningMaxMaterialChars'),
    maxTurns: integerSetting(config.learningMaxTurns, LEARNING_MAX_TURNS.default, LEARNING_MAX_TURNS.min, LEARNING_MAX_TURNS.max, 'learningMaxTurns'),
    creationAttemptLimit: integerSetting(config.learningCreationAttempts, LEARNING_CREATION_ATTEMPTS.default,
      LEARNING_CREATION_ATTEMPTS.min, LEARNING_CREATION_ATTEMPTS.max, 'learningCreationAttempts'),
  }
}

/** What one evaluation last learned from a source log, keyed by its live seq or persistence revision. */
type SourceFacts = {
  readonly token: string
  readonly watermark: number
  readonly ownerShortId: number
  readonly turns: readonly ClosedTurn[]
}

/** The bounded list of earlier successes a later interval may revoke. */
function revocableSection(revocable: readonly SignalRow[]): string {
  if (revocable.length === 0) return '可撤销的现有成功信号（本会话）：无。'
  const lines = ['可撤销的现有成功信号（本会话，按新到旧）：']
  for (const signal of revocable) {
    lines.push(`- 信号 ${signal.id}：${signal.task_key}（证据区间 ${signal.evidence_start_seq}–${signal.evidence_end_seq}）`)
  }
  return lines.join('\n')
}

/** The detection prompt for one frozen interval. */
export function detectionPrompt(input: {
  readonly taskKeys: readonly string[]
  readonly revocable: readonly SignalRow[]
  readonly watermarkSeq: number
  readonly cutSeq: number
}): string {
  const keys = input.taskKeys.length === 0
    ? '现有任务键：无。'
    : `现有任务键（优先复用其中贴切的一项）：\n${input.taskKeys.map(key => `- ${key}`).join('\n')}`
  return [
    DETECTION_POLICY,
    `本封存区间：第 ${String(input.watermarkSeq)} 条事件之后到第 ${String(input.cutSeq)} 条事件（含）。`,
    keys,
    revocableSection(input.revocable),
  ].join('\n\n')
}

/** The review prompt for the ambiguous signals of one interval. */
export function reviewPrompt(input: { readonly candidates: readonly SubmittedSignal[]; readonly cutSeq: number }): string {
  const lines = [REVIEW_POLICY, `本封存区间的检测切点：第 ${String(input.cutSeq)} 条事件。候选信号按顺序编号：`]
  input.candidates.forEach((candidate, index) => {
    lines.push(`${String(index + 1)}. 任务键 ${candidate.taskKey}（证据区间 ${String(candidate.evidenceStartSeq)}–${String(candidate.evidenceEndSeq)}）`
      + `${candidate.note === undefined ? '' : `；检测说明：${candidate.note}`}`)
  })
  lines.push('请对每一条编号给出一个判断，不能遗漏或重复。')
  return lines.join('\n')
}

/** Parse one JSON object argument string, or undefined. */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** One optional integer field, or undefined when absent. */
function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/** The bounded tool-result/render pair every learning tool answers with. */
const LEARNING_TOOL_OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
}

/**
 * The engine's dependencies: the durable store, the live settings and the one
 * callback that asks the creation engine to look at a new signal.
 */
export interface LearningEngineOptions {
  readonly settings: () => LearningSettings
  /** Ask the cross-session creation engine to re-evaluate one owner's claims. */
  readonly onSignals: (ownerShortId: number) => void
  /** Where the row's logger writes; a misconfigured Skill Creator body is reported, not thrown. */
  readonly log?: (level: 'info' | 'warn', message: string) => void
}

export class LearningEngine {
  readonly #ctx: Context
  readonly #store: SkillStore
  readonly #options: LearningEngineOptions
  readonly #known = new Set<string>()
  readonly #cache = new Map<string, SourceFacts>()
  readonly #children = new ChildRuns<string>()
  readonly #handles = new Map<string, AgentHandle>()
  #timer: ReturnType<typeof setInterval> | undefined
  #disposed = false
  #booting = false
  /** Single-flight: a slow evaluation pass never overlaps the next tick. */
  #ticking = false

  constructor(ctx: Context, store: SkillStore, options: LearningEngineOptions) {
    this.#ctx = ctx
    this.#store = store
    this.#options = options
  }

  /**
   * Follow one live agent as a possible source. Only a user's own session
   * does: an owned, parentless, preset-less session. A detection, review or
   * creation child carries a parent and/or a preset and never becomes a source.
   */
  watch(agent: Agent): void {
    if (!isUserSession(agent.session.header)) return
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
    await this.#children.close()
  }

  /**
   * Recompute every known source from persisted state and the current clock.
   *
   * Single-flight: when one pass is still running (a slow persistence read, a
   * large history), the next tick is skipped instead of stacking more passes on
   * top of it. The skipped state is caught up by the following tick.
   */
  async #tick(): Promise<void> {
    if (this.#disposed || this.#ticking) return
    this.#ticking = true
    try {
      await Promise.allSettled([...this.#known].map(source => this.#evaluate(source)))
    } finally {
      this.#ticking = false
    }
  }

  /** On boot, find every owned source session without relying on a live Agent. */
  async #bootstrap(): Promise<void> {
    if (this.#booting) return
    this.#booting = true
    try {
      for (const row of this.#store.learningRows()) this.#known.add(row.source_session)
      for (const snapshot of await this.#ctx.sessionPersistence.list()) {
        if (!isUserSession(snapshot.header)) continue
        this.#known.add(snapshot.header.id)
      }
      await this.#tick()
    } catch {
      // The persisted learning rows are re-evaluated by the next tick; a failed
      // listing must not take the skill row down.
    } finally {
      this.#booting = false
    }
  }

  /** One source evaluation: resume a failed interval, release a given-up one, or start a new one. */
  async #evaluate(sourceId: string): Promise<void> {
    if (this.#disposed || this.#children.has(sourceId)) return
    const state = this.#store.learning(sourceId)
    if (state !== undefined && state.status === LEARNING_STATUS.gaveUp) {
      // A given-up interval is terminal: only new evidence after its frozen cut
      // may release the source, and nothing resumes its old child.
      if (!(await this.#releasedFromGiveUp(sourceId, state))) return
    } else if (state !== undefined && state.status !== 0) {
      if (state.child_session !== null && state.cut_seq !== null) {
        if ((this.#children.retryAt(sourceId) ?? state.retry_at ?? 0) > Date.now()) return
        const owner = await this.#ownerOf(sourceId)
        if (owner === undefined) return
        this.#launch(sourceId, { kind: 'resume', ownerShortId: owner, childSession: state.child_session as SessionId, cutSeq: state.cut_seq })
        return
      }
      // A run without a resumable child cannot make progress; release the claim
      // and observe the source again.
      this.#store.resetLearning(sourceId)
    }
    const facts = await this.#observe(sourceId, state)
    if (facts === undefined) {
      this.#forgetIfCold(sourceId)
      return
    }
    const latest = this.#store.learning(sourceId)
    if (latest === undefined) return
    const pending = facts.turns.filter(turn => turn.seq > latest.watermark_seq).length
    if (pending === 0) {
      this.#forgetIfCold(sourceId)
      return
    }
    if (pending < this.#options.settings().turns) {
      // Not enough new turns yet; a cold source is forgotten after a bounded
      // retention instead of being re-read on every tick forever.
      this.#forgetIfCold(sourceId, { pending, lastClosedAt: latest.last_closed_at })
      return
    }
    if (!this.#quiet(sourceId)) return

    // The interval must be claimed from one exact observation: the last closed
    // turn in the snapshot is the cut, so anything appended afterwards belongs
    // to the next interval.
    const events = await this.#readEvents(sourceId)
    if (events === undefined || !this.#quiet(sourceId)) return
    const cut = closedUserTurns(events).at(-1)
    if (cut === undefined) return
    const claimed = this.#store.claimLearning({
      sourceSession: sourceId,
      cutSeq: cut.seq,
      lastClosedAt: cut.time,
      childSession: `ourfairy-skill-learning-${randomUUID()}`,
    })
    if (!claimed) return
    const frozen = this.#store.learning(sourceId)
    if (frozen === undefined || frozen.child_session === null) return
    const settings = this.#options.settings()
    // Cheap pre-check before any model call: an interval with no tool call and
    // no revocable earlier signal cannot carry an executed reusable workflow
    // and cannot owe a late correction. Complete it with zero signals; a
    // text-only correction interval still reaches the child because a
    // revocable signal exists.
    const revocable = this.#store.revocableSignals(facts.ownerShortId, sourceId, MAX_REVOCABLE_SIGNALS)
    if (revocable.length === 0 && !intervalHasToolCalls({ events, watermarkSeq: latest.watermark_seq, cutSeq: cut.seq })) {
      this.#store.completeLearning({
        sourceSession: sourceId,
        cutSeq: cut.seq,
        childSession: frozen.child_session,
      })
      this.#options.log?.('info', `skill learning for ${sourceId} completed interval at ${String(cut.seq)} with zero signals: no tool calls and no revocable signal`)
      return
    }
    const material = assembleLearningMaterial({
      events,
      watermarkSeq: latest.watermark_seq,
      cutSeq: cut.seq,
      maxCharacters: settings.maxMaterialChars,
    })
    this.#launch(sourceId, {
      kind: 'create',
      ownerShortId: facts.ownerShortId,
      childSession: frozen.child_session as SessionId,
      cutSeq: cut.seq,
      material,
      taskKeys: this.#store.taskKeys(facts.ownerShortId, MAX_EXISTING_TASK_KEYS),
      revocable,
      watermarkSeq: latest.watermark_seq,
    })
  }

  /**
   * Read one source log, cache what an unchanged revision already answered, and
   * persist the newest closed user turn for the display/decay clock.
   */
  async #observe(sourceId: string, state: LearningRow | undefined): Promise<SourceFacts | undefined> {
    const live = this.#ctx.agents.get(sourceId as SessionId)
    const header = live?.session.header
    const ownerShortId = header === undefined ? undefined : shortIdOf(header.owner)
    let persistedOwner = ownerShortId
    let token: string | undefined
    if (live !== undefined) {
      token = `live:${String(live.session.seq)}`
    } else {
      const snapshot = await this.#ctx.sessionPersistence.stat(sourceId as SessionId).catch(() => undefined)
      if (snapshot === undefined) return undefined
      if (!isUserSession(snapshot.header)) return undefined
      persistedOwner = shortIdOf(snapshot.header.owner)
      token = `cold:${String(snapshot.revision)}`
    }
    if (persistedOwner === undefined || token === undefined) return undefined
    if (live !== undefined && !isUserSession(header)) return undefined
    const watermark = state?.watermark_seq ?? -1
    const cached = this.#cache.get(sourceId)
    if (cached !== undefined && cached.token === token && cached.watermark === watermark) return cached
    const events = await this.#readEvents(sourceId)
    if (events === undefined) return undefined
    const turns = closedUserTurns(events)
    const newest = turns.at(-1)
    if (newest !== undefined) {
      this.#store.observeLearning({ sourceSession: sourceId, lastClosedSeq: newest.seq, lastClosedAt: newest.time })
    }
    const facts: SourceFacts = { token, watermark, ownerShortId: persistedOwner, turns }
    this.#cache.set(sourceId, facts)
    return facts
  }

  /**
   * Whether a given-up source may start a fresh interval again.
   *
   * The abandoned row keeps its frozen cut and attempt count, so no tick
   * resumes it and a restart cannot reset the budget. Only a closed user turn
   * *after* that cut is new evidence: then the row is released (clearing the
   * attempt count with the frozen interval) and the normal path claims a fresh
   * interval. Without such a turn the source stays released and no child is
   * created for the same evidence again.
   *
   * @returns true when the caller may continue with the normal new-interval path.
   */
  async #releasedFromGiveUp(sourceId: string, state: LearningRow): Promise<boolean> {
    const cutSeq = state.cut_seq
    if (cutSeq === null) {
      // A given-up row without a frozen cut cannot compare evidence; release it.
      this.#store.resetLearning(sourceId)
      return true
    }
    const facts = await this.#observe(sourceId, state)
    if (facts === undefined) {
      this.#forgetIfCold(sourceId)
      return false
    }
    const newest = facts.turns.at(-1)
    if (newest === undefined || newest.seq <= cutSeq) {
      this.#forgetIfCold(sourceId, { pending: 0, lastClosedAt: state.last_closed_at })
      return false
    }
    if (!this.#quiet(sourceId)) return false
    this.#store.resetLearning(sourceId)
    this.#options.log?.('info', `skill learning for ${sourceId} released its given-up interval: a newer closed user turn is available`)
    return true
  }

  /** The durable owner of one source session, from its live or persisted header. */
  async #ownerOf(sourceId: string): Promise<number | undefined> {
    const live = this.#ctx.agents.get(sourceId as SessionId)
    if (live !== undefined) return shortIdOf(live.session.header.owner)
    const snapshot = await this.#ctx.sessionPersistence.stat(sourceId as SessionId).catch(() => undefined)
    return snapshot === undefined ? undefined : shortIdOf(snapshot.header.owner)
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

  /**
   * Drop a cold source with nothing left to detect; a live one keeps reporting
   * future turns.
   *
   * `activity` is the source's newest closed-turn time. A cold source with a
   * few not-yet-threshold turns is kept for a bounded window and then forgotten
   * rather than stat'ed on every tick forever (B7); a live agent re-adds its own
   * session through `watch`, and a restart rebuilds the set from the rows.
   */
  #forgetIfCold(sourceId: string, activity?: { readonly pending: number; readonly lastClosedAt: number | null }): void {
    if (this.#ctx.agents.get(sourceId as SessionId) !== undefined) return
    if (activity !== undefined && activity.pending > 0
      && Date.now() - (activity.lastClosedAt ?? 0) <= COLD_SOURCE_RETENTION_MS) return
    this.#known.delete(sourceId)
    this.#cache.delete(sourceId)
  }

  /** Launch one child run without blocking the evaluation that decided it. */
  #launch(sourceId: string, interval: DetectionInterval | DetectionResume): void {
    const run = interval.kind === 'create'
      ? this.#runNew(sourceId, interval)
      : this.#runResume(sourceId, interval)
    // The run handles its own failure; the shared tracker only keeps a future
    // tick from waiting on a rejected promise and records its retry time.
    this.#children.launch(sourceId, run, RETRY_MS)
  }

  /** Create the detection child, deliver the frozen material, and settle the interval. */
  async #runNew(sourceId: string, interval: DetectionInterval): Promise<void> {
    let handle: AgentHandle | undefined
    try {
      handle = await this.#createChild(sourceId, interval)
      this.#handles.set(sourceId, handle)
      const startSeq = handle.agent.session.seq
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: interval.material }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      await this.#settle(sourceId, interval.ownerShortId, interval.childSession, interval.cutSeq, startSeq, interval)
    } catch (error) {
      // The child never came into existence: there is nothing to resume, so
      // release the claim instead of spending the interval's attempt budget on
      // a child that cannot exist. This mirrors the memory maintenance engine.
      if (handle === undefined) this.#store.resetLearning(sourceId)
      else this.#failed(sourceId, interval.childSession)
      this.#options.log?.('warn', `skill learning interval for ${sourceId} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.#handles.delete(sourceId)
      if (handle !== undefined) await handle.dispose().catch(() => undefined)
    }
  }

  /** Resume the same detection child and continue from its own durable log. */
  async #runResume(sourceId: string, interval: DetectionResume): Promise<void> {
    let handle: AgentHandle | undefined
    try {
      // The child may have disappeared between the claim and this resume (an
      // interrupted first run, a session store reset). There is nothing to
      // resume then; release the interval instead of burning the budget on a
      // child that will never load. Mirrors memory maintenance `#runResume`.
      const stored = await this.#ctx.sessionPersistence.stat(interval.childSession).catch(() => undefined)
      if (stored === undefined) {
        this.#store.resetLearning(sourceId)
        this.#options.log?.('info', `skill learning resume for ${sourceId} found no child session; the interval was released`)
        return
      }
      const frozen = await this.#frozenInterval(sourceId, interval.ownerShortId, interval.cutSeq)
      if (frozen === undefined) {
        this.#failed(sourceId, interval.childSession)
        return
      }
      handle = await this.#resumeChild(interval.childSession, frozen)
      this.#handles.set(sourceId, handle)
      const startSeq = handle.agent.session.seq
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: DETECTION_RETRY_MESSAGE }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      await this.#settle(sourceId, interval.ownerShortId, interval.childSession, interval.cutSeq, startSeq, frozen)
    } catch (error) {
      if (handle === undefined) {
        const stored = await this.#ctx.sessionPersistence.stat(interval.childSession).catch(() => undefined)
        if (stored === undefined) this.#store.resetLearning(sourceId)
        else this.#failed(sourceId, interval.childSession)
      } else {
        this.#failed(sourceId, interval.childSession)
      }
      this.#options.log?.('warn', `skill learning resume for ${sourceId} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.#handles.delete(sourceId)
      if (handle !== undefined) await handle.dispose().catch(() => undefined)
    }
  }

  /**
   * Read the child's durable outcome, resolve ambiguous signals with one
   * independent review child, persist the evidence and settle the interval.
   */
  async #settle(sourceId: string, ownerShortId: number, childSession: SessionId, cutSeq: number,
    startSeq: number, frozen: DetectionInterval): Promise<void> {
    const read = await readSessionEvents(this.#ctx, childSession)
    const events = read.events
    if (!turnCompleted(events, startSeq)) {
      this.#failed(sourceId, childSession)
      return
    }
    const submissions = successfulCalls(events, startSeq, 'submit_signals')
    if (submissions.length !== 1) {
      this.#failed(sourceId, childSession)
      return
    }
    const submission = submissions[0]
    if (submission === undefined) {
      this.#failed(sourceId, childSession)
      return
    }
    let submitted: SubmittedSignal[]
    try {
      submitted = parseSubmission(submission.arguments, frozen)
    } catch (error) {
      this.#failed(sourceId, childSession)
      this.#options.log?.('warn', `skill learning submission for ${sourceId} was invalid: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const ambiguous = submitted.filter(signal => signal.status === SIGNAL_STATUS.uncertain)
    if (ambiguous.length > 0) {
      submitted = await this.#reviewAmbiguous(childSession, cutSeq, frozen.material, submitted, ambiguous)
    }
    try {
      // One immediate transaction stores the evidence and advances the
      // watermark, so a crash can never leave inserted signals behind an
      // unadvanced cut (B3). The store re-checks that this is still our running
      // interval; a stale settle writes nothing.
      this.#store.settleLearning({
        sourceSession: sourceId,
        childSession,
        cutSeq,
        ownerShortId,
        signals: dedupeSubmission(submitted).map(signal => toNewSignal(ownerShortId, sourceId, signal)),
      })
    } catch (error) {
      if (error instanceof SkillStoreError && error.code === 'skills/invalid-learning-state') {
        // Another tick or a restart already settled or released this interval;
        // writing it twice would duplicate immutable evidence.
        this.#children.clearRetry(sourceId)
        this.#cache.delete(sourceId)
        this.#options.log?.('info', `skill learning interval for ${sourceId} was already settled elsewhere; it was not written again`)
        return
      }
      this.#failed(sourceId, childSession)
      this.#options.log?.('warn', `skill learning signals for ${sourceId} were not stored: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.#children.clearRetry(sourceId)
    this.#cache.delete(sourceId)
    this.#options.onSignals(ownerShortId)
  }

  /**
   * The interval one resumed run belongs to.
   *
   * A resume only carries the frozen cut; the material, keys and revocable
   * signals are rebuilt from the same durable positions, so a restart can
   * settle an interval without a transient object.
   */
  async #frozenInterval(sourceId: string, ownerShortId: number, cutSeq: number): Promise<DetectionInterval | undefined> {
    const row = this.#store.learning(sourceId)
    if (row === undefined) return undefined
    const events = await this.#readEvents(sourceId)
    if (events === undefined) return undefined
    const settings = this.#options.settings()
    return {
      kind: 'create',
      ownerShortId,
      childSession: (row.child_session ?? '') as SessionId,
      cutSeq,
      material: assembleLearningMaterial({ events, watermarkSeq: row.watermark_seq, cutSeq, maxCharacters: settings.maxMaterialChars }),
      taskKeys: this.#store.taskKeys(ownerShortId, MAX_EXISTING_TASK_KEYS),
      revocable: this.#store.revocableSignals(ownerShortId, sourceId, MAX_REVOCABLE_SIGNALS),
      watermarkSeq: row.watermark_seq,
    }
  }

  /** One independent review of the ambiguous signals; a review failure fails the interval. */
  async #reviewAmbiguous(parentSession: SessionId, cutSeq: number, material: string,
    submitted: SubmittedSignal[], ambiguous: SubmittedSignal[]): Promise<SubmittedSignal[]> {
    const settings = this.#options.settings()
    const policy = reviewPrompt({ candidates: ambiguous, cutSeq })
    const childSession = `ourfairy-skill-review-${randomUUID()}` as SessionId
    let handle: AgentHandle | undefined
    try {
      handle = await this.#ctx.agents.create({
        sessionId: childSession,
        meta: { parentSession, origin: 'subagent', agentPreset: SKILL_LEARNING_PRESET },
        agentOptions: { provider: settings.provider, model: settings.model },
        setup: learningChildSetup(policy, agentCtx => {
          agentCtx.tools.register(defineTool({
            name: 'submit_review',
            description: 'Submit one judgement for every numbered candidate signal: decisions[].index is 1-based and matches the prompt list, decisions[].status is 0 success, 1 failure or 2 uncertain. Call exactly once.',
            parameters: {
              decisions: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    index: { type: 'integer', required: true },
                    status: { type: 'integer', required: true, enum: [0, 1, 2] },
                    note: { type: 'string' },
                  },
                },
              },
            },
            output: LEARNING_TOOL_OUTPUT,
            execute: async (args) => {
              const decisions = Array.isArray(args.decisions) ? args.decisions : []
              for (const decision of decisions) {
                if (!Number.isSafeInteger(decision.index) || decision.index < 1 || decision.index > ambiguous.length) {
                  throw new Error(`skills/invalid-review: index ${String(decision.index)} is not one of the ${String(ambiguous.length)} candidates`)
                }
                if (decision.status !== 0 && decision.status !== 1 && decision.status !== 2) {
                  throw new Error('skills/invalid-review: status must be 0, 1 or 2')
                }
              }
              return { ok: true, reviewed: decisions.length }
            },
          }))
        }),
      })
      const startSeq = handle.agent.session.seq
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: material }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      const { events } = await readSessionEvents(this.#ctx, childSession)
      if (!turnCompleted(events, startSeq)) throw new SkillError(500, 'skills/review-incomplete', 'the review child did not complete its turn')
      const calls = successfulCalls(events, startSeq, 'submit_review')
      const call = calls[0]
      if (calls.length !== 1 || call === undefined) throw new SkillError(500, 'skills/review-incomplete', 'the review child must submit exactly one structured review')
      const parsed = parseObject(call.arguments)
      const decisions = parsed !== undefined && Array.isArray(parsed.decisions) ? parsed.decisions : []
      const byIndex = new Map<number, number>()
      for (const decision of decisions) {
        if (decision === null || typeof decision !== 'object') continue
        const entry = decision as Record<string, unknown>
        const index = optionalInteger(entry.index)
        const status = optionalInteger(entry.status)
        if (index === undefined || status === undefined || status < 0 || status > 2) continue
        byIndex.set(index, status)
      }
      if (byIndex.size !== ambiguous.length) throw new SkillError(500, 'skills/review-incomplete', 'the review must decide every candidate')
      let cursor = 0
      return submitted.map(signal => {
        if (signal.status !== SIGNAL_STATUS.uncertain) return signal
        const status = byIndex.get(cursor + 1)
        cursor += 1
        if (status === undefined) return signal
        return { ...signal, status }
      })
    } finally {
      if (handle !== undefined) await handle.dispose().catch(() => undefined)
    }
  }

  /** Create one detection child under the current light-model route. */
  #createChild(sourceId: string, interval: DetectionInterval): Promise<AgentHandle> {
    const settings = this.#options.settings()
    const policy = detectionPrompt({
      taskKeys: interval.taskKeys,
      revocable: interval.revocable,
      watermarkSeq: interval.watermarkSeq,
      cutSeq: interval.cutSeq,
    })
    return this.#ctx.agents.create({
      sessionId: interval.childSession,
      meta: { parentSession: sourceId as SessionId, origin: 'subagent', agentPreset: SKILL_LEARNING_PRESET },
      agentOptions: { provider: settings.provider, model: settings.model },
      setup: learningChildSetup(policy, agentCtx => this.#registerSubmitTool(agentCtx, interval)),
    })
  }

  /**
   * The one structured tool a detection child gets.
   *
   * It validates the submission against the frozen interval and answers
   * `{ok:true}`; it never writes. The engine re-validates the durable tool call
   * and persists the rows only after the turn completed, so a crash cannot
   * half-write an interval.
   */
  #registerSubmitTool(agentCtx: Context, interval: DetectionInterval): void {
    agentCtx.tools.register(defineTool({
      name: 'submit_signals',
      description: 'Submit the detection result for this frozen interval. Call it exactly once; an empty signals list is a valid "nothing worth reusing" answer. A signal has taskKey (<task-type>:<artifact>, lower-case kebab-case, at most 64 characters; reuse an existing key when one fits), status 0 success, 1 failure, 2 uncertain or 3 revoked with revokesSignalId, an optional evidenceStartSeq/evidenceEndSeq inside this interval, and an optional short note.',
      parameters: {
        signals: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              taskKey: { type: 'string', required: true },
              status: { type: 'integer', required: true, enum: [0, 1, 2, 3] },
              evidenceStartSeq: { type: 'integer' },
              evidenceEndSeq: { type: 'integer' },
              revokesSignalId: { type: 'integer' },
              note: { type: 'string' },
            },
          },
        },
      },
      output: LEARNING_TOOL_OUTPUT,
      execute: async (args) => {
        const signals = Array.isArray(args.signals) ? args.signals : undefined
        if (signals === undefined) throw new Error('skills/invalid-submission: signals must be a list')
        if (signals.length > MAX_SIGNALS_PER_SUBMISSION) {
          throw new Error(`skills/invalid-submission: at most ${String(MAX_SIGNALS_PER_SUBMISSION)} signals per submission`)
        }
        const revocable = new Set(interval.revocable.map(row => row.id))
        for (const signal of signals) {
          if (!isValidTaskKey(signal.taskKey)) {
            throw new Error(`skills/invalid-task-key: ${JSON.stringify(signal.taskKey)} must be <task-type>:<artifact> kebab-case, at most 64 characters`)
          }
          if (signal.status !== 0 && signal.status !== 1 && signal.status !== 2 && signal.status !== 3) {
            throw new Error('skills/invalid-submission: status must be 0, 1, 2 or 3')
          }
          if (signal.status === 3 && (signal.revokesSignalId === undefined || !revocable.has(signal.revokesSignalId))) {
            throw new Error('skills/invalid-submission: a revocation must name one of the listed revocable signals')
          }
          if (signal.status !== 3 && signal.revokesSignalId !== undefined) {
            throw new Error('skills/invalid-submission: only a status-3 revocation names revokesSignalId')
          }
          if (signal.note !== undefined && [...signal.note].length > MAX_SIGNAL_NOTE_CHARACTERS) {
            throw new Error(`skills/invalid-submission: note is at most ${String(MAX_SIGNAL_NOTE_CHARACTERS)} characters`)
          }
        }
        return { ok: true, accepted: signals.length }
      },
    }))
  }

  /** Resume one persisted detection child under the current light-model route. */
  #resumeChild(childSession: SessionId, interval: DetectionInterval): Promise<AgentHandle> {
    const settings = this.#options.settings()
    const policy = `${detectionPrompt({
      taskKeys: interval.taskKeys,
      revocable: interval.revocable,
      watermarkSeq: interval.watermarkSeq,
      cutSeq: interval.cutSeq,
    })}\n\n${DETECTION_RETRY_MESSAGE}`
    return this.#ctx.agents.resume({
      resumeSessionId: childSession,
      agentOptions: { provider: settings.provider, model: settings.model },
      // A resumed child keeps its own submit tool: the recovery message asks it
      // to submit exactly once, and a missing tool would make that impossible.
      // The frozen material is already in its durable log.
      setup: learningChildSetup(policy, agentCtx => this.#registerSubmitTool(agentCtx, interval)),
    })
  }

  /**
   * Settle one failed run: keep the watermark, remember the same child, and
   * bound retries with the interval's durable attempt count.
   *
   * The count lives in `skill_learning_state.attempts`, so a restart cannot
   * reset it. Once the configured budget is spent the interval is given up in
   * place: no tick ever resumes it again, and only a closed user turn after its
   * frozen cut releases the source (see {@link #releasedFromGiveUp}).
   */
  #failed(sourceId: string, childSession: string): void {
    const settings = this.#options.settings()
    const row = this.#store.learning(sourceId)
    const cutSeq = row?.cut_seq
    if (cutSeq === null || cutSeq === undefined) {
      // No frozen interval to count; release it so the next tick observes the
      // source again. A missing interval is not an attempt.
      this.#store.resetLearning(sourceId)
      return
    }
    let attempts: number
    try {
      attempts = this.#store.failLearning({ sourceSession: sourceId, childSession, retryDelayMs: RETRY_MS })
    } catch (error) {
      if (error instanceof SkillStoreError && error.code === 'skills/invalid-learning-state') {
        // The interval is no longer owned by this child: do not invent state.
        this.#children.clearRetry(sourceId)
        return
      }
      throw error
    }
    if (attempts >= settings.maxTurns) {
      try {
        this.#store.abandonLearning({ sourceSession: sourceId, childSession, cutSeq })
      } catch (error) {
        if (!(error instanceof SkillStoreError && error.code === 'skills/invalid-learning-state')) throw error
      }
      this.#children.clearRetry(sourceId)
      this.#options.log?.('warn', `skill learning for ${sourceId} spent its ${String(settings.maxTurns)}-attempt budget at cut ${String(cutSeq)}; it will not retry until a newer closed user turn`)
      return
    }
    this.#children.defer(sourceId, Date.now() + RETRY_MS)
  }
}

/**
 * Collapse exactly repeated evidence claims inside one submission.
 *
 * A model that lists the same evidence twice would otherwise store two
 * immutable rows for one fact; keep the first row (and its note) only. The
 * identity of a claim is its task key, status, evidence range and revocation
 * target — the free-text note is not part of it.
 */
function dedupeSubmission(signals: readonly SubmittedSignal[]): SubmittedSignal[] {
  const seen = new Set<string>()
  return signals.filter(signal => {
    const identity = JSON.stringify([
      signal.taskKey,
      signal.status,
      signal.evidenceStartSeq,
      signal.evidenceEndSeq,
      signal.revokesSignalId ?? null,
    ])
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

/** Validate one submission against the frozen interval, filling the defaults. */
function parseSubmission(argumentsText: string, interval: DetectionInterval): SubmittedSignal[] {
  const parsed = parseObject(argumentsText)
  if (parsed === undefined || !Array.isArray(parsed.signals)) {
    throw new SkillError(400, 'skills/invalid-submission', 'submit_signals needs a signals list')
  }
  if (parsed.signals.length > MAX_SIGNALS_PER_SUBMISSION) {
    throw new SkillError(400, 'skills/invalid-submission', `at most ${MAX_SIGNALS_PER_SUBMISSION} signals per submission`)
  }
  const revocable = new Map(interval.revocable.map(row => [row.id, row]))
  return parsed.signals.map(raw => {
    if (raw === null || typeof raw !== 'object') throw new SkillError(400, 'skills/invalid-submission', 'every signal must be an object')
    const signal = raw as Record<string, unknown>
    const taskKey = typeof signal.taskKey === 'string' ? signal.taskKey : ''
    if (!isValidTaskKey(taskKey)) {
      throw new SkillError(400, 'skills/invalid-task-key', `a task key must be <task-type>:<artifact> kebab-case, at most 64 characters; got ${JSON.stringify(taskKey)}`)
    }
    const status = optionalInteger(signal.status)
    if (status === undefined || status < 0 || status > 3) throw new SkillError(400, 'skills/invalid-submission', 'a signal status must be 0, 1, 2 or 3')
    let revokesSignalId: number | undefined
    if (status === 3) {
      revokesSignalId = optionalInteger(signal.revokesSignalId)
      if (revokesSignalId === undefined) throw new SkillError(400, 'skills/invalid-submission', 'a revocation needs revokesSignalId')
      const revoked = revocable.get(revokesSignalId)
      if (revoked === undefined) throw new SkillError(400, 'skills/invalid-revocation', `signal ${revokesSignalId} is not a revocable signal of this interval`)
      if (revoked.task_key !== taskKey) {
        throw new SkillError(400, 'skills/invalid-revocation', `a revocation of signal ${revokesSignalId} must keep its task key ${revoked.task_key}`)
      }
    } else if (signal.revokesSignalId !== undefined) {
      throw new SkillError(400, 'skills/invalid-submission', 'only a status-3 revocation names revokesSignalId')
    }
    const note = signal.note === undefined ? undefined : String(signal.note)
    if (note !== undefined && [...note].length > MAX_SIGNAL_NOTE_CHARACTERS) {
      throw new SkillError(400, 'skills/invalid-submission', `a note is at most ${MAX_SIGNAL_NOTE_CHARACTERS} characters`)
    }
    const floor = interval.watermarkSeq
    const ceiling = interval.cutSeq
    const start = Math.min(Math.max(optionalInteger(signal.evidenceStartSeq) ?? floor, floor), Math.max(floor, ceiling - 1))
    const end = Math.min(Math.max(optionalInteger(signal.evidenceEndSeq) ?? ceiling, start + 1), ceiling)
    return {
      taskKey,
      status: status as number,
      evidenceStartSeq: start,
      evidenceEndSeq: end,
      ...(revokesSignalId === undefined ? {} : { revokesSignalId }),
      ...(note === undefined ? {} : { note }),
    }
  })
}

/** Map one validated submission onto the store's row vocabulary. */
function toNewSignal(ownerShortId: number, sourceSession: string, signal: SubmittedSignal): NewSignal {
  return {
    ownerShortId,
    taskKey: signal.taskKey,
    sourceSession,
    evidenceStartSeq: signal.evidenceStartSeq,
    evidenceEndSeq: signal.evidenceEndSeq,
    status: signal.status,
    ...(signal.revokesSignalId === undefined ? {} : { revokesSignalId: signal.revokesSignalId }),
  }
}
