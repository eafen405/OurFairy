/**
 * The review-entry seam: one system-context candidate reference delivered to
 * the caller's primary session, followed by one real review turn (#297, #295
 * review E1).
 *
 * The pending entry on the Skills page must land in the user's own main
 * conversation without pretending the user typed the reference. This module
 * delivers exactly one durable `user/message` whose producer source is
 * `skill-review` and whose form is `instructions`; the chat transcript fold
 * ignores every non-`user` source, so it is not a user bubble, while the model
 * sees ordinary user-role context. The delivery is what starts the turn: the
 * user no longer has to send a message of their own before the model inspects
 * the candidate.
 *
 * The trigger follows the delivery, not the click: only a call that actually
 * delivered a new reference starts a turn. Opening the same pending item twice
 * therefore neither stacks references nor starts a second review turn; a new
 * draft is a new version id and is a different reference. The source fields are
 * the review identity: the candidate version and the manifest hash.
 *
 * @module @ourfairy/dsh-skill-creator/src/review-open
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SkillCreation } from './creation.js'
// Type-only: the product services this seam calls, and the message-source map
// it extends. They add no runtime dependency beyond the rows themselves.
import type {} from '@ourfairy/dsh-chat'
import type {} from '@ourfairy/dsh-sessions'

/** The producer-owned source of one review-entry message. */
export interface SkillReviewSource {
  readonly kind: 'skill-review'
  readonly form: 'instructions'
  readonly versionId: number
  readonly manifestHash: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** One candidate reference appended by the review entry; not a human message. */
    'skill-review': SkillReviewSource
  }
}

/** The text the model receives; it names the candidate and the one next tool call. */
export function reviewEntryText(target: { readonly name: string; readonly versionId: number; readonly manifestHash: string }): string {
  return `技能候选「${target.name}」等待审核（版本 ${target.versionId}，哈希 ${target.manifestHash}）。`
    + '请使用 skill_manage 工具 inspect 该候选，向用户展示审核材料，并等待用户决定批准、要求修改或拒绝；不要替用户决定，也不要声称已批准。'
}

/**
 * Deliver the candidate reference to the caller's fixed primary session once
 * and start that session's review turn.
 *
 * The caller must be allowed to review the candidate: the creation module's one
 * visibility function runs first, so a version id cannot become a reference in
 * someone else's conversation. The delivery itself is the turn trigger, and the
 * dedupe reads the same reference: a second open of the same candidate appends
 * nothing and starts no second turn.
 *
 * @returns the primary session id the client should open.
 */
export async function appendReviewEntry({ ctx, creation, shortId, isAdmin, versionId }: {
  readonly ctx: Context
  readonly creation: SkillCreation
  readonly shortId: number
  readonly isAdmin: boolean
  readonly versionId: number
}): Promise<{ readonly sessionId: string }> {
  const target = creation.reviewTarget(shortId, isAdmin, versionId)
  const header = await ctx.ourfairySessions.primary({ shortId })
  const text = reviewEntryText(target)
  const source: SkillReviewSource = {
    kind: 'skill-review',
    form: 'instructions',
    versionId: target.versionId,
    manifestHash: target.manifestHash,
  }
  const isReference = (message: UserMessage): boolean => {
    const messageSource = message.source as { kind?: unknown; versionId?: unknown }
    return messageSource.kind === 'skill-review' && messageSource.versionId === versionId
  }
  await ctx.ourfairyChatRuntime.promptOnce({ shortId }, header.id, isReference, createUserMessage({
    content: [{ type: 'text', text }],
    source,
  }))
  return { sessionId: header.id }
}
