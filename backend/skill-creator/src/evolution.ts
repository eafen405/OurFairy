/**
 * Skill evolution: the growth rule, revision provenance and the helpers the
 * creation/review path uses to turn an approved skill into a new version
 * (#299).
 *
 * Evolution never patches a version in place. A revision is a complete package
 * written through the same candidate path as explicit creation, with a parent
 * version and a stated target benefit; approval switches the current pointer
 * atomically and leaves the old version as history. This module owns the rules
 * that are unique to that path so `creation.ts` keeps one create/review flow:
 * the 110% core-body rule, the benefit requirement, the verification-reuse
 * decision and the growth-confirmation validation against the durable log.
 *
 * @module @ourfairy/dsh-skill-creator/src/evolution
 */
import { SkillError } from './service.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ScenarioRecord } from './verify.js'

/**
 * The growth limit: a revision whose core body exceeds the parent's by more
 * than this factor needs the user's independent confirmation. The comparison is
 * `new > floor(old * 1.1)`, so exactly 110% is not exceeded and 110.1% is.
 */
export const GROWTH_LIMIT = 1.1

/** The target-benefit bound, in Unicode characters. */
export const TARGET_BENEFIT_MAX = 500

/** The growth facts the review package, display and approval all read. */
export interface GrowthFacts {
  readonly exceeded: boolean
  readonly oldCharacters: number | null
  readonly newCharacters: number
  readonly ratio: number | null
}

/**
 * The one growth calculation.
 *
 * @param newCharacters - the candidate's core-body Unicode count.
 * @param oldCharacters - the parent version's core-body count, or null for a
 *   new skill (which has no baseline and never exceeds it).
 */
export function growthOf(newCharacters: number, oldCharacters: number | null): GrowthFacts {
  const exceeded = oldCharacters !== null && newCharacters > Math.floor(oldCharacters * GROWTH_LIMIT)
  return { exceeded, oldCharacters, newCharacters, ratio: oldCharacters === null ? null : newCharacters / oldCharacters }
}

/**
 * Validate the benefit a revision must state.
 *
 * @throws {SkillError} `skills/benefit-required` when it is missing, blank or
 *   longer than {@link TARGET_BENEFIT_MAX}.
 */
export function checkedTargetBenefit(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') {
    throw new SkillError(400, 'skills/benefit-required',
      'a revision needs targetBenefit: the failure, repeated scenario or simplification this version proves')
  }
  if ([...text].length > TARGET_BENEFIT_MAX) {
    throw new SkillError(400, 'skills/benefit-required', `targetBenefit must be at most ${TARGET_BENEFIT_MAX} characters`)
  }
  return text
}

/** One reusable verification record: the parent's run plus the version it came from. */
export interface ReusedScenario extends ScenarioRecord {
  /** The parent version whose recorded run this evidence came from. */
  readonly reusedFrom: number
}

/** The plan for one revision: what is reused and what must run again. */
export interface ReusePlan {
  readonly reused: ReusedScenario[]
  readonly rerun: readonly { readonly name: string; readonly command: string; readonly uses?: readonly string[]; readonly timeoutMs?: number }[]
}

/** A scenario as the creation path declares it (the runner's input shape). */
export interface PlannedScenario {
  readonly name: string
  readonly command: string
  readonly uses?: readonly string[]
  readonly timeoutMs?: number
}

/** The content hashes one scenario's `uses` paths resolve to. */
function usesHashes(uses: readonly string[] | undefined, hashes: ReadonlyMap<string, string>): Map<string, string> | undefined {
  const result = new Map<string, string>()
  for (const path of uses ?? []) {
    const hash = hashes.get(path)
    if (hash === undefined) return undefined
    result.set(path, hash)
  }
  return result
}

/** Whether two `uses` path sets resolve to the same file hashes on both sides. */
function sameUses(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const leftSet = new Set(left ?? [])
  const rightSet = new Set(right ?? [])
  if (leftSet.size !== rightSet.size) return false
  for (const path of leftSet) if (!rightSet.has(path)) return false
  return true
}

/**
 * Decide which of a revision's scenarios can reuse the parent's recorded run.
 *
 * A scenario is reused only when the parent has a recorded run with the same
 * name, the same command, and the same `uses` paths resolving to the same file
 * hashes in the parent and candidate manifests. Anything else runs again in the
 * disposable verification environment; a reused record keeps the parent's
 * recorded facts and names the version it came from, so the review display can
 * say "reused" rather than "executed".
 */
export function planVerificationReuse(input: {
  readonly scenarios: readonly PlannedScenario[]
  readonly candidateHashes: ReadonlyMap<string, string>
  readonly parentHashes: ReadonlyMap<string, string>
  readonly parentReport: { readonly executed: readonly ScenarioRecord[]; readonly reused: readonly ScenarioRecord[] } | undefined
  readonly parentVersionId: number
}): ReusePlan {
  const recorded = new Map<string, ScenarioRecord>()
  for (const record of [...(input.parentReport?.executed ?? []), ...(input.parentReport?.reused ?? [])]) {
    // A reused record may itself carry the original `uses`; both are evidence.
    if (!recorded.has(record.name)) recorded.set(record.name, record)
  }
  const reused: ReusedScenario[] = []
  const rerun: PlannedScenario[] = []
  for (const scenario of input.scenarios) {
    const parent = recorded.get(scenario.name)
    const candidateHashes = usesHashes(scenario.uses, input.candidateHashes)
    const parentHashes = usesHashes(parent?.uses, input.parentHashes)
    if (parent !== undefined && parent.command === scenario.command
      && sameUses(scenario.uses, parent.uses)
      && candidateHashes !== undefined && parentHashes !== undefined
      && [...candidateHashes].every(([path, hash]) => parentHashes.get(path) === hash)) {
      reused.push({ ...parent, reusedFrom: input.parentVersionId })
      continue
    }
    rerun.push(scenario)
  }
  return { reused, rerun }
}

