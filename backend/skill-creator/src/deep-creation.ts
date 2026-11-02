/**
 * The cross-session deep-creation engine (#300).
 *
 * The learning engine writes immutable reuse signals. This engine turns the
 * evidence into at most one background skill candidate per owner and canonical
 * task key: after at least two distinct source sessions carry a valid success,
 * one atomic claim freezes the contributing signal ids, and one creation child
 * reads the original evidence and either submits a candidate (new skill or
 * revision), runs its real verification, or explicitly reports no improvement.
 *
 * The claim is the unit of retry. A failed creation keeps its claim and child
 * and is retried independently of any detection watermark; detection keeps
 * running and its own failures keep their own intervals. A restart rebuilds
 * every claim from the database: running jobs resume their persisted child,
 * failed jobs are retried, and new threshold groups are claimed again.
 *
 * The child is an ordinary dsh Agent with `parentSession` naming the newest
 * contributing source, `origin: 'subagent'` and the learning preset, and no
 * `owner` in its header: the claim's owner is captured here and passed through
 * the setup closure. Its scoped world is the four tools below plus the deep
 * creation prompt; it reuses the shipped Skill Creator body from
 * `bundledSkillsDir` rather than a second copy of the creation guidance.
 *
 * @module @ourfairy/dsh-skill-creator/src/deep-creation
 */
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import { readSkillFrontmatter } from './package.js'
import {
  CREATION_POLICY,
  LEARNING_SECTION,
  SKILL_LEARNING_PRESET,
} from './learning-policy.js'
import { assembleLearningMaterial } from './material.js'
import { CREATION_JOB_STATE, SIGNAL_STATUS, type CreationJobRow, type SignalRow, type SkillStore } from './store.js'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SkillCreation } from './creation.js'
import type { SkillService } from './service.js'
import type { LearningSettings } from './learning.js'
// Type-only: the agent-scoped prompt/tool seams and the persistence service the
// child and its evidence reads use.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'

/** How often the engine retries failed claims and looks for new threshold groups. */
const TICK_MS = 1_000
/** How long a failed creation claim waits before its child is resumed. */
const RETRY_MS = 2_000

/** The task message one creation child receives; the evidence is read through its own tool. */
const CREATION_TASK_MESSAGE = '后台技能创建任务。请先用 read_evidence 读取贡献证据，再决定：提交完整技能候选并用 run_verification 验证，或调用 finish_no_improvement 明确说明没有改进。不要创建重复候选。'

/** The continuation written when a failed creation child is resumed. */
const CREATION_RETRY_MESSAGE = '上一轮创建没有完成。请基于这段子会话中已有的材料继续：读取所需证据，提交并验证技能候选，或调用 finish_no_improvement 后结束。'

/** The bounded tool-result/render pair every creation tool answers with. */
const CREATION_TOOL_OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
}

/** The most contributing sessions one prompt lists. */
const MAX_PROMPT_SESSIONS = 8
/** The most existing candidates/current skills one prompt lists. */
const MAX_DEDUPE_ITEMS = 10
/** One dedupe description's bound. */
const DEDUPE_DESCRIPTION_MAX = 200

/** The jobs whose signal set still supports a creation, after later corrections. */
export function validJobSignals(store: SkillStore, job: CreationJobRow): SignalRow[] {
  const valid = new Set(store.validSuccessSignals(job.owner_short_id, job.task_key).map(row => row.id))
  return store.jobSignals(job).filter(row => valid.has(row.id))
}

/** Whether the surviving signals still come from at least two independent sessions. */
export function creationThresholdHolds(signals: readonly SignalRow[]): boolean {
  return new Set(signals.map(signal => signal.source_session)).size >= 2
}

/** One successful tool call in one run. */
function successfulCalls(events: readonly SessionEvent[], startSeq: number, name: string): { readonly arguments: string }[] {
  const succeeded = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result' || event.seq < startSeq) continue
    const callId = event.data.message.toolCallId
    if (typeof callId === 'string' && event.data.message.isError !== true) succeeded.add(callId)
  }
  return events
    .filter((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call'
      && event.seq >= startSeq && event.data.name === name && succeeded.has(event.data.callId))
    .map(event => ({ arguments: event.data.arguments }))
}

