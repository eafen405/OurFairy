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
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { IdentityError, IdentityStore, PHAETHON_SHORT_ID } from './store.mjs'
import { bearerToken, identityHandlers, IDENTITY_PATHS } from './http.mjs'
import { identityInterfaces } from './interfaces.mjs'
import { ownerOf } from './owner.mjs'

export const name = 'ourfairy-identity'
export const inject = ['webServer', 'connection']

/** The loader validates the row config before `apply`; `resolveConfig` fills the defaults. */
export const Config = z.object({
  path: z.string().min(1).required(),
  sessionTtlDays: z.number().min(1).step(1),
  phaethonName: z.string(),
  phaethonPassword: z.string(),
})

/** Principal key one short number speaks for; stable across that user's sessions. */
export function principalIdOf(shortId) {
  return ownerOf(shortId)
}

/**
 * Where one service instance keeps its business store: a module-private symbol
 * rather than a `#` field, because Cordis calls a service method with a
 * traceable proxy as `this` and a class-private field is unreadable through it.
 */
const STORE = Symbol('ourfairy-identity-store')

/**
 * The identity service the composition reads as `ctx.identity`. `users`,
 * `groups`, `uploads` and `deliveries` are the product-facing interface
 * (`interfaces.mjs`); the store behind them stays inside this package.
 */
export class IdentityService extends Service {
  constructor(ctx, { store, phaethon }) {
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
  authenticateRequest(request) {
    const token = bearerToken(request)
    return token === undefined ? undefined : this[STORE].authenticate(token)
  }

  /** Connection's second-credential seam: the principal one request speaks for. */
  identify(request) {
    const user = this.authenticateRequest(request)
    return user === undefined ? undefined : { id: principalIdOf(user.shortId) }
  }

  /** Mint an invite for the authenticated administrator. */
  createInvite(caller) {
    if (caller.isAdmin !== true) {
      throw new IdentityError(403, 'identity/forbidden', 'only Phaethon may create invites')
    }
    return this[STORE].createInvite(caller.shortId)
  }

  /** End the caller's credential and revoke the principal scope it was admitted as. */
  async signOutRequest(request) {
    const token = bearerToken(request)
    const user = this.authenticateRequest(request)
    if (token === undefined || user === undefined) {
      throw new IdentityError(401, 'identity/unauthorized', 'present a live session credential')
    }
    this[STORE].signOut(token)
    await this.ctx.get('connection')?.revokePrincipal(principalIdOf(user.shortId))
    return { revoked: true, principal: principalIdOf(user.shortId) }
  }
}

/** Fill the config defaults; the loader has already validated the declared fields. */
function resolveConfig(config) {
  const source = config ?? {}
  return {
    path: source.path,
    sessionTtlDays: source.sessionTtlDays ?? 30,
    phaethonName: source.phaethonName ?? 'phaethon',
    phaethonPassword: source.phaethonPassword === '' ? undefined : source.phaethonPassword,
  }
}

export function apply(ctx, config) {
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
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler }),
      `ourfairy-identity: ${path}`,
    )
  }

  ctx.logger?.info?.(
    `ourfairy-identity: Phaethon is short number ${String(PHAETHON_SHORT_ID)}`
    + ` (${seeded.created ? 'seeded' : 'already present'}),`
    + ` ${seeded.user.name}${seeded.user.isAdmin ? '' : ' (not an administrator)'}`,
  )
}
