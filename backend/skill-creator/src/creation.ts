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
 * session, the package bytes and the recorded run. Common proposals, installs,
 * revisions and growth confirmation belong to later tickets; the hooks they
 * extend are marked, not half-built.
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
import { runVerification, type VerificationReport } from './verify.js'
import { SkillError } from './service.js'
import { canInspect, canReview, requireSharingConsent, type SharingConsent } from './sharing.js'
import type { InstallSource } from './install.js'
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

/** The facts one `create` call hands the backend. */
export interface CreateCandidateInput {
  readonly ownerShortId: number
  readonly sessionId: string
  /** The caller's durable log, read by the tool before the call. */
  readonly events: readonly SessionEvent[]
  readonly scope: number
  /** The explicit-creation provenance; omitted for an address install. */
  readonly focus?: SkillFocusInput
  /** Model-drafted files for an explicit create; mutually exclusive with `packageDir`. */
  readonly files?: readonly CandidateFile[]
  /**
   * A package fetched by the install path; the creation path copies it into its
   * own staging directory and validates the copy. Mutually exclusive with `files`.
   */
  readonly packageDir?: string
  /** The fixed source an install recorded; absent for an explicit create. */
  readonly install?: InstallSource
  readonly scenarios: readonly CandidateScenario[]
  readonly comparisons?: readonly CandidateComparison[]
  readonly evidence?: readonly CandidateEvidence[]
  readonly license?: string
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
    readonly digest?: string
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
      display = clipText(display, Math.max(INSPECT_DISPLAY_FLOOR, display.length - 1_000))
      continue
    }
    break
  }
  // The floor path should always fit; this is the last deterministic guarantee
  // that the JSON stays parseable and the review marker survives.
  if (length() > INSPECT_RESULT_MAX_CHARACTERS) {
    const withoutDisplay = JSON.stringify({ ...bounded, review, display: '' }).length
    display = clipText(display, Math.max(1, INSPECT_RESULT_MAX_CHARACTERS - withoutDisplay - 1))
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
  readonly digest?: string
  readonly etag?: string
  readonly lastModified?: string
  readonly fetchedAt?: number
  /** The user turn that explicitly consented to a common proposal. */
  readonly consent?: SharingConsent
  readonly benefit?: string
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
  return `核心正文 ${old} → ${review.coreCharacters} 字符（${percentText(review.coreCharacters / old)}）`
}

/** Bound a display string, keeping the four blocks useful for normal packages. */
function boundDisplay(text: string): string {
  return text.length <= DISPLAY_MAX_CHARACTERS ? text : `${text.slice(0, DISPLAY_MAX_CHARACTERS - 1)}…`
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
  for (const record of verification.failed) lines.push(`✘ ${record.name}: ${record.command} → exit ${record.exitCode === null ? '—' : String(record.exitCode)}`)
  if (verification.executed.length + verification.failed.length > 0) lines.push(`环境：${verification.environment}`)
  lines.push(`查看全文：skill_manage inspect versionId=${review.versionId} expand=skill（单文件：expand=files path=<path>）`)
  if (review.growthConfirmation.required) {
    lines.push(`篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」`)
  }
  return boundDisplay(lines.join('\n'))
}

