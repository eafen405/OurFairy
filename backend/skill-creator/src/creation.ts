/**
 * Explicit skill creation, the review package and the review state machine
 * (#297).
 *
 * The runtime service (`./service`) answers "what may this user use". This
 * module answers "what may this user create and approve": it validates the
 * model's draft against the one package algorithm, stages it in the isolated
 * candidate area, resolves the `focus` provenance from the durable session log,
 * runs the disposable verification, and renders the deterministic review
 * package a human decides on. Only an approval moves a candidate into
 * `versions/` and the current-version pointer.
 *
 * The model can never submit an owner, a reviewer, a landing path, a manifest
 * hash or a verification result: those are derived here from the calling
 * session, the package bytes and the recorded run. Revisions, growth
 * confirmation and rollback extend this same create/review flow through
 * `./evolution`; common proposals and installs belong to the sharing ticket.
 *
 * @module @ourfairy/dsh-skill-creator/src/creation
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  PackageError,
  assertPackagePath,
  canonicalManifest,
  copySkillPackage,
  readSkillPackage,
  readSkillFrontmatter,
  writeSkillPackage,
  type ManifestEntry,
  type PackageFileInput,
} from './package.js'
import { SKILL_SCOPE, SOURCE_TYPE, VERSION_STATUS, SkillStoreError } from './store.js'
import { checkedTargetBenefit, confirmationCandidate, confirmationOf, growthOf, planVerificationReuse, rollbackScenarios, type GrowthConfirmation, type ReusedScenario } from './evolution.js'
import { runVerification, type ScenarioRecord, type VerificationReport } from './verify.js'
import { SkillError } from './service.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SkillRow, SkillStore, PendingDraftRow, SkillVersionRow } from './store.js'
import type { SkillService } from './service.js'

/** One candidate's review lifecycle as `inspect` exposes it. */
export const REVIEW_ACTIONS = Object.freeze(['approve', 'request_changes', 'reject'] as const)

/** The actions a review call accepts. */
export type ReviewDecision = typeof REVIEW_ACTIONS[number]

/** One focus: the latest/current turn, a numbered turn, or the current turn plus a task statement. */
export type SkillFocusInput =
  | { readonly kind: 'turn'; readonly turn?: number }
  | { readonly kind: 'task'; readonly text: string }

/** The resolved provenance recorded on the version and shown by inspect. */
export interface FocusProvenance {
  readonly kind: 'turn' | 'task'
  readonly turn: number
  readonly startSeq: number
  readonly endSeq: number
  /** The tool names the focus range actually requested, in call order. */
  readonly toolCalls: string[]
  /** The user's task statement when `kind` is `task`. */
  readonly task?: string
}

/** One model-drafted package file. */
export interface CandidateFile extends PackageFileInput {}

/** One representative verification scenario. */
export interface CandidateScenario {
  readonly name: string
  readonly command: string
  readonly description?: string
  readonly uses?: readonly string[]
  readonly timeoutMs?: number
}

/** One optional with/without comparison. */
export interface CandidateComparison {
  readonly name: string
  readonly withSkill: string
  readonly withoutSkill: string
}

/** One piece of evidence a candidate cites. */
export interface CandidateEvidence {
  readonly kind: 'session' | 'test' | 'observation'
  readonly ref: string
  readonly note?: string
}

/** The facts an explicit `create` call hands the backend. */
export interface CreateCandidateInput {
  readonly ownerShortId: number
  readonly sessionId: string
  /** The caller's durable log, read by the tool before the call. */
  readonly events: readonly SessionEvent[]
  readonly scope: number
  readonly focus: SkillFocusInput
  readonly files: readonly CandidateFile[]
  readonly scenarios: readonly CandidateScenario[]
  readonly comparisons?: readonly CandidateComparison[]
  readonly evidence?: readonly CandidateEvidence[]
  readonly license?: string
  /** The current approved version this candidate revises (#299). */
  readonly parentVersionId?: number
  /** The proven benefit of a revision; required with {@link parentVersionId}. */
  readonly targetBenefit?: string
  readonly signal?: AbortSignal
}

/** What one draft creation produced. */
export interface CreateCandidateResult {
  readonly ok: true
  readonly skillId: number
  readonly versionId: number
  readonly status: number
  readonly nextActions: string[]
  readonly verification: VerificationReport
}

/** One pending candidate as `list` and `/skills/list` expose it. */
export interface PendingItem {
  readonly versionId: number
  readonly skillId: number
  readonly name: string
  readonly scope: number
  readonly sourceType: number
  readonly createdAt: number
  readonly growthExceeded: boolean
  /** The user's own confirmation message the model may cite for approval, when one exists. */
  readonly growthConfirmMessageId?: string
  readonly nextActions: string[]
}

/** One package file in the review package. */
export interface ReviewPackageFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly executable: boolean
}

/** The package difference against the parent version (all added for a new skill). */
export interface ReviewChanges {
  readonly added: string[]
  readonly removed: string[]
  readonly changed: string[]
  readonly summary: string
}

/** The four-block deterministic review display's source facts. */
export interface ReviewPackage {
  readonly versionId: number
  readonly skillId: number
  readonly name: string
  readonly description: string
  readonly scope: number
  readonly ownerShortId: number | null
  readonly proposerShortId: number | null
  readonly source: {
    readonly type: number
    readonly location: string | null
    readonly focus: FocusProvenance | null
    readonly address?: string
    readonly resolvedVersion?: string
  }
  readonly status: number
  readonly manifestHash: string
  readonly parentVersionId: number | null
  readonly growth: { readonly exceeded: boolean; readonly oldCharacters: number | null; readonly newCharacters: number; readonly ratio: number | null }
  readonly coreCharacters: number
  readonly license: string | null
  readonly applicability: { readonly whenToUse: string; readonly notApplicable: string | null }
  readonly benefit: string | null
  readonly package: ReviewPackageFile[]
  /** The manifest entry count before the bounded display list. */
  readonly packageTotal: number
  /** Present when the result budget omitted package entries; the total stays true. */
  readonly packageNote?: string | undefined
  /** Present when the result budget omitted verification records. */
  readonly verificationNote?: string | undefined
  readonly changes: ReviewChanges
  readonly verification: {
    readonly complete: boolean
    readonly executed: VerificationReport['executed']
    readonly reused: VerificationReport['reused']
    readonly unexecuted: VerificationReport['unexecuted']
    readonly failed: VerificationReport['failed']
    readonly comparisons: VerificationReport['comparisons']
    readonly environment: string
    readonly ranAt: number
  }
  readonly nextActions: string[]
  readonly growthConfirmation: {
    readonly required: boolean
    readonly oldCharacters: number | null
    readonly newCharacters: number
    readonly percent: number | null
    readonly instruction: string
  }
}

/** What `inspect` answers. */
export interface InspectResult {
  readonly ok: true
  readonly action: 'inspect'
  readonly kind: 'skill-review'
  readonly review: ReviewPackage
  readonly display: string
  readonly content?: string
  /** True when the result budget cut the requested content expansion. */
  readonly contentTruncated?: boolean
  readonly file?: { readonly path: string; readonly content: string; readonly truncated: boolean }
}

/** What one rollback produced. */
export interface RollbackResult {
  readonly ok: true
  readonly skillId: number
  readonly versionId: number
  readonly status: number
  readonly nextActions: string[]
  readonly verification: VerificationReport
}

/** One review outcome. */
export interface ReviewResult {
  readonly ok: true
  readonly versionId: number
  readonly skillId: number
  readonly scope: number
  readonly status: number
  readonly nextActions: string[]
  readonly previousVersionId: number | null
}

