/**
 * Shared-skill proposals, candidate visibility and archive/restore rules
 * (#298).
 *
 * A common proposal is not something the model may choose on its own: the user
 * turn that anchors the current turn must explicitly ask to share. This module
 * reads that claimed `user/message` from the durable log, records its id and
 * text as the sharing consent, and is the one place the common-candidate
 * visibility rules (proposer plus Phaethon) and the lifecycle permissions are
 * decided. The HTTP routes and the `skill_manage` tool both call it, so the
 * client cannot widen a scope and a second copy of the rule cannot drift.
 *
 * @module @ourfairy/dsh-skill-creator/src/sharing
 */
import { SKILL_SCOPE, type SkillRow, type SkillStore } from './store.js'
import { SkillError, type PoolItem, type SkillService } from './service.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** The phrases that make one user turn an explicit request to share a skill. */
export const SHARING_PHRASES = Object.freeze(['共有', '共享', '所有人', '大家'] as const)

/** The durable record of the user turn that consented to sharing. */
export interface SharingConsent {
  /** The durable `user/message` id of the anchoring turn. */
  readonly messageId: string
  /** The user's own text, kept as the consent record. */
  readonly text: string
  /** The message's durable seq. */
  readonly seq: number
}

/** The text blocks of one native user message, joined. */
function messageText(message: { readonly content?: readonly { readonly type?: string; readonly text?: unknown }[] }): string {
  return (message.content ?? [])
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/**
 * The explicit sharing request that opened the current turn.
 *
 * The claimed message is the `user/message` with `source.kind === 'user'` that
 * belongs to the latest `turn/start` (the current turn). The agent loop appends
 * the claimed input message at the step boundary, so its seq is at or after the
 * turn start; a user message from an earlier turn is never the consent. The
 * text must contain one of {@link SHARING_PHRASES}; anything else is refused
 * with a clear error.
 *
 * @throws {SkillError} `skills/common-consent-required` when no real user turn
 *   explicitly asked to share.
 */
export function requireSharingConsent(events: readonly SessionEvent[]): SharingConsent {
  let turnStart = -1
  for (const event of events) {
    if (event.type === 'turn/start') turnStart = event.seq
  }
  let claimed: { readonly seq: number; readonly message: UserMessage } | undefined
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (event.data.source?.kind !== 'user') continue
    if (turnStart >= 0 && event.seq < turnStart) continue
    claimed = { seq: event.seq, message: event.data }
  }
  if (claimed === undefined) {
    throw new SkillError(400, 'skills/common-consent-required',
      'a common skill needs an explicit user request to share it (for example 共有, 共享, 所有人 or 大家)')
  }
  const message = claimed.message
  const text = messageText(message)
  if (!SHARING_PHRASES.some(phrase => text.includes(phrase))) {
    throw new SkillError(400, 'skills/common-consent-required',
      'the user turn did not ask to share this skill; a common skill needs one of 共有, 共享, 所有人 or 大家')
  }
  return { messageId: message.id, text, seq: claimed.seq }
}

/** Whether one caller may read a candidate's review material. */
export function canInspect(shortId: number, isAdmin: boolean, skill: SkillRow): boolean {
  if (skill.scope === SKILL_SCOPE.personal) return skill.owner_short_id === shortId
  // A common candidate is visible to its proposer and Phaethon only. The
  // proposer reads it; only Phaethon decides it.
  return isAdmin || skill.proposed_by === shortId
}

/** Whether one caller may decide a pending candidate. */
export function canReview(shortId: number, isAdmin: boolean, skill: SkillRow): boolean {
  if (skill.scope === SKILL_SCOPE.personal) return skill.owner_short_id === shortId
  return isAdmin
}

/** Whether one caller may archive or restore one identity. */
export function canManageLifecycle(shortId: number, isAdmin: boolean, skill: SkillRow): boolean {
  if (skill.scope === SKILL_SCOPE.personal) return skill.owner_short_id === shortId
  return isAdmin
}

/** The refusal for a common lifecycle action attempted by a non-administrator. */
function lifecycleRefusal(skill: SkillRow): SkillError {
  return new SkillError(403, 'skills/forbidden', `only Phaethon may archive or restore the common skill "${skill.name}"`)
}

/** What one lifecycle write changed and which agents it invalidates. */
export interface LifecycleResult {
  readonly item: PoolItem
  /** The identity scope: 1 personal (invalidate its owner), 2 common (invalidate all). */
  readonly scope: number
}

/**
 * The archive/restore lifecycle over the pool authority.
 *
 * The pool item is the visibility check: only an identity the caller can see
 * and that has an approved current version is a lifecycle target. The store
 * keeps content, history and preferences; this class only moves the archive
 * marker and answers the re-derived item so the caller can invalidate the
 * affected online agents.
 */
export class SkillLifecycle {
  readonly #store: SkillStore
  readonly #service: SkillService

  constructor(store: SkillStore, service: SkillService) {
    this.#store = store
    this.#service = service
  }

  /** Archive one visible identity; idempotent for an already archived one. */
  archive({ shortId, isAdmin, skillId }: {
    readonly shortId: number
    readonly isAdmin: boolean
    readonly skillId: number
  }): LifecycleResult {
    const item = this.#visible(shortId, isAdmin, skillId)
    if (item.state !== 4) {
      const skill = this.#store.identity(skillId)
      if (skill === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
      this.#store.archiveIdentity(skillId, shortId)
    }
    return this.#after(shortId, isAdmin, skillId)
  }

  /** Restore one visible archived identity; idempotent for an active one. */
  restore({ shortId, isAdmin, skillId }: {
    readonly shortId: number
    readonly isAdmin: boolean
    readonly skillId: number
  }): LifecycleResult {
    const item = this.#visible(shortId, isAdmin, skillId)
    if (item.state === 4) {
      const skill = this.#store.identity(skillId)
      if (skill === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
      this.#store.restoreIdentity(skillId, shortId)
    }
    return this.#after(shortId, isAdmin, skillId)
  }

  /** The pool item the caller may act on, or a refusal. */
  #visible(shortId: number, isAdmin: boolean, skillId: number): PoolItem {
    const item = this.#service.pool(shortId, isAdmin).find(entry => entry.skillId === skillId)
    if (item === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
    const skill = this.#store.identity(skillId)
    if (skill === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
    if (!canManageLifecycle(shortId, isAdmin, skill)) throw lifecycleRefusal(skill)
    return item
  }

  /** Re-derive the item after the marker write. */
  #after(shortId: number, isAdmin: boolean, skillId: number): LifecycleResult {
    const item = this.#service.pool(shortId, isAdmin).find(entry => entry.skillId === skillId)
    if (item === undefined) throw new SkillError(404, 'skills/not-found', `skill ${skillId} is not visible to this user`)
    return { item, scope: item.scope }
  }
}
