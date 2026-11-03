/**
 * The bounded review-result view the client merges into its local
 * notifications (#298).
 *
 * The product has no push channel and must not grow a notification table. The
 * facts a reminder needs are derived from rows the backend already owns: the
 * pending candidates `/skills/list` reports and the recently decided versions
 * this module exposes. The client keeps a durable set of version ids and
 * publishes at most one merged local notification per newly observed pending or
 * decision set, so this view stays a plain bounded read.
 *
 * A decision is visible to the candidate's reviewer and to a common proposal's
 * proposer. Personal decisions belong to the owner; a common decision is
 * produced by Phaethon and concerns the proposer, so only the proposer sees it
 * as a result. `proposer` tells the client whether this caller proposed the
 * common skill; it is never derived from the request.
 *
 * @module @ourfairy/dsh-skill-creator/src/notify
 */
import type { DecidedVersionRow, SkillStore } from './store.js'

/** The most decisions one list answer carries. */
export const REVIEW_RESULTS_LIMIT = 20

/** One recently decided candidate as `/skills/list` exposes it. */
export interface ReviewResultItem {
  readonly versionId: number
  readonly skillId: number
  readonly name: string
  readonly scope: number
  /** The settled version status: 1 changes requested, 2 rejected, 3 approved. */
  readonly status: number
  readonly decidedAt: number
  /** Whether the caller is the common skill's proposer. */
  readonly proposer: boolean
}

/** The bounded decision read; it owns no state and writes nothing. */
export class SkillNotifications {
  readonly #store: SkillStore

  constructor(store: SkillStore) {
    this.#store = store
  }

  /** The caller's recently decided candidates, newest first and bounded. */
  reviewResults(shortId: number, isAdmin: boolean, limit = REVIEW_RESULTS_LIMIT): ReviewResultItem[] {
    return this.#store.recentDecisions({ shortId, isAdmin, limit }).map(row => this.#item(row, shortId))
  }

  /** One row's wire shape. */
  #item(row: DecidedVersionRow, shortId: number): ReviewResultItem {
    return {
      versionId: row.id,
      skillId: row.skill_id,
      name: row.skill_name,
      scope: row.skill_scope,
      status: row.status,
      decidedAt: row.reviewed_at ?? row.updated_at,
      proposer: row.skill_proposed_by === shortId,
    }
  }
}