/** The display bound; the full text is always available through `expand`. */
export const DISPLAY_MAX_CHARACTERS = 4_000

/** The one instruction a growth-exceeded display must never lose. */
export const GROWTH_INSTRUCTION = '篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」'

/**
 * The inspect tool result budget, in serialized characters.
 *
 * The product's tool-result spill policy rewrites an oversized result before it
 * is appended, and the chat projection can only derive a `skill-review` row
 * while the result is still parseable JSON. The default inspect therefore keeps
 * its whole serialized envelope well under the native 8192-character prune
 * threshold; the package list, verification summaries and display shave down in
 * a fixed order, and an explicit `expand` request is itself bounded the same
 * way (with `truncated` flags) so it can never be silently rewritten either.
 */
export const INSPECT_RESULT_MAX_CHARACTERS = 7_600

/** One verification record's stream summary bound inside the inspect result. */
const INSPECT_STREAM_SUMMARY_MAX = 160
/** One verification command bound inside the inspect result. */
const INSPECT_COMMAND_MAX = 300
/** The display may never be shaved below this before a result is refused as oversized. */
const INSPECT_DISPLAY_FLOOR = 300
/** The provenance/source string bound inside the inspect result. */
const INSPECT_LOCATION_MAX = 1_000

/** Cut one string to `max` characters with an ellipsis, never returning empty for a non-empty input. */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** One verification record with its long fields bounded for the inspect envelope. */
function compactVerificationRecord(record: VerificationReport['executed'][number]): VerificationReport['executed'][number] {
  return {
    ...record,
    command: clipText(record.command, INSPECT_COMMAND_MAX),
    stdoutSummary: clipText(record.stdoutSummary, INSPECT_STREAM_SUMMARY_MAX),
    stderrSummary: clipText(record.stderrSummary, INSPECT_STREAM_SUMMARY_MAX),
    ...(record.reason === undefined ? {} : { reason: clipText(record.reason, INSPECT_STREAM_SUMMARY_MAX) }),
  }
}

/** The mutable review shape the serializer shaves down. */
type BoundedReview = Omit<ReviewPackage, 'package' | 'changes' | 'verification' | 'source' | 'applicability'> & {
  readonly source: Omit<ReviewPackage['source'], 'location'> & { location: string | null }
  readonly applicability: { readonly whenToUse: string; readonly notApplicable: string | null }
  readonly package: ReviewPackage['package'][number][]
  readonly changes: { added: string[]; removed: string[]; changed: string[]; summary: string }
  readonly verification: {
    complete: boolean
    executed: VerificationReport['executed'][number][]
    reused: VerificationReport['reused'][number][]
    unexecuted: VerificationReport['unexecuted'][number][]
    failed: VerificationReport['failed'][number][]
    comparisons: { name: string; withSkill: VerificationReport['executed'][number]; withoutSkill: VerificationReport['executed'][number] }[]
    environment: string
    ranAt: number
  }
  packageNote?: string | undefined
  verificationNote?: string | undefined
}

/**
 * Bound one inspect result's serialized size deterministically.
 *
 * The four display blocks are composed from the full package first, so the
 * counts the user reads stay true even when the machine-readable lists below
 * them are trimmed. The envelope is then shaved in a fixed order — package
 * entries, verification records, changed-path lists, expanded content, and
 * finally the display — until `JSON.stringify(result)` fits the budget. Notes
 * name what was omitted and where to get it, and `packageTotal` always carries
 * the true manifest count.
 */
export function boundInspectResult(result: InspectResult): InspectResult {
  let bounded: InspectResult = { ...result }
  let display = result.display
  // The growth instruction is the one line the user must act on; every later
  // clip of the display reserves room for it and appends it again.
  const tail = result.review.growthConfirmation.required ? GROWTH_INSTRUCTION : undefined
  const boundDisplayText = (text: string, max: number): string => {
    if (tail === undefined) return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
    const reserved = [...tail].length + 1
    if (max <= reserved) return tail
    const limit = max - reserved
    const body = text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
    return `${body}\n${tail}`
  }
  const review: BoundedReview = {
    ...result.review,
    source: {
      ...result.review.source,
      location: result.review.source.location === null ? null : clipText(result.review.source.location, INSPECT_LOCATION_MAX),
    },
    applicability: {
      whenToUse: clipText(result.review.applicability.whenToUse, 500),
      notApplicable: result.review.applicability.notApplicable === null
        ? null
        : clipText(result.review.applicability.notApplicable, 500),
    },
    package: [...result.review.package],
    changes: {
      added: [...result.review.changes.added],
      removed: [...result.review.changes.removed],
      changed: [...result.review.changes.changed],
      summary: result.review.changes.summary,
    },
    verification: {
      complete: result.review.verification.complete,
      executed: result.review.verification.executed.map(compactVerificationRecord),
      reused: result.review.verification.reused.map(compactVerificationRecord),
      unexecuted: result.review.verification.unexecuted.map(compactVerificationRecord),
      failed: result.review.verification.failed.map(compactVerificationRecord),
      comparisons: result.review.verification.comparisons.map(comparison => ({
        name: comparison.name,
        withSkill: compactVerificationRecord(comparison.withSkill),
        withoutSkill: compactVerificationRecord(comparison.withoutSkill),
      })),
      environment: clipText(result.review.verification.environment, 300),
      ranAt: result.review.verification.ranAt,
    },
  }
  const length = () => JSON.stringify({ ...bounded, review, display }).length
  let droppedVerification = 0
  const noteVerification = () => {
    review.verificationNote = `已省略 ${droppedVerification} 条验证记录；完整报告保存在该版本的验证记录中。`
  }
  while (length() > INSPECT_RESULT_MAX_CHARACTERS) {
    if (review.package.length > 0) {
      const drop = Math.max(1, Math.ceil(review.package.length / 2))
      review.package.splice(Math.max(0, review.package.length - drop), drop)
      review.packageNote = `已省略 ${review.packageTotal - review.package.length} 个文件；用 expand: 'files' 与 path 读取单个文件。`
      continue
    }
    const lists = [review.verification.unexecuted, review.verification.failed, review.verification.executed]
    let dropped = false
    for (const list of lists) {
      const floor = list === review.verification.executed ? 1 : 0
      if (list.length <= floor) continue
      const drop = Math.max(1, Math.ceil((list.length - floor) / 2))
      list.splice(Math.max(floor, list.length - drop), drop)
      droppedVerification += drop
      noteVerification()
      dropped = true
      break
    }
    if (dropped) continue
    if (review.verification.comparisons.length > 0) {
      const drop = Math.max(1, Math.ceil(review.verification.comparisons.length / 2))
      review.verification.comparisons.splice(Math.max(0, review.verification.comparisons.length - drop), drop)
      droppedVerification += drop
      noteVerification()
      continue
    }
    const changeLists = [review.changes.added, review.changes.removed, review.changes.changed]
    let droppedChanges = false
    for (const list of changeLists) {
      if (list.length <= 1) continue
      list.splice(Math.max(1, Math.ceil(list.length / 2)))
      droppedChanges = true
      break
    }
    if (droppedChanges) continue
    if (bounded.content !== undefined && bounded.content.length > 400) {
      bounded = { ...bounded, content: clipText(bounded.content, Math.max(400, bounded.content.length - 1_000)), contentTruncated: true }
      continue
    }
    if (bounded.file !== undefined && bounded.file.content.length > 400) {
      bounded = {
        ...bounded,
        file: { ...bounded.file, content: clipText(bounded.file.content, Math.max(400, bounded.file.content.length - 1_000)), truncated: true },
      }
      continue
    }
    if (display.length > INSPECT_DISPLAY_FLOOR) {
      display = boundDisplayText(display, Math.max(INSPECT_DISPLAY_FLOOR, display.length - 1_000))
      continue
    }
    break
  }
  // The floor path should always fit; this is the last deterministic guarantee
  // that the JSON stays parseable and the review marker survives.
  if (length() > INSPECT_RESULT_MAX_CHARACTERS) {
    const withoutDisplay = JSON.stringify({ ...bounded, review, display: '' }).length
    display = boundDisplayText(display, Math.max(1, INSPECT_RESULT_MAX_CHARACTERS - withoutDisplay - 1))
  }
  const boundedReview = review as ReviewPackage
  return { ...bounded, review: boundedReview, display }
}