/** One user message that can confirm an exceeded growth. */
export interface GrowthConfirmation {
  readonly messageId: string
  readonly seq: number
  readonly confirmedAt: number
}

/** One `skill_manage` call read from the durable log. */
interface ToolCallFacts {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly seq: number
  readonly callId: string
}

/** Every tool call in one log, in seq order. */
function toolCalls(events: readonly SessionEvent[]): ToolCallFacts[] {
  const calls: ToolCallFacts[] = []
  for (const event of events) {
    if (event.type !== 'tool/call' || event.data.name !== 'skill_manage') continue
    let args: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(event.data.arguments)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
    } catch {
      args = {}
    }
    calls.push({ name: event.data.name, args, seq: event.seq, callId: event.data.callId })
  }
  return calls
}

/** The call ids of successful `skill_manage` results in one log. */
function successfulToolResults(events: readonly SessionEvent[]): Set<string> {
  const succeeded = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const callId = event.data.message.toolCallId
    if (typeof callId === 'string' && event.data.message.isError !== true) succeeded.add(callId)
  }
  return succeeded
}

/**
 * The latest successful `skill_manage inspect` call for one version, or
 * undefined when the caller never inspected it.
 *
 * A failed inspect shows no review display and therefore cannot anchor a
 * confirmation. The seq is the call event's, exactly as the rule records it.
 */
export function latestInspectSeq(events: readonly SessionEvent[], versionId: number): number | undefined {
  const succeeded = successfulToolResults(events)
  let latest: number | undefined
  for (const call of toolCalls(events)) {
    if (!succeeded.has(call.callId)) continue
    if (call.args.action !== 'inspect' || call.args.versionId !== versionId) continue
    if (latest === undefined || call.seq > latest) latest = call.seq
  }
  return latest
}

/** The joined text of one durable user message. */
function userMessageText(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  if ((event.data.source as { kind?: unknown } | undefined)?.kind !== 'user') return undefined
  return event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** The exact text a user replies to confirm an exceeded growth. */
export const GROWTH_CONFIRMATION_TEXT = '确认增长'

/**
 * The confirmation message a pending growth candidate may be approved with.
 *
 * The message must be the caller's own chat message in the same session, with
 * the exact text, and it must come after the latest successful inspect call
 * that displayed this version. Reads the same log the review turn runs in, so a
 * message from another user or session can never match.
 */
export function confirmationOf(input: {
  readonly events: readonly SessionEvent[]
  readonly versionId: number
  readonly messageId: string | undefined
}): GrowthConfirmation | undefined {
  const inspectSeq = latestInspectSeq(input.events, input.versionId)
  if (inspectSeq === undefined) return undefined
  let found: GrowthConfirmation | undefined
  for (const event of input.events) {
    if (event.seq <= inspectSeq) continue
    if (event.type !== 'user/message' || event.data.id !== input.messageId) continue
    if (userMessageText(event)?.trim() !== GROWTH_CONFIRMATION_TEXT) continue
    found = { messageId: event.data.id, seq: event.seq, confirmedAt: event.time }
  }
  return found
}

/**
 * The confirmation message the model may hand to approval, derived without an
 * `inspect` call.
 *
 * The model cannot read durable message ids from its context. `skill_manage
 * list` therefore names, for a growth-exceeded pending candidate, the latest
 * user message with the exact confirmation text that follows the latest
 * successful inspect call. The approval still re-reads the same message by id,
 * so this only bridges discovery: a model cannot confirm on the user's behalf.
 */
export function confirmationCandidate(events: readonly SessionEvent[], versionId: number): GrowthConfirmation | undefined {
  const inspectSeq = latestInspectSeq(events, versionId)
  if (inspectSeq === undefined) return undefined
  let found: GrowthConfirmation | undefined
  for (const event of events) {
    if (event.seq <= inspectSeq) continue
    if (event.type !== 'user/message' || userMessageText(event)?.trim() !== GROWTH_CONFIRMATION_TEXT) continue
    found = { messageId: event.data.id, seq: event.seq, confirmedAt: event.time }
  }
  return found
}

/**
 * The scenarios a rollback verifies.
 *
 * The historical version's approved report is the only record of what that
 * content was verified with; the rollback candidate copies those commands and
 * runs them again in a fresh disposable environment. A report with no scenario
 * at all cannot form a rollback candidate.
 */
export function rollbackScenarios(report: { readonly executed: readonly ScenarioRecord[]; readonly reused: readonly ScenarioRecord[] }): PlannedScenario[] {
  const scenarios: PlannedScenario[] = []
  const names = new Set<string>()
  for (const record of [...report.executed, ...report.reused]) {
    if (names.has(record.name)) continue
    names.add(record.name)
    scenarios.push({
      name: record.name,
      command: record.command,
      ...(record.uses === undefined ? {} : { uses: record.uses }),
    })
  }
  return scenarios
}
