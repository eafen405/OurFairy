/**
 * The authenticated skill endpoints the client renders.
 *
 * Every address is POST + JSON under the `skills` error prefix. The caller is
 * the credential's own short number and its administrator bit; no body field
 * names a user, a scope or a winner. The service derives the pool state and
 * catalog from the database, so the client never recomputes either.
 *
 * `/skills/list` also carries the caller's pending candidates, their count and
 * a bounded `reviewResults` view of recently decided candidates. The client
 * merges those into its own durable notification ledger; there is no backend
 * push and no notification table. `/skills/archive` and `/skills/restore` are
 * the lifecycle writes: personal skills belong to their owner, common skills to
 * Phaethon. `/skills/review-open` appends a system-context candidate reference
 * to the caller's primary session and answers that session id.
 *
 * @module @ourfairy/dsh-skill-creator/src/http
 */
import { freezeSurface, postHandler } from '@ourfairy/dsh-http/http'
import { SkillError, type PoolItem, type SkillDetail } from './service.js'
import { invalidateLifecycleScope, type LifecycleResult } from './sharing.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillCreation, PendingItem } from './creation.js'
import type { SkillNotifications, ReviewResultItem } from './notify.js'
import type { SkillService } from './service.js'
import type { SkillLifecycle } from './sharing.js'

/** The addresses this row publishes, in the order the carrier registers them. */
export const SURFACE = freezeSurface([
  { path: '/skills/list', method: 'POST', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/detail', method: 'POST', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/preference', method: 'POST', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/review-open', method: 'POST', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/archive', method: 'POST', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/restore', method: 'POST', body: 'json', response: 'json', prefix: 'skills' },
])

/** Paths this row owns, in the order the carrier registers them. */
export const SKILL_PATHS = Object.freeze(SURFACE.map(entry => entry.path))

/** One handler the carrier registers on the web server. */
export type SkillHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

/** The identity facts one skill route needs from the presented credential. */
type RouteCaller = { readonly shortId: number; readonly isAdmin: boolean }

/** One positive safe integer body field, or a refusal. */
function positiveInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new SkillError(400, 'skills/invalid-request', `"${field}" must be a positive integer`)
  }
  return value
}

/**
 * Build one handler per published path.
 *
 * @param service - the pool/catalog authority.
 * @param creation - the candidate/review authority.
 * @param lifecycle - the archive/restore rules.
 * @param notifications - the bounded recently-decided view.
 * @param authenticate - resolve the credential's own user, or undefined.
 * @param fence - the carrier's Host/Origin admission.
 * @param invalidateOwner - bump the affected live agents' catalog after a write.
 * @param invalidateAll - bump every live agent after a common lifecycle write.
 */
