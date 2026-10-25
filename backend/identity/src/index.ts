/**
 * The OurFairy identity module: users, short numbers, invites and sessions as
 * one dsh plugin.
 *
 * It mounts the product's `/identity/*` paths on the real Web carrier, outside
 * the admitted `/api` prefix, and registers a second-credential authenticator
 * with Connection so a session token it issued also admits a request to dsh's
 * `/api`, as the principal derived from that credential.
 *
 * @module @ourfairy/dsh-identity
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionCredential, ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'
import { bearerToken } from '@ourfairy/dsh-http/http'
import { IdentityError, IdentityStore, PHAETHON_SHORT_ID, type PublicUser } from './store.js'
import { identityHandlers, IDENTITY_PATHS } from './routes.js'
import { identityInterfaces } from './interfaces.js'
import { ownerOf } from './owner.js'
import type { IncomingMessage } from 'node:http'
// The dsh context's own seams: Connection's trust fence and the web server's
// route registry. The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-typert-protocol'

export const name = 'ourfairy-identity'
export const inject = ['webServer', 'connection']

/** The loader validates the row config before `apply`; `resolveConfig` fills the defaults. */
export const Config = z.object({
  path: z.string().min(1).required(),
  // A day count is arithmetic on Date values: above the safe-integer bound the
  // session expiry silently loses precision, so reject it at load time.
  sessionTtlDays: z.number().min(1).step(1).max(Number.MAX_SAFE_INTEGER),
  phaethonName: z.string(),
  phaethonPassword: z.string(),
})

/**
 * The row's configuration, as the loader hands it over.
 *
 * The schema above is the runtime authority; these are the same fields the
 * loader's own view of them declares, so `apply` reads them without a cast.
 */
export type IdentityConfig = {
  path?: string
  sessionTtlDays?: number
  phaethonName?: string
  phaethonPassword?: string
}

/** Principal key one short number speaks for; stable across that user's sessions. */
export function principalIdOf(shortId: number): string {
  return ownerOf(shortId)
}

/**
 * Where one service instance keeps its business store: a module-private symbol
 * rather than a `#` field, because Cordis calls a service method with a
 * traceable proxy as `this` and a class-private field is unreadable through it.
 */
const STORE: unique symbol = Symbol('ourfairy-identity-store')

/**
 * The service-level logger methods.
 *
 * cordis's own `LoggerService` type declares the named-logger facade but not
 * the `info` its runtime adds to the service prototype, so the one call this
 * row makes is typed here rather than at the call site.
 */
interface ServiceLogger {
  info?: (message: string) => void
}

/** Whether one trust request is the node request this deployment's carrier serves. */
function isNodeRequest(request: ConnectionTrustRequest): request is IncomingMessage {
  return 'socket' in request
}

/**
 * The node request behind one trust request.
 *
 * Connection describes what it hands to an authenticator as request facts,
 * which on the Fetch carrier are a `Headers` bag rather than the node request.
 * This deployment's carrier is the node:http web server, so the request the
 * identity module reads its credential from is the node request itself; a
 * request that is not one carries no credential this module can read.
 */
function nodeRequestOf(request: ConnectionTrustRequest): IncomingMessage | undefined {
  return isNodeRequest(request) ? request : undefined
}

/**
 * The identity service the composition reads as `ctx.identity`. `users`,
 * `groups`, `uploads` and `deliveries` are the product-facing interface
 * (`interfaces.ts`); the store behind them stays inside this package.
 */
export class IdentityService extends Service {
  /** The business store behind the faces; the proxy cannot reach it. */
  readonly [STORE]: IdentityStore
  /** The seeded Phaethon identity this service instance owns. */
  readonly phaethon: PublicUser
  /** The product-facing faces over the business store. */
  readonly users: ReturnType<typeof identityInterfaces>['users']
  /** The group face over the business store. */
  readonly groups: ReturnType<typeof identityInterfaces>['groups']
  /** The upload face over the business store. */
  readonly uploads: ReturnType<typeof identityInterfaces>['uploads']
  /** The delivery face over the business store. */
  readonly deliveries: ReturnType<typeof identityInterfaces>['deliveries']