/** The full-file expansion bound; a larger file is cut with an explicit flag. */
const EXPANSION_MAX_CHARACTERS = 32_000

/** The bounded package list; a package larger than this reports its total. */
const PACKAGE_LIST_LIMIT = 64

/** The most representative scenarios one candidate may declare. */
const MAX_SCENARIOS = 20
/** The most comparisons one candidate may declare. */
const MAX_COMPARISONS = 5
/** The longest scenario command or comparison command. */
const MAX_COMMAND_CHARACTERS = 2_000
/** The most evidence entries one candidate may cite. */
const MAX_EVIDENCE = 20

/** The sections one `source_location` may carry. */
interface SourceProvenance {
  readonly sessionId?: string
  readonly focus?: FocusProvenance
  readonly evidence?: CandidateEvidence[]
  readonly address?: string
  readonly resolvedVersion?: string
  readonly benefit?: string
  /** The historical version a rollback candidate restores (#299). */
  readonly rollbackOf?: number
}

/** The latest event seq in one log prefix, or 0 for an empty log. */
function lastSeq(events: readonly SessionEvent[]): number {
  return events.length === 0 ? 0 : (events[events.length - 1] as SessionEvent).seq
}

/**
 * Resolve the focus the user named against the caller's durable log.
 *
 * A turn focus needs a real `turn/start`; the range is its `turn/end`, or the
 * log end while the turn is still open. A task focus uses the latest turn and
 * keeps the user's task statement with the provenance. This is metadata: it
 * bounds what the model was told to read, it does not itself read the log for
 * the model.
 *
 * @throws {SkillError} when the log has no turn, the number is unknown/out of
 *   range, or the task statement is empty/too long.
 */
export function resolveFocus(events: readonly SessionEvent[], focus: SkillFocusInput): FocusProvenance {
  if (focus === null || typeof focus !== 'object') {
    throw new SkillError(400, 'skills/invalid-focus', 'create needs focus: {"kind":"turn"} or {"kind":"task","text":"..."}')
  }
  const turns = new Map<number, { start: number; end?: number }>()
  for (const event of events) {
    if (event.type === 'turn/start') turns.set(event.data.turn, { start: event.seq })
    else if (event.type === 'turn/end') {
      const turn = turns.get(event.data.turn)
      if (turn !== undefined) turn.end = event.seq
    }
  }
  if (turns.size === 0) {
    throw new SkillError(400, 'skills/no-focus', 'the session has no turn to use as focus; complete one real exchange first')
  }
  const latestTurn = Math.max(...turns.keys())
  let turn: number
  let task: string | undefined
  if (focus.kind === 'turn') {
    turn = focus.turn ?? latestTurn
    if (!Number.isSafeInteger(turn) || turn < 1 || turn > latestTurn) {
      throw new SkillError(400, 'skills/invalid-focus', `turn ${String(focus.turn)} does not exist; the latest turn is ${latestTurn}`)
    }
  } else if (focus.kind === 'task') {
    if (typeof focus.text !== 'string' || focus.text.trim() === '') {
      throw new SkillError(400, 'skills/invalid-focus', 'a task focus needs a non-empty text of at most 2000 characters')
    }
    task = focus.text.trim()
    if ([...task].length > 2_000) {
      throw new SkillError(400, 'skills/invalid-focus', 'a task focus needs a non-empty text of at most 2000 characters')
    }
    turn = latestTurn
  } else {
    throw new SkillError(400, 'skills/invalid-focus', 'focus.kind must be "turn" or "task"')
  }
  const range = turns.get(turn)
  if (range === undefined) throw new SkillError(400, 'skills/invalid-focus', `turn ${turn} does not exist`)
  const endSeq = range.end ?? lastSeq(events)
  const toolCalls = events
    .filter(event => event.seq >= range.start && event.seq <= endSeq && event.type === 'tool/call')
    .map(event => event.type === 'tool/call' ? event.data.name : '')
  return {
    kind: focus.kind,
    turn,
    startSeq: range.start,
    endSeq,
    toolCalls,
    ...(task === undefined ? {} : { task }),
  }
}

/** Parse one stored source location defensively; a legacy plain string has no focus. */
export function parseSourceLocation(location: string | null): SourceProvenance {
  if (location === null) return {}
  try {
    const parsed: unknown = JSON.parse(location)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const candidate = parsed as SourceProvenance
    return candidate
  } catch {
    return {}
  }
}

