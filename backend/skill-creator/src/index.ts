/**
 * The skill row: the product's runtime skill surface.
 *
 * It owns one SQLite file, the immutable version directories outside every
 * writable root, the per-user skill provider (registered on each live user
 * session's own scope), the read-only contribution that lets the model read an
 * activated package's resources, and the authenticated `/skills/*` endpoints
 * the client renders.
 *
 * The native `skill` registry, the trusted bundled filesystem provider and the
 * `skill` tool are separate native rows in the bundle. This row never
 * re-implements their catalog merge, activation or `/name` policy; it only
 * supplies per-user candidates and re-checks a version's integrity when the
 * native tool loads it.
 *
 * Creation, review, install and background learning are later tickets. This
 * row deliberately exposes no model tool yet: the selection pool and activation
 * are the whole runtime surface.
 *
 * @module @ourfairy/dsh-skill-creator
 */
import z from '@deepseek-ai/schemastery'
import { sep } from 'node:path'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { mountRoutes } from '@ourfairy/dsh-http/http'
import { SURFACE, skillHandlers } from './http.js'
import { SkillProviders } from './provider.js'
import { SkillService } from './service.js'
import { SkillStore } from './store.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// The dsh seams this row reads and augments. Type-only imports add no runtime
// dependency; the native packages resolve from the dsh installation anchor.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@ourfairy/dsh-identity'
import type {} from '@ourfairy/dsh-spaces'

export const name = 'ourfairy-skill-creator'
export const inject = ['skills', 'agents', 'identity', 'webServer', 'connection', 'ourfairySpaces']

/**
 * The row's configuration.
 *
 * `path` is the skill database and `root` is its data area
 * (`dshHomePath('skill')` by default): `versions/`, `tmp/`, `candidates/` and
 * `verify/` all live under that root, and a version's stored package path is
 * relative to it. `bundledSkillsDir` is the deployment's trusted bundled root,
 * the only native scan root the filesystem provider mounts.
 *
 * The learning settings and the verification/install bounds belong to later
 * tickets in this spec; they are declared now so one row owns the whole skill
 * domain and a later ticket adds behaviour rather than a second config
 * surface. The learning fields are `volatile()` because a saved value must
 * apply to the next judgement without remounting the row.
 */
export const Config = z.object({
  path: z.string().min(1).required(),
  root: z.string().min(1).required(),
  bundledSkillsDir: z.string().min(1).required(),
  // The deployment seed directory is optional: an empty value means none.
  seedDir: z.string().default(''),
  learningTurns: z.natural().min(1).max(50).default(5).volatile(),
  learningModel: z.string().min(1).default('MiniMax-M3.1-Flash').volatile(),
  learningProvider: z.string().min(1).default('minimax-cn').volatile(),
  learningMaxMaterialChars: z.natural().default(12000),
  learningMaxTurns: z.natural().default(4),
  verifyTimeoutMs: z.natural().default(120_000),
  installMaxBytes: z.natural().default(10 * 1024 * 1024),
})

/** The row config as the loader hands it over; only the runtime fields are read here. */
export type SkillCreatorConfig = {
  readonly path: string
  readonly root: string
  readonly bundledSkillsDir: string
  readonly seedDir?: string
}

/** Whether one absolute path is `root` or under it; the database belongs inside the data root. */
function insideRoot(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

export function apply(ctx: Context, config: SkillCreatorConfig): void {
  if (!insideRoot(config.root, config.path)) {
    throw new Error(`ourfairy-skill-creator: path ${config.path} must live inside root ${config.root}`)
  }
  const store = new SkillStore({ path: config.path })
  const service = new SkillService(store, { root: config.root, bundledSkillsDir: config.bundledSkillsDir })
  const providers = new SkillProviders(service)
  ctx.effect(() => () => {
    providers.dispose()
    store.close()
  }, 'ourfairy-skill-creator: store and providers')

  // The deployment seed runs before any agent is served: each top-level package
  // becomes a common approved identity, and an existing active common identity
  // with that name is never overwritten.
  const logger = ctx.logger('ourfairy-skill-creator')
  service.importSeedDirectory(config.seedDir ?? '', (level, message) => {
    if (level === 'info') logger.info(message)
    else logger.warn(message)
  })

  const handlers = skillHandlers({
    service,
    authenticate: request => ctx.identity.authenticateRequest(request),
    fence: request => ctx.connection.fence(request),
    invalidateOwner: shortId => providers.invalidateOwner(shortId),
  })
  mountRoutes(ctx, { label: 'ourfairy-skill-creator', surface: SURFACE, handlers })

  // The model reaches a package's files through the ordinary `read`/`bash`
  // tools; the scope's read roots are the only grant. Every session sees the
  // trusted bundled root; an owned session also sees exactly the current
  // version directories its catalog can activate. The data root itself is never
  // contributed.
  ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(
    session => service.readonlyVersionDirs(shortIdOf(session.header.owner)),
  ), 'ourfairy-skill-creator: read-only skill versions')

  ctx.on('agent/created', ({ agent }: { agent: Agent }) => {
    providers.register(agent)
    return undefined
  }, { global: true })
  ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => providers.forget(agent), { global: true })
  for (const agent of ctx.agents.list()) providers.register(agent)
}

export { SKILL_PATHS, SURFACE } from './http.js'
export { ACTION_SCOPE, POOL_STATE, SkillService } from './service.js'
export { PROVIDER_NAME, SkillProviders } from './provider.js'
export { SKILL_SCOPE, SkillStore, SOURCE_TYPE, VERSION_STATUS } from './store.js'
export { importReviewedPackage } from './seed.js'
