/**
 * The product's file authority: the roots one session may read and write.
 *
 * The authority is the immutable `SessionHeader.owner`; the working directory
 * only chooses the base a relative path resolves against. Everything the scope
 * grants derives from that owner, so a session cannot widen its own reach.
 *
 * @module @ourfairy/dsh-spaces/src/scope
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { Session, SessionId, SessionOwnerId } from '@deepseek-ai/dsh-session'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'

/** Whether one path is the root itself or a path under it. */
export const pathInside = (root: string, path: string): boolean => path === root || path.startsWith(root + sep)

/**
 * The session facts the scope reads.
 *
 * The scope's authority is the immutable owner header, so it never needs the
 * live session object: a dsh `Session` satisfies this shape, and so does the
 * header-shaped stand-in the scope-contributor fixture registers.
 */
export interface OwnedSession {
  readonly id: SessionId
  readonly header: { readonly owner?: SessionOwnerId }
}

/** One contributor's grant for one session: the paths it adds to the scope. */
export type ScopeContributor = (session: OwnedSession) => readonly string[]

const register = (contributors: Set<ScopeContributor>, contribute: ScopeContributor): (() => void) => {
  contributors.add(contribute)
  return () => { contributors.delete(contribute) }
}

const contributed = (contributors: Set<ScopeContributor>, session: OwnedSession): string[] =>
  [...contributors].flatMap(contribute => contribute(session))

/** The product's space scope, as the composition reads it at `ctx.ourfairySpaces`. */
export class SpaceScope extends Service {
  /** The session the current file operation belongs to; absent for an agentless call. */
  readonly calls = new AsyncLocalStorage<Session | undefined>()
  // Product-owned contributions, evaluated at every operation rather than cached.
  readonly _extraRoots = new Set<ScopeContributor>()
  readonly _readonlyFiles = new Set<ScopeContributor>()
  /** The absolute root every product space lives under. */
  readonly root: string
  /** The shared environment root every session may use for dependencies. */
  readonly envRoot: string

  constructor(ctx: Context, config: { readonly root: string }) {
    super(ctx, 'ourfairySpaces')
    this.root = config.root
    const envRoot = join(config.root, '..', 'env')
    for (const dir of [join(this.root, 'public'), envRoot]) mkdirSync(dir, { recursive: true })
    this.envRoot = realpathSync(envRoot)
  }

  /** Register one contributor; the returned disposer releases only that contribution. */
  contributeExtraRoots(contribute: ScopeContributor): () => void {
    return register(this._extraRoots, contribute)
  }

  /** Register one read-only contribution; the returned disposer releases only that contribution. */
  contributeReadonlyFiles(contribute: ScopeContributor): () => void {
    return register(this._readonlyFiles, contribute)
  }

  /** The session the current operation belongs to, when one is in scope. */
  current(): Session | undefined {
    return this.calls.getStore()
  }

  /** The session one operation acts on; the current scope wins over the store. */
  session(id: SessionId | undefined): Session {
    const current = this.current()
    const session = current?.id === id ? current : id === undefined ? undefined : this.ctx.sessions.get(id)
    if (!session) throw new FsError('file operation requires an owned session', 'FS_PERMISSION_DENIED')
    this.owner(session)
    return session
  }

  /** The short number this session's stored owner names. */
  owner(session: OwnedSession | undefined): number {
    const shortId = shortIdOf(session?.header?.owner)
    if (shortId === undefined) throw new FsError('file operation requires an owned session', 'FS_PERMISSION_DENIED')
    return shortId
  }

  /** The session the current operation belongs to; an agentless call is refused. */
  requireCurrent(): Session {
    const session = this.current()
    if (session === undefined) throw new FsError('file operation requires an owned session', 'FS_PERMISSION_DENIED')
    this.owner(session)
    return session
  }

  /** Run one action with the given session in scope. */
  run<T>(session: Session, action: () => T): T {
    this.owner(session)
    return this.calls.run(session, action)
  }

  /** The session's own private directory: the root nobody else may write. */
  privateRoot(session: OwnedSession | undefined): string {
    const dir = join(this.root, 'private', `${this.owner(session)}`)
    mkdirSync(dir, { recursive: true })
    return realpathSync(dir)
  }

  /** The roots this session may write: its private directory, the public space and the shared environment. */
  writeRoots(session: OwnedSession): string[] {
    this.owner(session)
    return [this.privateRoot(session), realpathSync(join(this.root, 'public')), this.envRoot, ...contributed(this._extraRoots, session)]
  }

  /** The files this session may read but never write. */
  readonlyFiles(session: OwnedSession): string[] {
    return contributed(this._readonlyFiles, session)
  }

  /** Every root this session may read. */
  readRoots(session: OwnedSession): string[] {
    return [...this.writeRoots(session), ...this.readonlyFiles(session)]
  }

  /** The policy one confined call must carry before it may touch the scope. */
  validatePolicy(policy: SandboxExecutionPolicy | undefined, session: OwnedSession): void {
    this.owner(session)
    if (!policy || policy.sessionId !== session.id || policy.mode !== 'workspace-write') throw new FsError('execution requires the owned-session file policy; escalation is unavailable', 'FS_PERMISSION_DENIED')
  }
}