/** One scenario, validated against the package and the configured ceiling. */
function checkedScenarios(scenarios: readonly CandidateScenario[], packagePaths: ReadonlySet<string>, timeoutMs: number): CandidateScenario[] {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new SkillError(400, 'skills/invalid-scenario', 'create needs at least one representative verification scenario')
  }
  if (scenarios.length > MAX_SCENARIOS) {
    throw new SkillError(400, 'skills/invalid-scenario', `a candidate may declare at most ${MAX_SCENARIOS} scenarios`)
  }
  const names = new Set<string>()
  return scenarios.map(scenario => {
    if (scenario === null || typeof scenario !== 'object') throw new SkillError(400, 'skills/invalid-scenario', 'every scenario must be an object')
    const name = typeof scenario.name === 'string' ? scenario.name.trim() : ''
    if (name === '' || [...name].length > 120) throw new SkillError(400, 'skills/invalid-scenario', 'a scenario needs a name of at most 120 characters')
    if (names.has(name)) throw new SkillError(400, 'skills/invalid-scenario', `scenario name ${name} is repeated`)
    names.add(name)
    const command = typeof scenario.command === 'string' ? scenario.command.trim() : ''
    if (command === '' || [...command].length > MAX_COMMAND_CHARACTERS) {
      throw new SkillError(400, 'skills/invalid-scenario', `scenario ${name} needs a non-empty command of at most ${MAX_COMMAND_CHARACTERS} characters`)
    }
    const uses = scenario.uses ?? []
    if (!Array.isArray(uses)) throw new SkillError(400, 'skills/invalid-scenario', `scenario ${name} uses must be a list of package paths`)
    for (const path of uses) {
      if (typeof path !== 'string') throw new SkillError(400, 'skills/invalid-scenario', `scenario ${name} uses a non-string path`)
      try {
        assertPackagePath(path)
      } catch (error) {
        throw new SkillError(400, 'skills/invalid-scenario', `scenario ${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!packagePaths.has(path)) throw new SkillError(400, 'skills/invalid-scenario', `scenario ${name} uses ${path}, which is not in the package`)
    }
    if (scenario.timeoutMs !== undefined && (!Number.isSafeInteger(scenario.timeoutMs) || scenario.timeoutMs < 1_000 || scenario.timeoutMs > timeoutMs)) {
      throw new SkillError(400, 'skills/invalid-scenario', `scenario ${name} timeoutMs must be an integer from 1000 to ${timeoutMs}`)
    }
    return { name, command, ...(scenario.description === undefined ? {} : { description: String(scenario.description) }), uses,
      ...(scenario.timeoutMs === undefined ? {} : { timeoutMs: scenario.timeoutMs }) }
  })
}

/** Validate comparisons the same way their commands will run. */
function checkedComparisons(comparisons: readonly CandidateComparison[] | undefined): CandidateComparison[] {
  if (comparisons === undefined) return []
  if (!Array.isArray(comparisons) || comparisons.length > MAX_COMPARISONS) {
    throw new SkillError(400, 'skills/invalid-comparison', `a candidate may declare at most ${MAX_COMPARISONS} comparisons`)
  }
  return comparisons.map(comparison => {
    const name = typeof comparison?.name === 'string' ? comparison.name.trim() : ''
    if (name === '') throw new SkillError(400, 'skills/invalid-comparison', 'a comparison needs a name')
    for (const key of ['withSkill', 'withoutSkill'] as const) {
      const command = typeof comparison[key] === 'string' ? comparison[key].trim() : ''
      if (command === '' || [...command].length > MAX_COMMAND_CHARACTERS) {
        throw new SkillError(400, 'skills/invalid-comparison', `comparison ${name} needs a ${key} command of at most ${MAX_COMMAND_CHARACTERS} characters`)
      }
    }
    return { name, withSkill: comparison.withSkill.trim(), withoutSkill: comparison.withoutSkill.trim() }
  })
}

/** Validate the evidence a candidate cites; it is provenance, never execution. */
function checkedEvidence(evidence: readonly CandidateEvidence[] | undefined): CandidateEvidence[] {
  if (evidence === undefined) return []
  if (!Array.isArray(evidence) || evidence.length > MAX_EVIDENCE) {
    throw new SkillError(400, 'skills/invalid-evidence', `a candidate may cite at most ${MAX_EVIDENCE} evidence entries`)
  }
  return evidence.map(entry => {
    const kind = entry?.kind
    if (kind !== 'session' && kind !== 'test' && kind !== 'observation') {
      throw new SkillError(400, 'skills/invalid-evidence', 'evidence.kind must be "session", "test" or "observation"')
    }
    const ref = typeof entry.ref === 'string' ? entry.ref.trim() : ''
    if (ref === '' || [...ref].length > 500) throw new SkillError(400, 'skills/invalid-evidence', 'evidence.ref must be 1–500 characters')
    if (entry.note !== undefined && (typeof entry.note !== 'string' || [...entry.note].length > 500)) {
      throw new SkillError(400, 'skills/invalid-evidence', 'evidence.note must be at most 500 characters')
    }
    return { kind, ref, ...(entry.note === undefined ? {} : { note: entry.note }) }
  })
}

/** Map one store refusal onto the creation module's route/tool error vocabulary. */
function asSkillError(error: unknown): never {
  if (error instanceof SkillError) throw error
  if (error instanceof PackageError) throw new SkillError(400, error.code, error.message)
  if (error instanceof SkillStoreError) {
    const status = error.code === 'skills/not-found' ? 404
      : error.code === 'skills/name-conflict' || error.code === 'skills/archived' || error.code === 'skills/not-pending' || error.code === 'skills/changed' ? 409
        : 400
    throw new SkillError(status, error.code, error.message)
  }
  throw error instanceof Error ? error : new Error(String(error))
}

/** The scope label the display uses. */
function scopeLabel(scope: number): string {
  return scope === SKILL_SCOPE.common ? '共有' : '个人'
}

/** Round one percentage to a readable decimal. */
function percentText(ratio: number): string {
  const percent = (ratio - 1) * 100
  const rounded = Math.round(percent * 10) / 10
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}%`
}

/** The core-body change line of the review display. */
function characterChange(review: Pick<ReviewPackage, 'growth' | 'coreCharacters'>): string {
  const old = review.growth.oldCharacters
  if (old === null) return `新技能，${review.coreCharacters} 字符`
  // A zero-length parent body has no meaningful percentage; name the counts.
  if (old === 0) return `核心正文 0 → ${review.coreCharacters} 字符`
  return `核心正文 ${old} → ${review.coreCharacters} 字符（${percentText(review.coreCharacters / old)}）`
}

/**
 * Bound a display string while preserving a required instruction line.
 *
 * The growth instruction is the one line the user must act on, so it is never
 * the part a long verification list clips away: the body is cut first and the
 * tail is appended after it.
 */
function boundDisplay(text: string, tail?: string): string {
  const reserved = tail === undefined ? 0 : tail.length + 1
  const budget = Math.max(1, DISPLAY_MAX_CHARACTERS - reserved)
  const body = text.length <= budget ? text : `${text.slice(0, budget - 1)}…`
  return tail === undefined ? body : `${body}\n${tail}`
}

/**
 * Compose the deterministic `skill-review` display from the review package.
 *
 * Four blocks, in the order the user reads them: candidate identity and change
 * size, applicability/benefit, package and verification evidence, and how to
 * expand the full text. No model call writes any of this.
 */
export function buildReviewDisplay(review: ReviewPackage): string {
  const lines: string[] = []
  lines.push(`技能候选 ${review.name}（${scopeLabel(review.scope)}，版本 ${review.versionId}，哈希 ${review.manifestHash}）`)
  lines.push(review.changes.summary)
  lines.push(characterChange(review))
  lines.push(`适用：${review.applicability.whenToUse}`)
  if (review.applicability.notApplicable !== null) lines.push(`不适用：${review.applicability.notApplicable}`)
  if (review.benefit !== null) lines.push(`目标收益：${review.benefit}`)
  lines.push(`包内容：新增 ${review.changes.added.length} 个，删除 ${review.changes.removed.length} 个，修改 ${review.changes.changed.length} 个`)
  const verification = review.verification
  lines.push(`验证：实际执行 ${verification.executed.length}，复用 ${verification.reused.length}，未执行 ${verification.unexecuted.length}，失败 ${verification.failed.length}`)
  for (const record of verification.executed) lines.push(`✔ ${record.name}: ${record.command} → exit ${String(record.exitCode)}`)
  for (const record of verification.reused) {
    const source = typeof record.reusedFrom === 'number' ? `复用自版本 ${record.reusedFrom}` : '复用'
    lines.push(`↺ ${record.name}: ${record.command} → ${source}`)
  }
  for (const record of verification.failed) lines.push(`✘ ${record.name}: ${record.command} → exit ${record.exitCode === null ? '—' : String(record.exitCode)}`)
  for (const comparison of verification.comparisons) {
    lines.push(`比较 ${comparison.name}：有 Skill exit ${String(comparison.withSkill.exitCode)}，无 Skill exit ${String(comparison.withoutSkill.exitCode)}`)
  }
  if (verification.executed.length + verification.reused.length + verification.failed.length > 0) lines.push(`环境：${verification.environment}`)
  lines.push(`查看全文：skill_manage inspect versionId=${review.versionId} expand=skill（单文件：expand=files path=<path>）`)
  return boundDisplay(lines.join('\n'), review.growthConfirmation.required ? GROWTH_INSTRUCTION : undefined)
}

/** The review-package differences between one manifest and its parent's. */
function changesOf(manifest: readonly ManifestEntry[], parent: readonly ManifestEntry[] | undefined): ReviewChanges {
  if (parent === undefined) {
    return { added: manifest.map(entry => entry.path), removed: [], changed: [],
      summary: `新技能，包内 ${manifest.length} 个文件` }
  }
  const before = new Map(parent.map(entry => [entry.path, entry]))
  const after = new Map(manifest.map(entry => [entry.path, entry]))
  const added = [...after.keys()].filter(path => !before.has(path)).sort()
  const removed = [...before.keys()].filter(path => !after.has(path)).sort()
  const changed = [...after].filter(([path, entry]) => {
    const previous = before.get(path)
    return previous !== undefined && (previous.sha256 !== entry.sha256 || previous.executable !== entry.executable)
  }).map(([path]) => path).sort()
  return { added, removed, changed, summary: `相对父版本：新增 ${added.length} 个，删除 ${removed.length} 个，修改 ${changed.length} 个` }
}

/** The review package's applicability fields, from optional flat frontmatter. */
function applicabilityOf(dir: string, description: string): ReviewPackage['applicability'] {
  try {
    const frontmatter = readSkillFrontmatter(dir)
    const whenToUse = frontmatter.attributes.whenToUse
    const notApplicable = frontmatter.attributes['not-applicable']
    return {
      whenToUse: typeof whenToUse === 'string' && whenToUse.trim() !== '' ? whenToUse.trim() : description,
      notApplicable: typeof notApplicable === 'string' && notApplicable.trim() !== '' ? notApplicable.trim() : null,
    }
  } catch {
    return { whenToUse: description, notApplicable: null }
  }
}

/** One review package's bounded file list, read from the candidate directory. */
function packageFiles(dir: string, manifest: readonly ManifestEntry[]): ReviewPackageFile[] {
  return manifest.slice(0, PACKAGE_LIST_LIMIT).map(entry => {
    let bytes = 0
    try {
      bytes = statSync(join(dir, ...entry.path.split('/'))).size
    } catch {
      bytes = 0
    }
    return { path: entry.path, bytes, sha256: entry.sha256, executable: entry.executable }
  })
}

/** The verification report shape inspect exposes; a missing report is incomplete. */
function verificationOf(version: SkillVersionRow): ReviewPackage['verification'] {
  const empty = {
    complete: false,
    executed: [],
    reused: [],
    unexecuted: [],
    failed: [],
    comparisons: [],
    environment: '',
    ranAt: version.created_at,
  } satisfies ReviewPackage['verification']
  if (version.verification === null) return empty
  try {
    const parsed = JSON.parse(version.verification) as Partial<VerificationReport>
    return {
      complete: parsed.complete === true,
      executed: parsed.executed ?? [],
      reused: parsed.reused ?? [],
      unexecuted: parsed.unexecuted ?? [],
      failed: parsed.failed ?? [],
      comparisons: parsed.comparisons ?? [],
      environment: typeof parsed.environment === 'string' ? parsed.environment : '',
      ranAt: typeof parsed.ranAt === 'number' ? parsed.ranAt : version.created_at,
    }
  } catch {
    return empty
  }
}

/** The approval verdict a verification report must satisfy. */
function verificationReason(report: ReviewPackage['verification']): string | undefined {
  if (!report.complete) return 'the verification report is incomplete; run it again'
  if (report.executed.length === 0 && report.reused.length === 0) {
    return 'the verification report has no executed or reused scenario'
  }
  if (report.unexecuted.length > 0) return 'the verification report has unexecuted scenarios'
  if (report.failed.length > 0) return 'a verification scenario failed; change the candidate and verify it again'
  return undefined
}

/** The one review-permission function; the sharing ticket extends the common branch. */
export function canReview(shortId: number, skill: SkillRow): boolean {
  if (skill.scope === SKILL_SCOPE.personal) return skill.owner_short_id === shortId
  // #298: a common candidate is reviewable by Phaethon, and visible to its
  // proposer. This ticket cannot create one, so the branch stays closed.
  return false
}

/** The creation module's dependencies: the store, the runtime service and the data root. */
export interface SkillCreationOptions {
  readonly root: string
  /** The per-scenario verification ceiling from the row Config. */
  readonly verifyTimeoutMs: number
}

export class SkillCreation {
  readonly #store: SkillStore
  readonly #service: SkillService
  readonly #root: string
  readonly #verifyTimeoutMs: number

  constructor(store: SkillStore, service: SkillService, options: SkillCreationOptions) {
    this.#store = store
    this.#service = service
    this.#root = options.root
    this.#verifyTimeoutMs = options.verifyTimeoutMs
  }

  /** The data root the row owns; the route needs the same value the service answers. */
  get root(): string {
    return this.#root
  }

  /**
   * The pending candidates one caller may review, newest first and bounded.
   *
   * When the caller's durable log is supplied, a growth-exceeded candidate also
   * carries the id of the user's own confirmation message that followed its
   * latest inspect display. The model cannot read durable message ids from its
   * context, so this is the one discovery path; approval re-reads the same
   * message by id and never trusts this value alone.
   */
  pending(shortId: number, context: { readonly events?: readonly SessionEvent[] } = {}): PendingItem[] {
    return this.#store.pendingDrafts(shortId).map(row => this.#pendingItem(row,
      row.growth_exceeded === 1 && context.events !== undefined
        ? confirmationCandidate(context.events, row.id)
        : undefined))
  }

  /**
   * Validate, stage, record and verify one explicit candidate or revision.
   *
   * The file set is written to `tmp/<uuid>/`, re-read by the one package
   * algorithm, moved into `candidates/<uuid>/` and only then inserted. A name
   * that already has an approved current version needs `parentVersionId` (the
   * evolution path, `source_type: 3`); without it the conflict is refused. A
   * revision is a complete rewrite, so the package replaces the parent's files
   * rather than patching them. The candidate never enters a provider; only an
   * approved version is served.
   */
  async create(input: CreateCandidateInput): Promise<CreateCandidateResult> {
    try {
      if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new SkillError(400, 'skills/invalid-package', 'create needs the complete package files, including SKILL.md')
      }
      const revision = this.#revisionContext(input)
      if (revision === undefined && input.scope !== SKILL_SCOPE.personal) {
        throw new SkillError(400, 'skills/common-unsupported', 'common skills need the sharing ticket; create a personal skill for now')
      }
      const focus = resolveFocus(input.events, input.focus)
      const evidence = checkedEvidence(input.evidence)
      const staging = join(this.#root, 'tmp', randomUUID())
      const candidateId = randomUUID()
      let candidateDir: string | undefined
      try {
        writeSkillPackage(staging, input.files)
        const parsed = readSkillPackage(staging)
        if (revision !== undefined && parsed.name !== revision.skill.name) {
          throw new SkillError(400, 'skills/invalid-parent',
            `a revision keeps the identity name "${revision.skill.name}"; got "${parsed.name}"`)
        }
        if (revision === undefined) {
          const existing = this.#store.activeIdentity({
            scope: SKILL_SCOPE.personal,
            ownerShortId: input.ownerShortId,
            name: parsed.name,
          })
          if (existing !== undefined) {
            if (existing.archived_at !== null) {
              throw new SkillError(409, 'skills/archived', `skill "${existing.name}" is archived; restore it before creating a new draft`)
            }
            if (existing.current_version_id !== null) {
              throw new SkillError(409, 'skills/name-conflict', `a skill named ${existing.name} already exists; use a revision`)
            }
          }
        }
        const scenarios = checkedScenarios(input.scenarios, new Set(parsed.manifest.map(entry => entry.path)), this.#verifyTimeoutMs)
        const comparisons = checkedComparisons(input.comparisons)
        mkdirSync(join(this.#root, 'candidates'), { recursive: true })
        candidateDir = join(this.#root, 'candidates', candidateId)
        renameSync(staging, candidateDir)
        const growth = growthOf(parsed.coreCharacters, revision?.parent.core_characters ?? null)
        const location: SourceProvenance = {
          sessionId: input.sessionId,
          focus,
          ...(evidence.length === 0 ? {} : { evidence }),
          ...(revision === undefined ? {} : { benefit: revision.benefit }),
        }
        const draft = this.#store.createDraft({
          name: parsed.name,
          scope: revision?.skill.scope ?? SKILL_SCOPE.personal,
          ownerShortId: input.ownerShortId,
          createdBy: input.ownerShortId,
          packagePath: `candidates/${candidateId}`,
          manifest: canonicalManifest(parsed.manifest),
          manifestHash: parsed.manifestHash,
          coreCharacters: parsed.coreCharacters,
          ...(input.license === undefined
            ? (parsed.license === undefined ? {} : { license: parsed.license })
            : { license: input.license }),
          ...(revision === undefined
            ? { sourceType: SOURCE_TYPE.explicit }
            : { sourceType: SOURCE_TYPE.evolution, parentVersionId: revision.parent.id, growthExceeded: growth.exceeded }),
          sourceLocation: JSON.stringify(location),
        })
        const reuse = revision === undefined ? undefined : this.#reusePlan(revision.parent, parsed.manifest, scenarios)
        const verification = await runVerification({
          root: this.#root,
          packageDir: candidateDir,
          scenarios: reuse === undefined ? scenarios : reuse.rerun,
          comparisons,
          timeoutMs: this.#verifyTimeoutMs,
          ...(reuse === undefined ? {} : { reused: reuse.reused }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        this.#store.updateVerification(draft.versionId, JSON.stringify(verification))
        return {
          ok: true,
          skillId: draft.skillId,
          versionId: draft.versionId,
          status: VERSION_STATUS.pending,
          nextActions: ['inspect', 'review'],
          verification,
        }
      } catch (error) {
        // A failed write or insert must not leave a readable candidate behind.
        rmSync(staging, { recursive: true, force: true })
        if (candidateDir !== undefined) rmSync(candidateDir, { recursive: true, force: true })
        asSkillError(error)
      }
    } catch (error) {
      asSkillError(error)
    }
  }

  /**
   * Copy one approved historical version into a fresh pending candidate.
   *
   * A rollback never moves the current pointer: it restores the historical
   * package bytes through the same candidate and review path as a revision, so
   * the current version keeps serving while the rollback waits for review. The
   * copied package is re-hashed against the historical row before it leaves
   * staging, the historical verification commands run again (or reuse the
   * current report where the content still matches), and a repeat rollback of
   * the content that is already current is refused as a no-op.
   */
  async rollback({ shortId, sessionId, versionId }: {
    readonly shortId: number
    readonly sessionId: string
    readonly versionId: number
  }): Promise<RollbackResult> {
    try {
      const source = this.#store.version(versionId)
      if (source === undefined) {
        throw new SkillError(404, 'skills/not-found', `skill version ${versionId} is not visible to this user`)
      }
      const skill = this.#store.identity(source.skill_id)
      if (skill === undefined || !canReview(shortId, skill)) {
        throw new SkillError(404, 'skills/not-found', `skill version ${versionId} is not visible to this user`)
      }
      if (skill.archived_at !== null) {
        throw new SkillError(409, 'skills/archived', `skill "${skill.name}" is archived; restore it before rolling back`)
      }
      if (source.status !== VERSION_STATUS.superseded) {
        throw new SkillError(409, 'skills/invalid-rollback',
          'rollback needs an approved historical version that a later approval superseded')
      }
      const current = skill.current_version_id === null ? undefined : this.#store.version(skill.current_version_id)
      if (current === undefined) {
        throw new SkillError(409, 'skills/invalid-rollback', `skill "${skill.name}" has no current version to roll back from`)
      }
      if (current.manifest_hash === source.manifest_hash) {
        throw new SkillError(409, 'skills/invalid-rollback',
          `the current version of "${skill.name}" already has this content; a rollback would change nothing`)
      }
      const sourceDirectory = this.#service.versionDirectory(source)
      const sourcePackage = readSkillPackage(sourceDirectory)
      if (sourcePackage.manifestHash !== source.manifest_hash) {
        throw new SkillError(500, 'skills/integrity', `skill package integrity check failed for ${skill.name}`)
      }
      const scenarios = rollbackScenarios(verificationOf(source))
      if (scenarios.length === 0) {
        throw new SkillError(409, 'skills/invalid-rollback',
          `version ${versionId} has no recorded verification scenario to roll back with`)
      }

      const staging = join(this.#root, 'tmp', randomUUID())
      const candidateId = randomUUID()
      let candidateDir: string | undefined
      try {
        copySkillPackage(sourceDirectory, staging)
        const parsed = readSkillPackage(staging)
        if (parsed.manifestHash !== source.manifest_hash) {
          throw new SkillError(500, 'skills/integrity', `the rollback copy of ${skill.name} does not match its approved manifest`)
        }
        const checked = checkedScenarios(scenarios, new Set(parsed.manifest.map(entry => entry.path)), this.#verifyTimeoutMs)
        mkdirSync(join(this.#root, 'candidates'), { recursive: true })
        candidateDir = join(this.#root, 'candidates', candidateId)
        renameSync(staging, candidateDir)
        const growth = growthOf(parsed.coreCharacters, current.core_characters)
        const location: SourceProvenance = {
          sessionId,
          benefit: `回滚到版本 ${source.id} 的已审核内容`,
          rollbackOf: source.id,
        }
        const draft = this.#store.createDraft({
          name: parsed.name,
          scope: skill.scope,
          ownerShortId: shortId,
          createdBy: shortId,
          packagePath: `candidates/${candidateId}`,
          manifest: canonicalManifest(parsed.manifest),
          manifestHash: parsed.manifestHash,
          coreCharacters: parsed.coreCharacters,
          ...(source.license === null
            ? (parsed.license === undefined ? {} : { license: parsed.license })
            : { license: source.license }),
          sourceType: SOURCE_TYPE.rollback,
          parentVersionId: current.id,
          growthExceeded: growth.exceeded,
          sourceLocation: JSON.stringify(location),
        })
        const reuse = this.#reusePlan(current, parsed.manifest, checked)
        const verification = await runVerification({
          root: this.#root,
          packageDir: candidateDir,
          scenarios: reuse.rerun,
          timeoutMs: this.#verifyTimeoutMs,
          ...(reuse.reused.length === 0 ? {} : { reused: reuse.reused }),
        })
        this.#store.updateVerification(draft.versionId, JSON.stringify(verification))
        return {
          ok: true,
          skillId: draft.skillId,
          versionId: draft.versionId,
          status: VERSION_STATUS.pending,
          nextActions: ['inspect', 'review'],
          verification,
        }
      } catch (error) {
        rmSync(staging, { recursive: true, force: true })
        if (candidateDir !== undefined) rmSync(candidateDir, { recursive: true, force: true })
        asSkillError(error)
      }
    } catch (error) {
      asSkillError(error)
    }
  }

  /**
   * Resolve the parent a revision must name, or undefined for a new skill.
   *
   * The parent is the skill's current approved version and belongs to the
   * caller's personal identity; a common parent, another owner's parent or a
   * stale/superseded version is refused with the same vocabulary the tool
   * reports. The target benefit is required and bounded; it is provenance, not
   * a model claim that approval can skip.
   */
  #revisionContext(input: CreateCandidateInput): { skill: SkillRow; parent: SkillVersionRow; benefit: string } | undefined {
    if (input.parentVersionId === undefined) {
      if (input.targetBenefit !== undefined) {
        throw new SkillError(400, 'skills/invalid-request', 'targetBenefit only applies to a revision; pass parentVersionId with it')
      }
      return undefined
    }
    const benefit = checkedTargetBenefit(input.targetBenefit)
    if (input.scope !== undefined && input.scope !== SKILL_SCOPE.personal) {
      throw new SkillError(400, 'skills/invalid-parent', 'a revision keeps the parent skill scope')
    }
    const parent = this.#store.version(input.parentVersionId)
    if (parent === undefined) {
      throw new SkillError(400, 'skills/invalid-parent', `parentVersionId ${input.parentVersionId} is not a skill version`)
    }
    const skill = this.#store.identity(parent.skill_id)
    if (skill === undefined || skill.scope !== SKILL_SCOPE.personal || skill.owner_short_id !== input.ownerShortId) {
      throw new SkillError(404, 'skills/not-found', `skill version ${input.parentVersionId} is not visible to this user`)
    }
    if (skill.archived_at !== null) {
      throw new SkillError(409, 'skills/archived', `skill "${skill.name}" is archived; restore it before creating a revision`)
    }
    if (parent.status !== VERSION_STATUS.approvedCurrent || skill.current_version_id !== parent.id) {
      throw new SkillError(400, 'skills/invalid-parent',
        `parentVersionId ${input.parentVersionId} is not the skill's current approved version`)
    }
    return { skill, parent, benefit }
  }

  /**
   * The reuse decision against the parent's recorded verification report.
   *
   * The parent manifest is re-read from its immutable version directory, so a
   * changed file can only make reuse stricter (the hashes stop matching); a
   * parent whose report or package cannot be read simply reruns everything.
   */
  #reusePlan(parent: SkillVersionRow, candidateManifest: readonly ManifestEntry[], scenarios: readonly CandidateScenario[]): { reused: ReusedScenario[]; rerun: readonly CandidateScenario[] } {
    const parentManifest = this.#readParentManifest(parent)
    if (parentManifest === undefined) return { reused: [], rerun: [...scenarios] }
    let report: { executed: ScenarioRecord[]; reused: ScenarioRecord[] } | undefined
    try {
      const parsed = parent.verification === null ? undefined : JSON.parse(parent.verification) as { executed?: ScenarioRecord[]; reused?: ScenarioRecord[] }
      if (parsed !== undefined) report = { executed: parsed.executed ?? [], reused: parsed.reused ?? [] }
    } catch {
      report = undefined
    }
    const hashes = (manifest: readonly ManifestEntry[]) => new Map(manifest.map(entry => [entry.path, entry.sha256]))
    return planVerificationReuse({
      scenarios,
      candidateHashes: hashes(candidateManifest),
      parentHashes: hashes(parentManifest),
      parentReport: report,
      parentVersionId: parent.id,
    })
  }

  /**
   * The read-only review package for one candidate, plus its deterministic
   * display and one explicitly bounded expansion.
   */
  inspect(shortId: number, versionId: number, options: { expand?: 'none' | 'skill' | 'files'; path?: string } = {}): InspectResult {
    try {
      const { version, skill } = this.#visible(shortId, versionId)
      const directory = this.#service.versionDirectory(version)
      const parsed = this.#readCandidate(version, skill, directory)
      const provenance = parseSourceLocation(version.source_location)
      const parent = version.parent_version_id === null ? undefined : this.#store.version(version.parent_version_id)
      const parentManifest = parent === undefined ? undefined : this.#readParentManifest(parent)
      const verification = verificationOf(version)
      const growth = growthOf(version.core_characters, parent?.core_characters ?? null)
      const changes = changesOf(parsed.manifest, parentManifest)
      const review: ReviewPackage = {
        versionId: version.id,
        skillId: skill.id,
        name: skill.name,
        description: parsed.description,
        scope: skill.scope,
        ownerShortId: skill.owner_short_id,
        proposerShortId: skill.proposed_by,
        source: {
          type: version.source_type,
          location: version.source_location,
          focus: provenance.focus ?? null,
          ...(provenance.address === undefined ? {} : { address: provenance.address }),
          ...(provenance.resolvedVersion === undefined ? {} : { resolvedVersion: provenance.resolvedVersion }),
        },
        status: version.status,
        manifestHash: version.manifest_hash,
        parentVersionId: version.parent_version_id,
        growth,
        coreCharacters: version.core_characters,
        license: version.license,
        applicability: applicabilityOf(directory, parsed.description),
        benefit: provenance.benefit ?? null,
        package: packageFiles(directory, parsed.manifest),
        packageTotal: parsed.manifest.length,
        changes,
        verification,
        nextActions: version.status === VERSION_STATUS.pending
          ? [...REVIEW_ACTIONS]
          : version.status === VERSION_STATUS.superseded ? ['rollback'] : [],
        growthConfirmation: {
          required: growth.exceeded,
          oldCharacters: growth.oldCharacters,
          newCharacters: growth.newCharacters,
          percent: growth.ratio === null || !Number.isFinite(growth.ratio)
            ? null
            : Math.round((growth.ratio - 1) * 1_000) / 10,
          instruction: growth.exceeded ? '超过旧版核心正文 10%；请在展示后单独回复「确认增长」，再批准。' : '',
        },
      }
      const display = buildReviewDisplay(review)
      const expand = options.expand ?? 'none'
      if (expand === 'skill') {
        return boundInspectResult({ ok: true, action: 'inspect', kind: 'skill-review', review, display,
          content: this.#expandFile(directory, 'SKILL.md').content })
      }
      if (expand === 'files') {
        if (typeof options.path !== 'string' || options.path === '') {
          throw new SkillError(400, 'skills/invalid-request', 'expand=files needs a package-relative path')
        }
        if (!parsed.manifest.some(entry => entry.path === options.path)) {
          throw new SkillError(404, 'skills/not-found', `${options.path} is not a file in this package`)
        }
        const file = this.#expandFile(directory, options.path)
        return boundInspectResult({ ok: true, action: 'inspect', kind: 'skill-review', review, display, file })
      }
      return boundInspectResult({ ok: true, action: 'inspect', kind: 'skill-review', review, display })
    } catch (error) {
      asSkillError(error)
    }
  }

  /**
   * Approve, request changes or reject one pending candidate.
   *
   * Approval re-reads every authority before it moves bytes: the version is
   * still pending, the candidate still hashes to the recorded manifest, the
   * verification report has executed or reused evidence and no failure, the
   * identity is not archived, a revision's parent is still the current version,
   * and an exceeded growth carries the user's own post-display confirmation.
   * Only then does the candidate directory become an immutable version and one
   * transaction move the current pointer. A failure renames it back, so a
   * half-published version is never readable.
   */
  review({ shortId, versionId, decision, note, events, sessionOwnerShortId, growthConfirmMessageId }: {
    readonly shortId: number
    readonly versionId: number
    readonly decision: ReviewDecision
    readonly note?: string
    /** The reviewing session's durable log, read by the tool for the growth rule. */
    readonly events?: readonly SessionEvent[]
    /** The owner the reviewing session header names; must match the reviewer. */
    readonly sessionOwnerShortId?: number
    readonly growthConfirmMessageId?: string
  }): ReviewResult {
    try {
      if (!REVIEW_ACTIONS.includes(decision)) {
        throw new SkillError(400, 'skills/invalid-decision', `decision must be one of ${REVIEW_ACTIONS.join(', ')}`)
      }
      const { version, skill } = this.#visible(shortId, versionId)
      if (version.status !== VERSION_STATUS.pending) {
        throw new SkillError(409, 'skills/not-pending', `skill version ${versionId} is no longer pending`)
      }
      if (note !== undefined && (typeof note !== 'string' || [...note].length > 2_000)) {
        throw new SkillError(400, 'skills/invalid-request', 'note must be at most 2000 characters')
      }
      const now = Date.now()
      if (decision === 'request_changes' || decision === 'reject') {
        const status = decision === 'request_changes' ? VERSION_STATUS.changesRequested : VERSION_STATUS.rejected
        const recorded = this.#store.recordReviewDecision({
          versionId, status, reviewer: shortId, reviewedAt: now,
          ...(note === undefined ? {} : { note }),
        })
        if (!recorded) throw new SkillError(409, 'skills/not-pending', `skill version ${versionId} was already decided`)
        return {
          ok: true, versionId, skillId: skill.id, scope: skill.scope, status,
          nextActions: decision === 'request_changes' ? ['create'] : ['list'],
          previousVersionId: null,
        }
      }

      const directory = this.#service.versionDirectory(version)
      this.#readCandidate(version, skill, directory)
      // A second draft can exist only from before the first approval (a new
      // draft is refused once a current version exists). Publishing it would be
      // a revision without the evolution ticket's parent/benefit rule, so the
      // approval gate keeps that path closed here as well as in create.
      if (skill.current_version_id !== null && version.parent_version_id === null) {
        throw new SkillError(409, 'skills/revision-required',
          `skill "${skill.name}" already has a current version; a new version needs a revision`)
      }
      const verification = verificationOf(version)
      const blocked = verificationReason(verification)
      if (blocked !== undefined) throw new SkillError(409, 'skills/verification-incomplete', blocked)
      // The stored growth flag is computed once at creation; the parent is
      // immutable, so recomputing here can only detect a corrupted row.
      const parent = version.parent_version_id === null ? undefined : this.#store.version(version.parent_version_id)
      const growth = growthOf(version.core_characters, parent?.core_characters ?? null)
      if (growth.exceeded !== (version.growth_exceeded === 1)) {
        throw new SkillError(500, 'skills/integrity', `skill version ${versionId} has an inconsistent growth flag`)
      }
      if (growthConfirmMessageId !== undefined && typeof growthConfirmMessageId !== 'string') {
        throw new SkillError(400, 'skills/invalid-request', 'growthConfirmMessageId must be the user message id string')
      }
      let confirmGrowth: { confirmedBy: number; confirmedAt: number; messageId: string } | undefined
      if (growth.exceeded) {
        if (growthConfirmMessageId === undefined || growthConfirmMessageId === '') {
          throw new SkillError(409, 'skills/growth-confirmation-required',
            'core body grew more than 10%; inspect the candidate to show the counts, then collect the user\'s own 确认增长 reply')
        }
        if (events === undefined || sessionOwnerShortId !== shortId) {
          throw new SkillError(409, 'skills/growth-confirmation-invalid',
            'the growth confirmation must come from the reviewing user\'s own session')
        }
        const confirmation = confirmationOf({ events, versionId, messageId: growthConfirmMessageId })
        if (confirmation === undefined) {
          throw new SkillError(409, 'skills/growth-confirmation-invalid',
            'growthConfirmMessageId must name the user\'s own exact 确认增长 message sent after this candidate\'s latest inspect display')
        }
        confirmGrowth = { confirmedBy: shortId, confirmedAt: confirmation.confirmedAt, messageId: confirmation.messageId }
      }

      const candidateDir = directory
      const versionDir = join(this.#root, 'versions', String(skill.id), basename(candidateDir))
      mkdirSync(join(this.#root, 'versions', String(skill.id)), { recursive: true })
      let moved = false
      try {
        renameSync(candidateDir, versionDir)
        moved = true
        const published = this.#store.publishDraft({
          versionId,
          packagePath: `versions/${String(skill.id)}/${basename(versionDir)}`,
          reviewer: shortId,
          reviewedAt: now,
          ...(skill.owner_short_id === null ? {} : { ownerShortId: skill.owner_short_id }),
          defaultEnable: true,
          ...(confirmGrowth === undefined ? {} : { confirmGrowth }),
          recheck: (latestVersion, latestSkill) => latestVersion.status === VERSION_STATUS.pending
            && latestSkill.archived_at === null
            && (latestVersion.parent_version_id === null || latestSkill.current_version_id === latestVersion.parent_version_id)
            && readSkillPackage(versionDir).manifestHash === latestVersion.manifest_hash,
        })
        return {
          ok: true, versionId, skillId: published.skillId, scope: skill.scope,
          status: VERSION_STATUS.approvedCurrent, nextActions: ['list'], previousVersionId: published.previousVersionId,
        }
      } catch (error) {
        if (moved) {
          try { renameSync(versionDir, candidateDir) } catch { /* the directory is restored best-effort */ }
        }
        asSkillError(error)
      }
    } catch (error) {
      asSkillError(error)
    }
  }

  /**
   * The candidate reference the review-entry route injects, after the same
   * one visibility function `inspect` uses. A non-reviewer sees not-found.
   */
  reviewTarget(shortId: number, versionId: number): { versionId: number; skillId: number; name: string; manifestHash: string } {
    try {
      const { version, skill } = this.#visible(shortId, versionId)
      if (version.status !== VERSION_STATUS.pending) {
        throw new SkillError(409, 'skills/not-pending', `skill version ${versionId} is no longer pending`)
      }
      return { versionId, skillId: skill.id, name: skill.name, manifestHash: version.manifest_hash }
    } catch (error) {
      asSkillError(error)
    }
  }

  /** One pending row as both `skill_manage list` and `/skills/list` expose it. */
  #pendingItem(row: PendingDraftRow, confirmation: GrowthConfirmation | undefined): PendingItem {
    return {
      versionId: row.id,
      skillId: row.skill_id,
      name: row.skill_name,
      scope: row.skill_scope,
      sourceType: row.source_type,
      createdAt: row.created_at,
      growthExceeded: row.growth_exceeded === 1,
      ...(confirmation === undefined ? {} : { growthConfirmMessageId: confirmation.messageId }),
      nextActions: [...REVIEW_ACTIONS],
    }
  }

  /** The version and identity the caller may review; anything else is not found. */
  #visible(shortId: number, versionId: number): { version: SkillVersionRow; skill: SkillRow } {
    const version = this.#store.version(versionId)
    if (version === undefined) throw new SkillError(404, 'skills/not-found', `skill version ${versionId} is not visible to this user`)
    const skill = this.#store.identity(version.skill_id)
    if (skill === undefined || !canReview(shortId, skill)) {
      throw new SkillError(404, 'skills/not-found', `skill version ${versionId} is not visible to this user`)
    }
    return { version, skill }
  }

  /** Re-read one candidate and enforce its recorded identity and manifest hash. */
  #readCandidate(version: SkillVersionRow, skill: SkillRow, directory: string) {
    let parsed
    try {
      parsed = readSkillPackage(directory)
    } catch (error) {
      throw new SkillError(500, 'skills/integrity',
        `skill package integrity check failed for ${skill.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (parsed.manifestHash !== version.manifest_hash || parsed.name !== skill.name) {
      throw new SkillError(500, 'skills/integrity', `skill package integrity check failed for ${skill.name}`)
    }
    return parsed
  }

  /** The parent version's manifest for the diff; a missing/broken parent is no baseline. */
  #readParentManifest(parent: SkillVersionRow): ManifestEntry[] | undefined {
    try {
      return [...readSkillPackage(this.#service.versionDirectory(parent)).manifest]
    } catch {
      return undefined
    }
  }

  /** One package file's text, bounded and flagged when cut. */
  #expandFile(directory: string, path: string): { path: string; content: string; truncated: boolean } {
    assertPackagePath(path)
    const text = readFileSync(join(directory, ...path.split('/')), 'utf8')
    if (text.length <= EXPANSION_MAX_CHARACTERS) return { path, content: text, truncated: false }
    return { path, content: `${text.slice(0, EXPANSION_MAX_CHARACTERS - 1)}…`, truncated: true }
  }
}