/** The growth calculation shared by inspect, the display and approval. */
function growthOf(version: SkillVersionRow, parent: SkillVersionRow | undefined): ReviewPackage['growth'] {
  const oldCharacters = parent?.core_characters ?? null
  const newCharacters = version.core_characters
  const exceeded = oldCharacters !== null && newCharacters > Math.floor(oldCharacters * 1.1)
  return { exceeded, oldCharacters, newCharacters, ratio: oldCharacters === null ? null : newCharacters / oldCharacters }
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
  if (report.executed.length === 0) return 'the verification report has no actually executed scenario'
  if (report.unexecuted.length > 0) return 'the verification report has unexecuted scenarios'
  if (report.failed.length > 0) return 'a verification scenario failed; change the candidate and verify it again'
  return undefined
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

  /** The pending candidates one caller may review, newest first and bounded. */
  pending(shortId: number, isAdmin = false): PendingItem[] {
    return this.#store.pendingDrafts(shortId, isAdmin).map(row => this.#pendingItem(row, isAdmin))
  }

  /**
   * Validate, stage, record and verify one candidate.
   *
   * An explicit create writes the model's files to `tmp/<uuid>/`; an install
   * copies the already-fetched package there instead. Both are then re-read by
   * the one package algorithm, moved into `candidates/<uuid>/` and inserted. A
   * common candidate additionally needs the explicit sharing consent read from
   * the anchoring user turn, and records its proposer; the review material then
   * contains only the cleaned package and source summary. A name that already
   * has an approved current version is refused as a conflict: a revision is the
   * evolution ticket's path. The candidate never enters a provider; only an
   * approved version is served.
   */
  async create(input: CreateCandidateInput): Promise<CreateCandidateResult> {
    try {
      if (input.scope !== SKILL_SCOPE.personal && input.scope !== SKILL_SCOPE.common) {
        throw new SkillError(400, 'skills/invalid-scope', `unknown skill scope ${String(input.scope)}`)
      }
      const common = input.scope === SKILL_SCOPE.common
      const consent = common ? requireSharingConsent(input.events) : undefined
      if (input.packageDir !== undefined && input.files !== undefined) {
        throw new SkillError(400, 'skills/invalid-package', 'create accepts either package files or a fetched package, not both')
      }
      if (input.packageDir === undefined && (!Array.isArray(input.files) || input.files.length === 0)) {
        throw new SkillError(400, 'skills/invalid-package', 'create needs the complete package files, including SKILL.md')
      }
      if (input.packageDir !== undefined && input.install === undefined) {
        throw new SkillError(400, 'skills/invalid-package', 'a fetched package needs the install source it was fetched from')
      }
      const focus = input.focus === undefined ? undefined : resolveFocus(input.events, input.focus)
      if (focus === undefined && input.install === undefined) {
        throw new SkillError(400, 'skills/invalid-focus', 'create needs focus: {"kind":"turn"} or {"kind":"task","text":"..."}')
      }
      const evidence = common ? [] : checkedEvidence(input.evidence)
      const staging = join(this.#root, 'tmp', randomUUID())
      const candidateId = randomUUID()
      let candidateDir: string | undefined
      try {
        if (input.packageDir === undefined) writeSkillPackage(staging, input.files as readonly CandidateFile[])
        else copySkillPackage(input.packageDir, staging)
        const parsed = readSkillPackage(staging)
        const identityOwner = common ? undefined : input.ownerShortId
        const existing = this.#store.activeIdentity({
          scope: input.scope,
          ownerShortId: identityOwner,
          name: parsed.name,
        })
        if (existing !== undefined) {
          if (existing.archived_at !== null) {
            throw new SkillError(409, 'skills/archived', `skill "${existing.name}" is archived; restore it before creating a new draft`)
          }
          if (existing.current_version_id !== null) {
            throw new SkillError(409, 'skills/name-conflict', `a skill named ${existing.name} already exists; use a revision`)
          }
          if (common && existing.proposed_by !== input.ownerShortId) {
            throw new SkillError(409, 'skills/name-conflict',
              `a common skill named ${existing.name} already has a candidate proposed by another user`)
          }
        }
        const scenarios = checkedScenarios(input.scenarios, new Set(parsed.manifest.map(entry => entry.path)), this.#verifyTimeoutMs)
        const comparisons = checkedComparisons(input.comparisons)
        mkdirSync(join(this.#root, 'candidates'), { recursive: true })
        candidateDir = join(this.#root, 'candidates', candidateId)
        renameSync(staging, candidateDir)
        const install = input.install
        const location: SourceProvenance = {
          ...(common
            ? { ...(consent === undefined ? {} : { consent }) }
            : {
                sessionId: input.sessionId,
                ...(focus === undefined ? {} : { focus }),
                ...(evidence.length === 0 ? {} : { evidence }),
              }),
          ...(install === undefined
            ? {}
            : {
                address: install.address,
                resolvedVersion: install.resolvedVersion,
                digest: install.digest,
                fetchedAt: install.fetchedAt,
                ...(install.etag === undefined ? {} : { etag: install.etag }),
                ...(install.lastModified === undefined ? {} : { lastModified: install.lastModified }),
              }),
        }
        const draft = this.#store.createDraft({
          name: parsed.name,
          scope: input.scope,
          ...(identityOwner === undefined ? {} : { ownerShortId: identityOwner }),
          ...(common ? { proposedBy: input.ownerShortId } : {}),
          createdBy: input.ownerShortId,
          packagePath: `candidates/${candidateId}`,
          manifest: canonicalManifest(parsed.manifest),
          manifestHash: parsed.manifestHash,
          coreCharacters: parsed.coreCharacters,
          ...(input.license === undefined
            ? (parsed.license === undefined ? {} : { license: parsed.license })
            : { license: input.license }),
          sourceType: install === undefined ? SOURCE_TYPE.explicit : SOURCE_TYPE.install,
          sourceLocation: JSON.stringify(location),
        })
        const verification = await runVerification({
          root: this.#root,
          packageDir: candidateDir,
          scenarios,
          comparisons,
          timeoutMs: this.#verifyTimeoutMs,
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
   * The read-only review package for one candidate, plus its deterministic
   * display and one explicitly bounded expansion.
   */
  inspect(shortId: number, isAdmin: boolean, versionId: number, options: { expand?: 'none' | 'skill' | 'files'; path?: string } = {}): InspectResult {
    try {
      const { version, skill } = this.#visible(shortId, isAdmin, versionId, 'inspect')
      const directory = this.#service.versionDirectory(version)
      const parsed = this.#readCandidate(version, skill, directory)
      const provenance = parseSourceLocation(version.source_location)
      const parent = version.parent_version_id === null ? undefined : this.#store.version(version.parent_version_id)
      const parentManifest = parent === undefined ? undefined : this.#readParentManifest(parent)
      const verification = verificationOf(version)
      const growth = growthOf(version, parent)
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
          ...(provenance.digest === undefined ? {} : { digest: provenance.digest }),
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
        nextActions: version.status === VERSION_STATUS.pending && canReview(shortId, isAdmin, skill) ? [...REVIEW_ACTIONS] : [],
        growthConfirmation: {
          required: growth.exceeded,
          oldCharacters: growth.oldCharacters,
          newCharacters: growth.newCharacters,
          percent: growth.ratio === null ? null : Math.round((growth.ratio - 1) * 1_000) / 10,
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
   * verification report executed at least one scenario and failed none, the
   * identity is not archived. Only then does the candidate directory become an
   * immutable version and one transaction move the current pointer. A failure
   * renames it back, so a half-published version is never readable.
   */
  review({ shortId, isAdmin, versionId, decision, note }: {
    readonly shortId: number
    readonly isAdmin: boolean
    readonly versionId: number
    readonly decision: ReviewDecision
    readonly note?: string
  }): ReviewResult {
    try {
      if (!REVIEW_ACTIONS.includes(decision)) {
        throw new SkillError(400, 'skills/invalid-decision', `decision must be one of ${REVIEW_ACTIONS.join(', ')}`)
      }
      const { version, skill } = this.#visible(shortId, isAdmin, versionId, 'review')
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
      // Growth confirmation is the evolution ticket's rule; a #297 candidate
      // has no parent, so this branch is unreachable until #299 supplies the
      // message-reference validation. Refusing here keeps the approval gate
      // real rather than silently approving an unconfirmed growth.
      if (growthOf(version, version.parent_version_id === null ? undefined : this.#store.version(version.parent_version_id)).exceeded) {
        throw new SkillError(409, 'skills/growth-confirmation-required', 'core body grew more than 10%; show the counts and collect the user confirmation first')
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
          recheck: (latestVersion, latestSkill) => latestVersion.status === VERSION_STATUS.pending
            && latestSkill.archived_at === null
            && (latestSkill.current_version_id === null || latestVersion.parent_version_id !== null)
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
  reviewTarget(shortId: number, isAdmin: boolean, versionId: number): { versionId: number; skillId: number; name: string; manifestHash: string } {
    try {
      const { version, skill } = this.#visible(shortId, isAdmin, versionId, 'inspect')
      if (version.status !== VERSION_STATUS.pending) {
        throw new SkillError(409, 'skills/not-pending', `skill version ${versionId} is no longer pending`)
      }
      return { versionId, skillId: skill.id, name: skill.name, manifestHash: version.manifest_hash }
    } catch (error) {
      asSkillError(error)
    }
  }

  /** One pending row as both `skill_manage list` and `/skills/list` expose it. */
  #pendingItem(row: PendingDraftRow, isAdmin: boolean): PendingItem {
    const decidable = row.skill_scope === SKILL_SCOPE.personal || isAdmin
    return {
      versionId: row.id,
      skillId: row.skill_id,
      name: row.skill_name,
      scope: row.skill_scope,
      sourceType: row.source_type,
      createdAt: row.created_at,
      growthExceeded: row.growth_exceeded === 1,
      nextActions: decidable ? [...REVIEW_ACTIONS] : [],
    }
  }

  /**
   * The version and identity the caller may inspect or decide.
   *
   * A personal candidate belongs to its owner. A common candidate is visible to
   * its proposer and Phaethon; only Phaethon may decide it, so a proposer who
   * can read it gets a forbidden refusal for a review decision rather than a
   * not-found that would hide a candidate they can see.
   */
  #visible(shortId: number, isAdmin: boolean, versionId: number, action: 'inspect' | 'review'): { version: SkillVersionRow; skill: SkillRow } {
    const version = this.#store.version(versionId)
    if (version === undefined) throw new SkillError(404, 'skills/not-found', `skill version ${versionId} is not visible to this user`)
    const skill = this.#store.identity(version.skill_id)
    if (skill === undefined || !canInspect(shortId, isAdmin, skill)) {
      throw new SkillError(404, 'skills/not-found', `skill version ${versionId} is not visible to this user`)
    }
    if (action === 'review' && !canReview(shortId, isAdmin, skill)) {
      throw new SkillError(403, 'skills/forbidden', 'only Phaethon may decide a common skill candidate')
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