/** Whether the child's last ended turn in this run completed. */
function turnCompleted(events: readonly SessionEvent[], startSeq: number): boolean {
  const ending = events.filter(event => event.type === 'turn/end' && event.seq >= startSeq).at(-1)
  return ending !== undefined && ending.type === 'turn/end' && ending.data.reason.kind === 'completed'
}

/** The dependencies the creation engine was constructed with. */
export interface CreationEngineOptions {
  readonly settings: () => LearningSettings
  readonly log?: (level: 'info' | 'warn', message: string) => void
}

export class SkillCreationEngine {
  readonly #ctx: Context
  readonly #store: SkillStore
  readonly #creation: SkillCreation
  readonly #service: SkillService
  readonly #options: CreationEngineOptions
  readonly #active = new Set<number>()
  readonly #runs = new Set<Promise<void>>()
  readonly #handles = new Map<number, AgentHandle>()
  readonly #retryAt = new Map<number, number>()
  /** Jobs launched from a persisted claim, whose attempt was already counted. */
  readonly #recovered = new Set<number>()
  #timer: ReturnType<typeof setInterval> | undefined
  #disposed = false
  #booting = false

  constructor(ctx: Context, store: SkillStore, creation: SkillCreation, service: SkillService, options: CreationEngineOptions) {
    this.#ctx = ctx
    this.#store = store
    this.#creation = creation
    this.#service = service
    this.#options = options
  }

  /** Start the tick and the one restart scan over persisted claims. */
  start(): void {
    this.#timer = setInterval(() => { void this.#tick() }, TICK_MS)
    this.#timer.unref()
    void this.#bootstrap()
  }

