/**
 * The authenticated skill endpoints the client renders.
 *
 * Every address is POST + JSON under the `skills` error prefix. The caller is
 * the credential's own short number; no body field names a user, a scope or a
 * winner. The service derives the pool state and catalog from the database, so
 * the client never recomputes either.
 *
 * `/skills/list` also carries the caller's pending candidates and their count:
 * the same derivation `skill_manage list` answers with. `/skills/review-open`
 * is the pending entry's one write: it appends a system-context reference to
 * the caller's primary session and answers that session id.
 *
 * @module @ourfairy/dsh-skill-creator/src/http
 */
import { freezeSurface, postHandler } from '@ourfairy/dsh-http/http'
import { SkillError, type PoolItem, type SkillDetail } from './service.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SkillCreation, PendingItem } from './creation.js'
import type { SkillService } from './service.js'

/** The addresses this row publishes, in the order the carrier registers them. */
export const SURFACE = freezeSurface([
  { path: '/skills/list', method: 'POST', auth: 'authentication', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/detail', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/preference', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'skills' },
  { path: '/skills/review-open', method: 'POST', auth: 'ownership', body: 'json', response: 'json', prefix: 'skills' },
])

/** Paths this row owns, in the order the carrier registers them. */
export const SKILL_PATHS = Object.freeze(SURFACE.map(entry => entry.path))

/** One handler the carrier registers on the web server. */
export type SkillHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>

/** The identity facts one skill route needs from the presented credential. */
type RouteCaller = { readonly shortId: number }

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
 * @param authenticate - resolve the credential's own user, or undefined.
 * @param fence - the carrier's Host/Origin admission.
 * @param invalidateOwner - bump the affected live agents' catalog after a write.
 */
export function skillHandlers({ service, creation, authenticate, fence, invalidateOwner, openReview }: {
  readonly service: SkillService
  readonly creation: SkillCreation
  readonly authenticate: (request: IncomingMessage) => RouteCaller | undefined
  readonly fence: (request: IncomingMessage) => unknown
  readonly invalidateOwner: (shortId: number) => void
  /** Append the candidate reference to the caller's primary session, once. */
  readonly openReview: (shortId: number, versionId: number) => Promise<{ readonly sessionId: string }>
}): Map<string, SkillHandler> {
  const callerOf = (request: IncomingMessage): number => {
    const user = authenticate(request)
    if (user === undefined) throw new SkillError(401, 'skills/unauthorized', 'present a live session credential')
    return user.shortId
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
  const detailView = (detail: SkillDetail): Record<string, unknown> => ({
    ...poolView(detail),
    ownerShortId: detail.ownerShortId,
    currentVersion: detail.currentVersion === null ? null : { ...detail.currentVersion },
  })

  return new Map([
    ['/skills/list', post(async (_body, request) => {
      const shortId = callerOf(request)
      const pending = creation.pending(shortId)
      return {
        ok: true,
        skills: service.pool(shortId).map(poolView),
        pending: pending.map(pendingView),
        pendingCount: pending.length,
      }
    })],
    ['/skills/detail', post(async (body, request) => {
      const shortId = callerOf(request)
      const skillId = positiveInteger(body, 'skillId')
      return { ok: true, skill: detailView(service.detail(shortId, skillId)) }
    })],
    ['/skills/preference', post(async (body, request) => {
      const shortId = callerOf(request)
      const skillId = positiveInteger(body, 'skillId')
      if (typeof body.enabled !== 'boolean') {
        throw new SkillError(400, 'skills/invalid-request', '"enabled" must be a boolean')
      }
      const updated = service.setPreference(shortId, skillId, body.enabled)
      // The caller's next catalog must reflect the preference without a restart.
      invalidateOwner(shortId)
      return { ok: true, skill: poolView(updated) }
    })],
    ['/skills/review-open', post(async (body, request) => {
      const shortId = callerOf(request)
      const versionId = positiveInteger(body, 'versionId')
      const opened = await openReview(shortId, versionId)
      return { ok: true, sessionId: opened.sessionId }
    })],
  ])
}
