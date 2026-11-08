/**
 * The source contract of one skill candidate.
 *
 * A `create` call carries at most one origin: an explicit model-drafted
 * package, a package fetched from an install address, a background learning
 * claim, or a revision of an approved skill. The two producers hand overlapping
 * optional fields to `create`, and a priority chain over them silently drops
 * the losing fields: a background claim carrying an address records the claim
 * and loses the address, and a revision carrying an address is recorded as an
 * install while also naming a parent. This module resolves the facts once and
 * refuses a combination instead of letting one origin override another.
 *
 * The resolver returns the semantic origin only; `creation` maps it to the
 * numeric `SOURCE_TYPE` code, so the store stays the one authority for the
 * stored vocabulary. The refusals read the caller's input facts and therefore
 * happen before any byte is staged or row inserted.
 *
 * @module @ourfairy/dsh-skill-creator/src/origin
 */
import { SkillError } from './service.js'
import type { InstallSource } from './install.js'

/** Where one background candidate came from: the cross-session claim's evidence. */
export interface BackgroundProvenance {
  /** The canonical task key shared by the contributing signals. */
  readonly taskKey: string
  /** The contributing reuse-signal ids the creation claim froze. */
  readonly signalIds: readonly number[]
  /** The distinct source sessions those signals came from. */
  readonly sourceSessions: readonly string[]
  /** The creation job that produced this candidate. */
  readonly creationJobId: number
}

/** The source facts one `create` call hands the domain. */
export interface OriginFacts {
  /** The fixed source an install path fetched; absent for every other origin. */
  readonly install: InstallSource | undefined
  /** The cross-session claim a background candidate came from. */
  readonly background: BackgroundProvenance | undefined
  /** Whether the call revises an approved version (`parentVersionId` was given). */
  readonly revision: boolean
  /** Whether the caller asked to skip verification and run it later. */
  readonly deferredVerification: boolean
  /** Whether the caller named a focus (a calling turn or a task statement). */
  readonly focusNamed: boolean
  /** Whether the caller supplied a fetched package directory. */
  readonly packageDir: boolean
}

/** The four origins `create` can record; `store.SOURCE_TYPE` numbers them. */
export type CandidateOrigin = 'explicit' | 'install' | 'background' | 'evolution'

/**
 * Resolve one create call's single origin, refusing overlapping source facts.
 *
 * The five refusals name the two facts that disagree and run in a fixed order,
 * so an input with several conflicts always reports the first one. A legal
 * origin is one of the four `create` produces; rollback and seed set their own
 * source types outside this seam.
 *
 * @throws {SkillError} 400 `skills/invalid-source` when the facts name more
 *   than one origin, a background claim names a calling turn, deferred
 *   verification has no background claim behind it, or an install source
 *   lacks the fetched package directory it came from.
 */
export function candidateOrigin(facts: OriginFacts): CandidateOrigin {
  if (facts.background !== undefined && facts.install !== undefined) {
    throw new SkillError(400, 'skills/invalid-source',
      'a background candidate cannot also record an install source; its origin is the cross-session claim, not an address')
  }
  if (facts.revision && facts.install !== undefined) {
    throw new SkillError(400, 'skills/invalid-source',
      'a revision is written from package files, not an install address; it cannot record an install source')
  }
  if (facts.deferredVerification && facts.background === undefined) {
    throw new SkillError(400, 'skills/invalid-source',
      'only a background claim may defer verification; any other create must verify its candidate now')
  }
  if (facts.background !== undefined && facts.focusNamed) {
    throw new SkillError(400, 'skills/invalid-source',
      'a background candidate has no calling turn to name as focus; its provenance is the cross-session claim')
  }
  if (facts.install !== undefined && !facts.packageDir) {
    throw new SkillError(400, 'skills/invalid-source',
      'an install source needs the fetched package directory it came from; the install path stages that copy before create')
  }
  if (facts.background !== undefined) return 'background'
  if (facts.install !== undefined) return 'install'
  return facts.revision ? 'evolution' : 'explicit'
}