  /** Stop the timer, dispose live children and wait for their runs. */
  async close(): Promise<void> {
    this.#disposed = true
    if (this.#timer !== undefined) clearInterval(this.#timer)
    for (const handle of this.#handles.values()) await handle.dispose().catch(() => undefined)
    await Promise.allSettled([...this.#runs])
  }

  /** Re-evaluate one owner's claims after a detection interval produced signals. */
  evaluate(ownerShortId: number): void {
    if (this.#disposed) return
    for (const candidate of this.#store.creationCandidates()) {
      if (candidate.ownerShortId !== ownerShortId) continue
      this.#claim(candidate.ownerShortId, candidate.taskKey)
    }
  }

  /** Retry due failed claims and claim every threshold group no claim owns. */
  async #tick(): Promise<void> {
    if (this.#disposed) return
    for (const job of this.#store.creationJobs()) {
      if (job.state !== CREATION_JOB_STATE.failed || this.#active.has(job.id)) continue
      if ((this.#retryAt.get(job.id) ?? job.next_retry_at ?? 0) > Date.now()) continue
      this.#recovered.add(job.id)
      this.#launch(job)
    }
    for (const candidate of this.#store.creationCandidates()) {
      this.#claim(candidate.ownerShortId, candidate.taskKey)
    }
  }

  /** On boot, rebuild every claim from durable state before claiming anything new. */
  async #bootstrap(): Promise<void> {
    if (this.#booting) return
    this.#booting = true
    try {
      for (const job of this.#store.creationJobs()) {
        if (job.state !== CREATION_JOB_STATE.running && job.state !== CREATION_JOB_STATE.failed) continue
        this.#recovered.add(job.id)
        this.#launch(job)
      }
    } catch {
      // A failed listing is retried by the next tick; the claims stay durable.
    } finally {
      this.#booting = false
    }
  }

  /** Claim one owner/task key if it still meets the threshold; never throws into the tick. */
  #claim(ownerShortId: number, taskKey: string): void {
    if (this.#disposed) return
    const childSession = `ourfairy-skill-creation-${randomUUID()}`
    let claimed
    try {
      claimed = this.#store.claimCreationJob({ ownerShortId, taskKey, childSession })
    } catch (error) {
      this.#options.log?.('warn', `skill creation claim for ${taskKey} failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (!claimed.claimed) return
    this.#launch(claimed.job)
  }

  /** Launch one claim without blocking the evaluation that decided it. */
  #launch(job: CreationJobRow): void {
    if (this.#active.has(job.id)) return
    this.#active.add(job.id)
    const fresh = job.attempts === 1 && !this.#recovered.has(job.id)
    this.#recovered.delete(job.id)
    const run = this.#run(job, fresh)
    let tracked: Promise<void>
    tracked = run.catch(() => {
      this.#retryAt.set(job.id, Date.now() + RETRY_MS)
    }).finally(() => {
      this.#active.delete(job.id)
      this.#runs.delete(tracked)
    })
    this.#runs.add(tracked)
  }

  /**
   * Create or resume one creation child and settle the claim from its durable
   * outcome.
   *
   * A freshly claimed job runs its first attempt; a job recovered at boot or
   * retried after a failure first moves back to running (counting the attempt)
   * and resumes the persisted child when it still exists.
   */
  async #run(launched: CreationJobRow, fresh: boolean): Promise<void> {
    let handle: AgentHandle | undefined
    try {
      if (!fresh) {
        if (!this.#store.resumeCreationJob({ id: launched.id })) return
      }
      const current = this.#store.creationJob(launched.id)
      if (current === undefined) return
      const signals = validJobSignals(this.#store, current)
      if (!creationThresholdHolds(signals)) {
        // Later corrections removed the evidence: complete as a no-op and leave
        // every detection watermark exactly where it is.
        this.#store.completeCreationJob({ id: current.id, state: CREATION_JOB_STATE.noImprovement })
        this.#options.log?.('info', `skill creation claim for ${current.task_key} no longer meets the threshold; completed as a no-op`)
        return
      }
      let resumed = false
      const persisted = current.child_session
      if (!fresh && persisted !== null) {
        const stored = await this.#ctx.sessionPersistence.stat(persisted as SessionId).catch(() => undefined)
        if (stored !== undefined) {
          handle = await this.#resumeChild(current.id, current, signals, persisted as SessionId)
          resumed = true
        }
      }
      if (handle === undefined) {
        handle = await this.#createChild(current.id, current, signals)
      }
      this.#handles.set(current.id, handle)
      const startSeq = handle.agent.session.seq
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: resumed ? CREATION_RETRY_MESSAGE : CREATION_TASK_MESSAGE }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      await this.#settle(current.id, startSeq)
    } catch (error) {
      this.#failed(launched.id)
      this.#options.log?.('warn', `skill creation claim ${String(launched.id)} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.#handles.delete(launched.id)
      if (handle !== undefined) await handle.dispose().catch(() => undefined)
    }
  }

  /** Settle one running claim from the child's durable log and the system's rows. */
  async #settle(jobId: number, startSeq: number): Promise<void> {
    const job = this.#store.creationJob(jobId)
    if (job === undefined) return
    const childSession = job.child_session as SessionId | null
    if (childSession === null) {
      this.#failed(jobId)
      return
    }
    const { events } = await readSessionEvents(this.#ctx, childSession)
    if (!turnCompleted(events, startSeq)) {
      this.#failed(jobId)
      return
    }
    const candidateVersionId = job.candidate_version_id
    if (candidateVersionId !== null) {
      const version = this.#store.version(candidateVersionId)
      if (version === undefined || version.verification === null) {
        // A candidate without a system-recorded verification is not an outcome:
        // resume the child so it can run the recorded scenarios.
        this.#failed(jobId)
        return
      }
      this.#store.completeCreationJob({ id: jobId, state: CREATION_JOB_STATE.candidate, candidateVersionId })
      return
    }
    const noImprovement = successfulCalls(events, startSeq, 'finish_no_improvement')
    if (noImprovement.length === 1) {
      this.#store.completeCreationJob({ id: jobId, state: CREATION_JOB_STATE.noImprovement })
      return
    }
    this.#failed(jobId)
  }

  /** Record one failed run and keep the claim for an independent retry. */
  #failed(jobId: number): void {
    this.#store.failCreationJob({ id: jobId, retryDelayMs: RETRY_MS })
    this.#retryAt.set(jobId, Date.now() + RETRY_MS)
  }

  /** Create one deep-creation child for a claim. */
  async #createChild(jobId: number, job: CreationJobRow, signals: readonly SignalRow[]): Promise<AgentHandle> {
    const childSession = job.child_session === null ? `ourfairy-skill-creation-${randomUUID()}` as SessionId : job.child_session as SessionId
    this.#store.setCreationChild({ id: jobId, childSession })
    const parentSession = triggeringSession(signals, job)
    const policy = this.#prompt(job, signals)
    const route = this.#sourceRoute(parentSession)
    return this.#ctx.agents.create({
      sessionId: childSession,
      meta: { parentSession: parentSession as SessionId, origin: 'subagent', agentPreset: SKILL_LEARNING_PRESET },
      // The deep creation runs on the route its triggering source session used,
      // not the detection light route; a cold source falls back to the
      // deployment's default selection.
      ...(route === undefined ? {} : { agentOptions: route }),
      setup: agentCtx => {
        agentCtx.tools.restrict({ allow: [] })
        this.#registerTools(agentCtx, jobId, job, signals)
        agentCtx.systemPrompt.section({ name: LEARNING_SECTION, order: 0, text: policy, interpolate: false })
      },
    })
  }

  /** The route one live source session currently uses, or undefined when it is cold. */
  #sourceRoute(sourceSession: string): { readonly provider: string; readonly model: string } | undefined {
    const live = this.#ctx.agents.get(sourceSession as SessionId)
    const config = live?.session.requestHeader()?.config
    if (config === undefined) return undefined
    const { provider, model } = config as { provider?: unknown; model?: unknown }
    return typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
      ? { provider, model }
      : undefined
  }

  /** Resume one persisted creation child with the same tools and prompt. */
  async #resumeChild(jobId: number, job: CreationJobRow, signals: readonly SignalRow[], childSession: SessionId): Promise<AgentHandle> {
    const policy = this.#prompt(job, signals)
    const route = this.#sourceRoute(triggeringSession(signals, job))
    return this.#ctx.agents.resume({
      resumeSessionId: childSession,
      ...(route === undefined ? {} : { agentOptions: route }),
      setup: agentCtx => {
        agentCtx.tools.restrict({ allow: [] })
        this.#registerTools(agentCtx, jobId, job, signals)
        agentCtx.systemPrompt.section({ name: LEARNING_SECTION, order: 0, text: `${policy}\n\n${CREATION_RETRY_MESSAGE}`, interpolate: false })
      },
    })
  }

  /**
   * The creation prompt: the contract, the claim's task context, the bounded
   * dedupe lists and the shipped Skill Creator body.
   */
  #prompt(job: CreationJobRow, signals: readonly SignalRow[]): string {
    const parts = [CREATION_POLICY, `任务键：${job.task_key}。`]
    const sessions = [...new Set(signals.map(signal => signal.source_session))].slice(0, MAX_PROMPT_SESSIONS)
    const signalLines = signals.slice(0, MAX_PROMPT_SESSIONS * 4).map(signal =>
      `- 信号 ${signal.id}：${signal.task_key}，证据区间 ${String(signal.evidence_start_seq)}–${String(signal.evidence_end_seq)}，来源会话 ${signal.source_session}`)
    parts.push(`贡献证据（共 ${String(signals.length)} 条成功信号，来自 ${String(sessions.length)} 个独立会话）：\n${signalLines.join('\n')}`)
    parts.push(this.#dedupeSection(job.owner_short_id))
    const body = this.#skillCreatorBody()
    if (body !== '') parts.push(`以下是本次使用的 Skill Creator 指导：\n\n${body}`)
    return parts.join('\n\n')
  }

  /** The bounded list of existing candidates and current skills, so the child can dedupe. */
  #dedupeSection(ownerShortId: number): string {
    const lines: string[] = []
    const pending = this.#store.pendingDrafts(ownerShortId, false, MAX_DEDUPE_ITEMS)
    lines.push(pending.length === 0
      ? '已有待审候选：无。'
      : `已有待审候选：\n${pending.map(row => `- ${row.skill_name}（版本 ${String(row.id)}）：${clip(this.#versionDescription(row), DEDUPE_DESCRIPTION_MAX)}`).join('\n')}`)
    const current = this.#store.visibleIdentities(ownerShortId)
      .filter(row => row.scope === 1 && row.owner_short_id === ownerShortId && row.current_version_id !== null)
      .slice(0, MAX_DEDUPE_ITEMS)
    lines.push(current.length === 0
      ? '当前个人技能：无。'
      : `当前个人技能：\n${current.map(row => {
          const version = row.current_version_id === null ? undefined : this.#store.version(row.current_version_id)
          return `- ${row.name}（技能 ${String(row.id)}，当前版本 ${String(row.current_version_id)}）：${version === undefined ? '' : clip(this.#versionDescription(version), DEDUPE_DESCRIPTION_MAX)}`
        }).join('\n')}`)
    return lines.join('\n')
  }

  /** One version's description, tolerating a missing package. */
  #versionDescription(version: { readonly package_path: string }): string {
    try {
      return readSkillFrontmatter(this.#service.versionDirectory(version as never)).description
    } catch {
      return ''
    }
  }

  /** The shipped Skill Creator body, or an empty string when the deployment lacks it. */
  #skillCreatorBody(): string {
    try {
      return readSkillFrontmatter(`${this.#service.bundledSkillsDir}/skill-creator`).body
    } catch (error) {
      this.#options.log?.('warn', `the bundled Skill Creator could not be read: ${error instanceof Error ? error.message : String(error)}`)
      return ''
    }
  }

  /** Register the four creation tools on one child scope. */
  #registerTools(agentCtx: Context, jobId: number, job: CreationJobRow, signals: readonly SignalRow[]): void {
    const ownerShortId = job.owner_short_id
    const sourceSessions = [...new Set(signals.map(signal => signal.source_session))]
    agentCtx.tools.register(defineTool({
      name: 'read_evidence',
      description: 'Read the bounded original evidence of this claim. With no sourceSession, answer the contributing sessions and their signal ranges; with one, return the interval material for those signals only. The material contains user messages, Fairy replies, attachment names, tool calls with bounded arguments, bounded results and a file-change summary — never the environment or a whole session log.',
      parameters: {
        sourceSession: { type: 'string' },
        startSeq: { type: 'integer' },
        endSeq: { type: 'integer' },
        maxChars: { type: 'integer' },
      },
      output: CREATION_TOOL_OUTPUT,
      execute: async (args) => {
        const wanted = typeof args.sourceSession === 'string' ? args.sourceSession : undefined
        if (wanted === undefined) {
          return {
            ok: true,
            sessions: sourceSessions.map(sourceSession => ({
              sourceSession,
              signals: signals.filter(signal => signal.source_session === sourceSession).map(signal => ({
                id: signal.id,
                taskKey: signal.task_key,
                evidenceStartSeq: signal.evidence_start_seq,
                evidenceEndSeq: signal.evidence_end_seq,
              })),
            })),
          }
        }
        if (!sourceSessions.includes(wanted)) {
          throw new Error(`skills/not-found: ${wanted} is not a contributing source session of this claim`)
        }
        const { events } = await readSessionEvents(this.#ctx, wanted as SessionId)
        const settings = this.#options.settings()
        const maxChars = Math.min(Math.max(args.maxChars ?? settings.maxMaterialChars, 500), settings.maxMaterialChars)
        const chosen = signals.filter(signal => signal.source_session === wanted)
        const perRange = Math.max(200, Math.floor(maxChars / Math.max(1, chosen.length)))
        const text = chosen.map(signal => assembleLearningMaterial({
          events,
          watermarkSeq: signal.evidence_start_seq,
          cutSeq: signal.evidence_end_seq,
          maxCharacters: perRange,
        })).join('\n\n---\n\n')
        return { ok: true, sourceSession: wanted, text: clip(text, maxChars), signals: chosen.map(signal => signal.id) }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'submit_candidate',
      description: 'Submit one complete skill package as a pending candidate. files must include SKILL.md with name and description; scenarios are the representative commands run_verification will execute. A revision of an existing current skill additionally needs parentVersionId and targetBenefit. At most one candidate per claim, and the backend derives the owner, scope and landing path.',
      parameters: {
        files: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', required: true },
              content: { type: 'string' },
              executable: { type: 'boolean' },
            },
          },
        },
        scenarios: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true },
              command: { type: 'string', required: true },
              description: { type: 'string' },
              uses: { type: 'array', items: { type: 'string' } },
              timeoutMs: { type: 'integer' },
            },
          },
        },
        comparisons: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true },
              withSkill: { type: 'string', required: true },
              withoutSkill: { type: 'string', required: true },
            },
          },
        },
        parentVersionId: { type: 'integer' },
        targetBenefit: { type: 'string' },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, enum: ['session', 'test', 'observation'] },
              ref: { type: 'string', required: true },
              note: { type: 'string' },
            },
          },
        },
      },
      output: CREATION_TOOL_OUTPUT,
      execute: async (args) => {
        const current = this.#store.creationJob(jobId)
        if (current === undefined || current.candidate_version_id !== null) {
          throw new Error('skills/invalid-request: this claim already has a candidate')
        }
        const result = await this.#creation.create({
          ownerShortId,
          sessionId: triggeringSession(signals, current),
          events: [],
          scope: 1,
          files: checkedPackageFiles(args.files),
          scenarios: args.scenarios ?? [],
          ...(args.comparisons === undefined ? {} : { comparisons: args.comparisons }),
          ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
          ...(args.parentVersionId === undefined ? {} : { parentVersionId: args.parentVersionId }),
          ...(args.targetBenefit === undefined ? {} : { targetBenefit: args.targetBenefit }),
          background: {
            taskKey: current.task_key,
            signalIds: signals.map(signal => signal.id),
            sourceSessions: [...new Set(signals.map(signal => signal.source_session))],
            creationJobId: current.id,
          },
          deferVerification: true,
        })
        this.#store.setCreationCandidate({ id: jobId, versionId: result.versionId })
        return {
          ok: true,
          versionId: result.versionId,
          skillId: result.skillId,
          status: result.status,
          nextActions: ['run_verification', 'inspect', 'review'],
        }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'run_verification',
      description: 'Run the representative scenarios of the candidate this claim submitted, in the disposable verification environment. The system records the real commands, exit codes and output; the returned summary is the recorded report, never a model claim.',
      parameters: { versionId: { type: 'integer' } },
      output: CREATION_TOOL_OUTPUT,
      execute: async (args) => {
        const current = this.#store.creationJob(jobId)
        const candidate = current?.candidate_version_id ?? null
        if (candidate === null) throw new Error('skills/invalid-request: submit_candidate must run before verification')
        if (args.versionId !== undefined && args.versionId !== candidate) {
          throw new Error(`skills/invalid-request: this claim's candidate is version ${String(candidate)}`)
        }
        return await this.#creation.verifyBackground({ ownerShortId, versionId: candidate }) as unknown as Record<string, never>
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'finish_no_improvement',
      description: 'End this claim with an explicit no-improvement outcome: the existing candidates or current skills already cover the workflow and there is no provable improvement. Requires a short reason. Refused once a candidate exists.',
      parameters: { reason: { type: 'string', required: true } },
      output: CREATION_TOOL_OUTPUT,
      execute: async (args) => {
        const current = this.#store.creationJob(jobId)
        if (current?.candidate_version_id !== null && current?.candidate_version_id !== undefined) {
          throw new Error('skills/invalid-request: a candidate already exists; verify it instead of finishing without improvement')
        }
        const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
        if (reason === '' || [...reason].length > 500) {
          throw new Error('skills/invalid-request: reason must be 1–500 characters')
        }
        return { ok: true, noImprovement: true }
      },
    }))
  }
}

/** The model-supplied package files, refusing a file without text content. */
function checkedPackageFiles(files: readonly { readonly path: string; readonly content?: string; readonly executable?: boolean }[] | undefined) {
  return (files ?? []).map(file => {
    if (typeof file.content !== 'string') throw new Error(`skills/invalid-package: ${file.path} needs text content`)
    return { path: file.path, content: file.content, ...(file.executable === undefined ? {} : { executable: file.executable }) }
  })
}

/** The newest contributing signal's source session: the child's `parentSession`. */
function triggeringSession(signals: readonly SignalRow[], job: CreationJobRow): string {
  const newest = [...signals].sort((left, right) => right.id - left.id)[0]
  return newest?.source_session ?? job.child_session ?? ''
}

/** Cut one string to `max` characters with an ellipsis. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

// The store vocabulary this module reads, re-exported so the row and its tests
// name one module.
export { CREATION_JOB_STATE, SIGNAL_STATUS }
