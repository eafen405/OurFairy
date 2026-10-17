/** File authority is the immutable native owner; cwd only chooses a relative path base. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'

export const pathInside = (root, path) => path === root || path.startsWith(root + sep)
const register = (contributors, contribute) => {
  contributors.add(contribute)
  return () => { contributors.delete(contribute) }
}
const contributed = (contributors, session) => [...contributors].flatMap(contribute => contribute(session))
export class SpaceScope extends Service {
  calls = new AsyncLocalStorage()
  // Optional product-owned contributions, evaluated at every operation (no membership cache).
  _extraRoots = new Set()
  _readonlyFiles = new Set()
  constructor(ctx, config) {
    super(ctx, 'ourfairySpaces')
    this.root = config.root
    this.envRoot = join(config.root, '..', 'env')
    for (const dir of [join(this.root, 'public'), this.envRoot]) mkdirSync(dir, { recursive: true })
    this.envRoot = realpathSync(this.envRoot)
  }
  /** Register one contributor; the returned disposer releases only that contribution. */
  contributeExtraRoots(contribute) { return register(this._extraRoots, contribute) }
  contributeReadonlyFiles(contribute) { return register(this._readonlyFiles, contribute) }
  current() { return this.calls.getStore() }
  session(id) {
    const current = this.current()
    const session = current?.id === id ? current : this.ctx.sessions.get(id)
    if (!session) throw new FsError('file operation requires an owned session', 'FS_PERMISSION_DENIED')
    this.owner(session)
    return session
  }
  owner(session) {
    const owner = session?.header?.owner
    if (typeof owner !== 'string' || !/^user:[1-9]\d*$/.test(owner)) throw new FsError('file operation requires an owned session', 'FS_PERMISSION_DENIED')
    return owner.slice(5)
  }
  requireCurrent() {
    const session = this.current()
    this.owner(session)
    return session
  }
  run(session, action) { this.owner(session); return this.calls.run(session, action) }
  privateRoot(session) {
    const dir = join(this.root, 'private', this.owner(session))
    mkdirSync(dir, { recursive: true })
    return realpathSync(dir)
  }
  writeRoots(session) {
    this.owner(session)
    return [this.privateRoot(session), realpathSync(join(this.root, 'public')), this.envRoot, ...contributed(this._extraRoots, session)]
  }
  readonlyFiles(session) { return contributed(this._readonlyFiles, session) }
  readRoots(session) { return [...this.writeRoots(session), ...this.readonlyFiles(session)] }
  validatePolicy(policy, session) {
    this.owner(session)
    if (!policy || policy.sessionId !== session.id || policy.mode !== 'workspace-write') throw new FsError('execution requires the owned-session file policy; escalation is unavailable', 'FS_PERMISSION_DENIED')
  }
}
