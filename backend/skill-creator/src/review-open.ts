/**
 * The review-entry seam: one system-context candidate reference appended to the
 * caller's primary session (#297).
 *
 * The pending entry on the Skills page must land in the user's own main
 * conversation without pretending the user typed the reference. This module
 * appends exactly one durable `user/message` whose producer source is
 * `skill-review` and whose form is `instructions`; the chat transcript fold
 * ignores every non-`user` source, so it is not a user bubble, while the model
 * sees ordinary user-role context. `appendOnce` makes the append idempotent by
 * candidate, so opening the same pending item twice does not stack references.
 *
 * The source fields are the review identity: the candidate version and the
 * manifest hash. A later candidate (a new draft) is a different reference.
 *
 * @module @ourfairy/dsh-skill-creator/src/review-open
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SkillCreation } from './creation.js'
// Type-only: the product services this seam calls, and the message-source map
// it extends. They add no runtime dependency beyond the rows themselves.
import type {} from '@ourfairy/dsh-chat'
import type {} from '@ourfairy/dsh-sessions'
import type {} from '@deepseek-ai/dsh-llm'

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
 * Append the candidate reference to the caller's fixed primary session once.
 *
 * The caller must be allowed to review the candidate: the creation module's one
 * visibility function runs first, so a version id cannot become a reference in
 * someone else's conversation.
 *
 * @returns the primary session id the client should open.
 */
export async function appendReviewEntry({ ctx, creation, shortId, versionId }: {
  readonly ctx: Context
  readonly creation: SkillCreation
  readonly shortId: number
  readonly versionId: number
}): Promise<{ readonly sessionId: string }> {
  const target = creation.reviewTarget(shortId, versionId)
  const header = await ctx.ourfairySessions.primary({ shortId })
  const text = reviewEntryText(target)
  const source: SkillReviewSource = {
    kind: 'skill-review',
    form: 'instructions',
    versionId: target.versionId,
    manifestHash: target.manifestHash,
  }
  await ctx.ourfairyChatRuntime.appendOnce(header.id, events => events.find(event => {
    if (event.type !== 'user/message') return false
    const eventSource = event.data.source as { kind?: unknown; versionId?: unknown }
    return eventSource.kind === 'skill-review' && eventSource.versionId === versionId
  }), (session: Session) => session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source,
  }), { surfaceOp: 'append' }))
  return { sessionId: header.id }
}
