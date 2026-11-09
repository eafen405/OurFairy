/**
 * The one reader and verdict for a stored verification report (#329).
 *
 * A skill version stores the system-written {@link VerificationReport} as JSON
 * on `skill_version.verification`. Approval, a background claim's settle
 * decision and the review display all ask the same questions of it: is the
 * report complete, free of failures and unexecuted scenarios, backed by real
 * evidence, and does changed content carry an execution of its own? This module
 * is the only place that parses that JSON and answers them; the runner
 * (`./verify`) still owns producing the report.
 *
 * A missing value, invalid JSON or a non-object container reads as an incomplete
 * empty report. The reader normalises the outer fields; scenario and comparison
 * records retain the shape the system runner wrote and are not validated here.
 *
 * @module @ourfairy/dsh-skill-creator/src/verification-report
 */
import type { ComparisonRecord, ScenarioRecord, VerificationReport } from './verify.js'

/** An incomplete report with no records, stamped with the row's creation time. */
export function emptyVerificationReport(ranAt: number): VerificationReport {
  return {
    complete: false,
    executed: [],
    reused: [],
    unexecuted: [],
    failed: [],
    comparisons: [],
    environment: '',
    ranAt,
  }
}

/**
 * Whether a candidate's content differs from its parent's, i.e. whether an
 * approval may not rest on the parent's recorded runs alone.
 *
 * The parent hash is the database's `parent_version_id → manifest_hash` — the
 * immutable fact the candidate was written against, never a disk read of the
 * parent directory (an unreadable parent would silently drop the requirement)
 * and never the display's changed-file count (an unreadable parent would look
 * like a brand-new skill and refuse a legitimate approval).
 */
export function needsFreshExecution(input: {
  readonly candidateManifestHash: string
  readonly parentManifestHash: string | null
}): boolean {
  return input.parentManifestHash !== null && input.parentManifestHash !== input.candidateManifestHash
}

/** One stored field as a record list; anything that is not an array reads as no record. */
function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

/**
 * Read one version's stored verification report.
 *
 * A null value, broken JSON or a non-object reads as an incomplete empty report
 * stamped with the row's creation time. A field of the wrong type falls back to
 * its empty default and `complete` is only ever the literal `true`. Array
 * elements are carried through as system-written records without a schema check.
 * The fallback and field defaults are covered by
 * `tests/skill-verification-report.test.mjs`.
 */
export function readVerificationReport(version: {
  readonly verification: string | null
  readonly created_at: number
}): VerificationReport {
  if (version.verification === null) return emptyVerificationReport(version.created_at)
  let parsed: unknown
  try {
    parsed = JSON.parse(version.verification)
  } catch {
    return emptyVerificationReport(version.created_at)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyVerificationReport(version.created_at)
  }
  const stored = parsed as Record<string, unknown>
  return {
    complete: stored.complete === true,
    executed: records<ScenarioRecord>(stored.executed),
    reused: records<ScenarioRecord>(stored.reused),
    unexecuted: records<ScenarioRecord>(stored.unexecuted),
    failed: records<ScenarioRecord>(stored.failed),
    comparisons: records<ComparisonRecord>(stored.comparisons),
    environment: typeof stored.environment === 'string' ? stored.environment : '',
    ranAt: typeof stored.ranAt === 'number' ? stored.ranAt : version.created_at,
  }
}

/** The one reason a verification report cannot justify an approval or a settle. */
export type VerificationRefusal = 'incomplete' | 'no-evidence' | 'unexecuted' | 'failed' | 'reused-only'

/** A report's verdict: it either justifies the decision, or names the first refusal. */
export type VerificationVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: VerificationRefusal; readonly message: string }

/**
 * Judge one stored report against the one bar approval and settlement share.
 *
 * The first failing rule wins, in this fixed order: incomplete, no evidence,
 * unexecuted, failed, then changed content whose report reuses the parent's
 * runs without executing anything itself. The messages are the approval gate's
 * existing words; the caller maps a refusal to its own error or retry, so this
 * module stays free of the store, the service and the review display.
 */
export function verificationVerdict(input: {
  readonly report: VerificationReport
  readonly candidateManifestHash: string
  readonly parentManifestHash: string | null
}): VerificationVerdict {
  const { report } = input
  if (!report.complete) {
    return { ok: false, refusal: 'incomplete', message: 'the verification report is incomplete; run it again' }
  }
  if (report.executed.length === 0 && report.reused.length === 0) {
    return { ok: false, refusal: 'no-evidence', message: 'the verification report has no executed or reused scenario' }
  }
  if (report.unexecuted.length > 0) {
    return { ok: false, refusal: 'unexecuted', message: 'the verification report has unexecuted scenarios' }
  }
  if (report.failed.length > 0) {
    return { ok: false, refusal: 'failed', message: 'a verification scenario failed; change the candidate and verify it again' }
  }
  if (needsFreshExecution(input) && report.executed.length === 0) {
    return {
      ok: false,
      refusal: 'reused-only',
      message: 'the candidate content changed from its parent but its report only reuses the parent\'s runs; verify it again',
    }
  }
  return { ok: true }
}