export function skillHandlers({ service, creation, lifecycle, notifications, authenticate, fence, invalidateOwner, invalidateAll, openReview }: {
  readonly service: SkillService
  readonly creation: SkillCreation
  readonly lifecycle: SkillLifecycle
  readonly notifications: SkillNotifications
  readonly authenticate: (request: IncomingMessage) => RouteCaller | undefined
  readonly fence: (request: IncomingMessage) => unknown
  readonly invalidateOwner: (shortId: number) => void
  readonly invalidateAll: () => void
  /** Deliver the candidate reference to the caller's primary session once and start its review turn. */
  readonly openReview: (shortId: number, isAdmin: boolean, versionId: number) => Promise<{ readonly sessionId: string }>
}): Map<string, SkillHandler> {
  const callerOf = (request: IncomingMessage): RouteCaller => {
    const user = authenticate(request)
    if (user === undefined) throw new SkillError(401, 'skills/unauthorized', 'present a live session credential')
    return { shortId: user.shortId, isAdmin: user.isAdmin === true }
  }
  const post = (handle: (body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>): SkillHandler => postHandler({
    fence,
    handle,
    HttpError: SkillError,
    codePrefix: 'skills',
    internalMessage: 'the skill entry failed to handle this request',
  })
  /** One pool item's wire shape; the client renders these fields, it derives none. */
  const poolView = (item: PoolItem): Record<string, unknown> => ({
    skillId: item.skillId,
    name: item.name,
    description: item.description,
    scope: item.scope,
    state: item.state,
    enabled: item.enabled,
    currentVersionId: item.currentVersionId,
    pendingRevision: item.pendingRevision,
    actions: { ...item.actions },
    ...(item.shadowedBy === undefined ? {} : { shadowedBy: { ...item.shadowedBy } }),
  })
  /** One pending candidate, exactly as `skill_manage list` derives it. */
  const pendingView = (item: PendingItem): Record<string, unknown> => ({
    versionId: item.versionId,
    skillId: item.skillId,
    name: item.name,
    scope: item.scope,
    sourceType: item.sourceType,
    createdAt: item.createdAt,
    growthExceeded: item.growthExceeded,
    nextActions: [...item.nextActions],
  })
  /** One archive/restore handler: validate, write, invalidate the affected catalogs. */
  const lifecycleHandler = (write: (caller: RouteCaller, skillId: number) => LifecycleResult): SkillHandler => post(async (body, request) => {
    const caller = callerOf(request)
    const skillId = positiveInteger(body, 'skillId')
    const updated = write(caller, skillId)
    invalidateLifecycleScope(updated, caller.shortId, invalidateOwner, invalidateAll)
    return { ok: true, skill: poolView(updated.item) }
  })
  /** One recently decided candidate, exactly as `skill_manage list` derives it. */
  const resultView = (item: ReviewResultItem): Record<string, unknown> => ({
    versionId: item.versionId,
    skillId: item.skillId,
    name: item.name,
    scope: item.scope,
    status: item.status,
    decidedAt: item.decidedAt,
    proposer: item.proposer,
  })
  const detailView = (detail: SkillDetail): Record<string, unknown> => ({
    ...poolView(detail),
    ownerShortId: detail.ownerShortId,
    currentVersion: detail.currentVersion === null ? null : { ...detail.currentVersion },
  })

  return new Map([
    ['/skills/list', post(async (_body, request) => {
      const caller = callerOf(request)
      const pending = creation.pending(caller.shortId, { isAdmin: caller.isAdmin })
      return {
        ok: true,
        skills: service.pool(caller.shortId, caller.isAdmin).map(poolView),
        pending: pending.map(pendingView),
        pendingCount: pending.length,
        reviewResults: notifications.reviewResults(caller.shortId, caller.isAdmin).map(resultView),
      }
    })],
    ['/skills/detail', post(async (body, request) => {
      const caller = callerOf(request)
      const skillId = positiveInteger(body, 'skillId')
      return { ok: true, skill: detailView(service.detail(caller.shortId, skillId, caller.isAdmin)) }
    })],
    ['/skills/preference', post(async (body, request) => {
      const caller = callerOf(request)
      const skillId = positiveInteger(body, 'skillId')
      if (typeof body.enabled !== 'boolean') {
        throw new SkillError(400, 'skills/invalid-request', '"enabled" must be a boolean')
      }
      const updated = service.setPreference(caller.shortId, skillId, body.enabled, caller.isAdmin)
      // The caller's next catalog must reflect the preference without a restart.
      invalidateOwner(caller.shortId)
      return { ok: true, skill: poolView(updated) }
    })],
    ['/skills/review-open', post(async (body, request) => {
      const caller = callerOf(request)
      const versionId = positiveInteger(body, 'versionId')
      const opened = await openReview(caller.shortId, caller.isAdmin, versionId)
      return { ok: true, sessionId: opened.sessionId }
    })],
    ['/skills/archive', lifecycleHandler((caller, skillId) =>
      lifecycle.archive({ shortId: caller.shortId, isAdmin: caller.isAdmin, skillId }))],
    ['/skills/restore', lifecycleHandler((caller, skillId) =>
      lifecycle.restore({ shortId: caller.shortId, isAdmin: caller.isAdmin, skillId }))],
  ])
}
