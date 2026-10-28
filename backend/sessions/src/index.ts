/**
 * The OurFairy owned-session module: session ownership, the fixed primary
 * session, and the caller's archive, mounted as one dsh plugin.
 * `SessionHeader.owner` is the ownership authority; the archive store keeps the
 * one product fact this module owns, and its `owner_short_id` only scopes rows
 * to the caller who archived them.
 *
 * @module @ourfairy/dsh-sessions
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionArchiveStore } from './archive-store.js'
import { OwnedSessionService } from './service.js'
import { SESSION_PATHS, sessionHandlers } from './http.js'
// The dsh context's own seams: the session store, the durable store, the
// session query and the carrier. The imports are type-only, so they add no
// runtime dependency.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@ourfairy/dsh-identity'

export const name = 'ourfairy-sessions'

/** `identity` names the owner; `sessionQuery` reads whether a log is still empty. */
export const inject = ['webServer', 'connection', 'identity', 'sessions', 'sessionPersistence', 'sessionQuery']

/**
 * The row's configuration. `path` is the archive database; the loader validates
 * it before `apply` runs, so a row without one fails the boot instead of
 * silently running without an archive.
 */
export const Config = z.object({
  path: z.string().min(1).required(),
})

/** The row config as the loader hands it over. */
export type SessionsConfig = {
  readonly path: string
}

export function apply(ctx: Context, config: SessionsConfig): void {
  const archive = new SessionArchiveStore({ path: config.path })
  ctx.effect(() => () => archive.close(), 'ourfairy-sessions: archive store')

  const service = new OwnedSessionService(ctx, {
    sessions: ctx.sessions,
    persistence: ctx.sessionPersistence,
    identity: ctx.identity,
    archive,
  })
  const handlers = sessionHandlers({ service, fence: request => ctx.connection.fence(request) })

  for (const path of SESSION_PATHS) {
    const handler = handlers.get(path)
    if (handler === undefined) {
      throw new Error(`no handler is registered for ${path}`)
    }
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler }),
      `ourfairy-sessions: ${path}`,
    )
  }
}

export { OwnedSessionService, primarySessionIdOf, sessionIdOf, SessionScopeError } from './service.js'
export { SessionArchiveStore, ARCHIVE_STATUS } from './archive-store.js'
export { SESSION_PATHS, sessionHandlers } from './http.js'
export {
  FALLBACK_MAX_BYTES, FALLBACK_MAX_WORDS, MAX_TITLE_BYTES, NO_TITLE, TITLE_SOURCE,
  deriveFallbackTitle, firstHumanMessageText, readSessionEvents, readSessionTitles, titleFactOf,
} from './events.js'
export type { SessionTitleFact, TitleSourceCode } from './events.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The product's owned-session service, as this package provides it. */
    ourfairySessions: OwnedSessionService
  }
}