  constructor(ctx: Context, { store, phaethon }: { store: IdentityStore; phaethon: PublicUser }) {
    super(ctx, 'identity')
    this[STORE] = store
    this.phaethon = phaethon
    const { users, groups, uploads, deliveries } = identityInterfaces(store)
    this.users = users
    this.groups = groups
    this.uploads = uploads
    this.deliveries = deliveries
  }

  /** The user a presented request speaks for, or undefined. */
  authenticateRequest(request: IncomingMessage): PublicUser | undefined {
    const token = bearerToken(request)
    return token === undefined ? undefined : this[STORE].authenticate(token)
  }

  /** Connection's second-credential seam: the principal one request speaks for. */
  identify(request: ConnectionTrustRequest): ConnectionCredential | undefined {
    const node = nodeRequestOf(request)
    const user = node === undefined ? undefined : this.authenticateRequest(node)
    if (user === undefined) return undefined
    // Connection caches one Peer per subject and revokes it by that same key, so
    // the subject and the principal id stay the short number's owner string.
    const id = principalIdOf(user.shortId)
    return { subject: id, principal: { kind: 'user', id } }
  }

  /** Mint an invite for the authenticated administrator. */
  createInvite(caller: PublicUser): { code: string; createdAt: number } {
    if (caller.isAdmin !== true) {
      throw new IdentityError(403, 'identity/forbidden', 'only Phaethon may create invites')
    }
    return this[STORE].createInvite(caller.shortId)
  }

  /** End the caller's credential and revoke the principal scope it was admitted as. */
  async signOutRequest(request: IncomingMessage): Promise<{ revoked: boolean; principal: string }> {
    const token = bearerToken(request)
    const user = this.authenticateRequest(request)
    if (token === undefined || user === undefined) {
      throw new IdentityError(401, 'identity/unauthorized', 'present a live session credential')
    }
    this[STORE].signOut(token)
    await this.ctx.connection?.revokePrincipal(principalIdOf(user.shortId))
    return { revoked: true, principal: principalIdOf(user.shortId) }
  }
}

/** Fill the config defaults; the loader has already validated the declared fields. */
function resolveConfig(config: IdentityConfig | undefined): {
  path: string
  sessionTtlDays: number
  phaethonName: string
  phaethonPassword: string | undefined
} {
  const source = config ?? {}
  return {
    path: source.path ?? '',
    sessionTtlDays: source.sessionTtlDays ?? 30,
    phaethonName: source.phaethonName ?? 'phaethon',
    phaethonPassword: source.phaethonPassword === '' ? undefined : source.phaethonPassword,
  }
}

export function apply(ctx: Context, config: IdentityConfig): void {
  const resolved = resolveConfig(config)
  const store = new IdentityStore({ path: resolved.path, sessionTtlDays: resolved.sessionTtlDays })
  const seeded = store.seedPhaethon({ name: resolved.phaethonName, password: resolved.phaethonPassword })
  ctx.effect(() => () => store.close(), 'ourfairy-identity: business store')

  const service = new IdentityService(ctx, { store, phaethon: seeded.user })
  const handlers = identityHandlers({ service, store, fence: (request) => ctx.connection.fence(request) })

  // The session token this module issues is also a first-class credential for
  // dsh's own `/api`: Connection admits it as the principal derived above.
  ctx.connection.authenticators.register({
    name: 'ourfairy-identity',
    identify: (request) => service.identify(request),
  })

  for (const path of IDENTITY_PATHS) {
    const handler = handlers.get(path)
    if (handler === undefined) {
      throw new IdentityError(500, 'identity/missing-handler', `no handler is registered for ${path}`)
    }
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler }),
      `ourfairy-identity: ${path}`,
    )
  }

  const logger: ServiceLogger = ctx.logger
  logger?.info?.(
    `ourfairy-identity: Phaethon is short number ${String(PHAETHON_SHORT_ID)}`
    + ` (${seeded.created ? 'seeded' : 'already present'}),`
    + ` ${seeded.user.name}${seeded.user.isAdmin ? '' : ' (not an administrator)'}`,
  )
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The product's identity service, as this package provides it. */
    identity: IdentityService
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** The product's invited user: one short number, named by its owner string. */
    user: { readonly kind: 'user'; readonly id: string }
  }
}
