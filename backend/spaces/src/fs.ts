// fd-bound operations adapted from Fairybot processing/fs-provider.ts.
import { constants, type BigIntStats } from 'node:fs'
import { link as fsLink, lstat as fsLstat, mkdir as fsMkdir, open as fsOpen, readdir as fsReaddir, readlink as fsReadlink, realpath as fsRealpath, rename as fsRename, rm as fsRm, type FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-fs-local'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { pathInside, type SpaceScope } from './scope.js'

const O_PATH = 0o10000000, O_CLOEXEC = 0o2000000

/**
 * The errno one filesystem call failed with.
 *
 * The pre-migration code read `error.code` straight off the caught value, so
 * this reads the same property the same way: a thrown `null` still fails here
 * exactly as it did before.
 */
function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

/** What one resolved target is allowed to touch, for one session. */
interface Grant {
  /** The session the target was resolved for. */
  sessionId?: SessionId
  /** The roots the session may read. */
  readRoots: string[]
  /** The roots the session may write. */
  writeRoots: string[]
  /** The resource directories the session owns. */
  resourceDirs: string[]
}

/** One opened leaf file, bound to an authorized root. */
interface BoundLeaf {
  handle: FileHandle
  fdPath: string
  real: string
}

/** One opened parent directory, bound to an authorized root. */
interface BoundParent {
  handle: FileHandle
  fdPath: string
  name: string
  boundPath: string
  lockKey: string
}

/** One existing leaf opened for a write. */
interface LeafForWrite {
  meta: FileHandle
  read: FileHandle | undefined
  version: FsVersion
  mode: number
}

/** The product's scoped filesystem: every path is opened inside the session's roots. */
export default class ScopedFileSystem extends LocalFileSystem {
  static inject = ['ourfairySpaces']
  // The row's own config is the native local filesystem config: cwd and the diff basis bound.
  static override Config = LocalFileSystem.Config

  /** The scope every path of this provider is checked against. */
  readonly scope: SpaceScope
  /** The permissions each resolved target carries. */
  readonly grants = new Map<string, Grant>()
  /** The write tail per path, so two writes to one path stay ordered. */
  readonly writeLocks = new Map<string, Promise<unknown>>()
  /** The Linux descriptor directory the authorized open boundary needs. */
  readonly procFdDir = process.platform === 'linux' ? '/proc/self/fd' : undefined
  /** The exclusive byte limit on one overwrite-diff side. */
  readonly diffBasisMaxBytes = 10 * 1024 * 1024

  constructor(ctx: Context, config: LocalConfig) {
    super(ctx, config)
    this.scope = ctx.ourfairySpaces
  }

  override get sandboxMode(): SandboxMode {
    return 'workspace-write'
  }

  override processPathFromHostPath(hostPath: string): string | undefined {
    const session = this.scope.current()
    return session && this.scope.readRoots(session).some((root) => pathInside(root, hostPath)) ? hostPath : undefined
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const session = this.scope.requireCurrent()
    const roots = this.scope.readRoots(session)
    const target = await super.resolve(path, { ...opts, cwd: opts?.cwd ?? this.scope.privateRoot(session) })
    if (!roots.some((root) => pathInside(root, String(target.targetKey)))) throw new FsError('path outside authorized spaces', 'FS_PERMISSION_DENIED')
    this.remember(String(target.targetKey), { sessionId: session.id, readRoots: roots,
      writeRoots: this.scope.writeRoots(session), resourceDirs: [] })
    return target
  }

  liveRootsOf(grant: Grant): string[] {
    return this.scope.readRoots(this.scope.session(grant.sessionId))
  }

  async assertRead(target: FsTarget): Promise<Grant> {
    const session = this.scope.requireCurrent()
    const grant = this.grants.get(String(target.targetKey))
    if (!grant || !this.scope.readRoots(session).some((root) => pathInside(root, String(target.targetKey)))) throw new FsError('path outside authorized spaces', 'FS_PERMISSION_DENIED')
    return {
      ...grant,
      sessionId: session.id
    }
  }

  async assertWrite(target: FsTarget, _op: string, policy: SandboxExecutionPolicy | undefined): Promise<string> {
    const session = this.scope.requireCurrent()
    this.scope.validatePolicy(policy, session)
    const root = this.scope.writeRoots(session).find((root) => pathInside(root, String(target.targetKey)))
    if (!root) throw new FsError('path outside writable spaces', 'FS_PERMISSION_DENIED')
    return root
  }

  remember(key: string, grant: Grant): void {
    if (this.grants.size >= 8192) {
      const oldest = this.grants.keys().next().value
      if (oldest !== undefined) this.grants.delete(oldest)
    }
    this.grants.set(key, grant)
  }

  mapOpenError(error: unknown, op: string, displayPath: string): FsError {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return new FsError(`cannot ${op} "${displayPath}": not found`, 'FS_NOT_FOUND', { cause: error })
    }
    if (code === 'ELOOP') {
      return new FsError(`cannot ${op} "${displayPath}": symlink outside the authorized open boundary`, 'FS_PERMISSION_DENIED', {
        cause: error })
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return new FsError(`cannot ${op} "${displayPath}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error })
    }
    const message = error instanceof Error ? error.message : String(error)
    return new FsError(`cannot ${op} "${displayPath}": ${message}`, 'FS_IO_ERROR', { cause: error })
  }

  async assertFdInside(handle: FileHandle, roots: readonly string[] | undefined, op: string, displayPath: string): Promise<string> {
    const real = await fsReadlink(`${this.procFdDir}/${handle.fd}`)
    if (real.endsWith(' (deleted)')) {
      throw new FsError(`cannot ${op} "${displayPath}": not found`, 'FS_NOT_FOUND')
    }
    if (roots === undefined || !roots.some((root) => pathInside(root, real))) {
      throw new FsError(`cannot ${op} "${displayPath}": opened object is outside the authorized scope`, 'FS_PERMISSION_DENIED')
    }
    return real
  }

  async openBoundLeaf(subject: string, displayPath: string, op: string, roots: readonly string[] | undefined, flags?: number): Promise<BoundLeaf> {
    if (this.procFdDir === undefined) {
      throw new FsError(`cannot ${op} "${displayPath}": authorized open boundary requires Linux /proc/self/fd`, 'FS_PERMISSION_DENIED')
    }
    let handle: FileHandle
    try {
      handle = await fsOpen(subject, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC | (flags ?? 0))
    } catch (error) {
      throw this.mapOpenError(error, op, displayPath)
    }
    try {
      const real = await this.assertFdInside(handle, roots, op, displayPath)
      return {
        handle,
        fdPath: `${this.procFdDir}/${handle.fd}`,
        real
      }
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }

  async openBoundParent(subject: string, displayPath: string, op: string, root: string): Promise<BoundParent> {
    if (this.procFdDir === undefined) {
      throw new FsError(`cannot ${op} "${displayPath}": authorized open boundary requires Linux /proc/self/fd`, 'FS_PERMISSION_DENIED')
    }
    const name = basename(subject)
    const missing: string[] = []
    let ancestor = dirname(subject)
    let handle: FileHandle
    for (;;) {
      try {
        handle = await fsOpen(ancestor, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | O_CLOEXEC)
        break
      } catch (error) {
        const code = errorCode(error)
        if (code === 'ENOTDIR') {
          const link = await fsLstat(ancestor).then((info) => info.isSymbolicLink(), () => false)
          if (link) {
            throw new FsError(`cannot ${op} "${displayPath}": symlink outside the authorized open boundary`, 'FS_PERMISSION_DENIED', {
              cause: error })
          }
          throw new FsError(`cannot ${op} "${displayPath}": not found`, 'FS_NOT_FOUND', { cause: error })
        }
        if (code !== 'ENOENT') throw this.mapOpenError(error, op, displayPath)
        const parent = dirname(ancestor)
        if (parent === ancestor) throw new FsError(`cannot ${op} "${displayPath}": not found`, 'FS_NOT_FOUND', {
          cause: error })
        missing.unshift(basename(ancestor))
        ancestor = parent
      }
    }
    let fdPath = `${this.procFdDir}/${handle.fd}`
    try {
      await this.assertFdInside(handle, [root], op, displayPath)
      for (const seg of missing) {
        try {
          await fsMkdir(`${fdPath}/${seg}`)
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw this.mapOpenError(error, op, displayPath)
        }
        const next = await fsOpen(`${fdPath}/${seg}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | O_CLOEXEC).catch((error) => {
          throw this.mapOpenError(error, op, displayPath) })
        await handle.close().catch(() => undefined)
        handle = next
        fdPath = `${this.procFdDir}/${next.fd}`
      }
      const realDir = await fsReadlink(fdPath).catch((error) => { throw this.mapOpenError(error, op, displayPath) })
      if (realDir.endsWith(' (deleted)')) {
        throw new FsError(`cannot ${op} "${displayPath}": not found`, 'FS_NOT_FOUND')
      }
      return {
        handle,
        fdPath,
        name,
        boundPath: `${fdPath}/${name}`,
        lockKey: `${realDir}/${name}`
      }
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }

  mintTarget(key: string, displayPath: string): FsTarget {
    return {
      targetKey: FsTargetKey(key),
      displayPath
    }
  }

  mintChildTarget(canonicalKey: string, displayPath: string, grant: Grant): FsTarget {
    this.remember(canonicalKey, { readRoots: grant.readRoots,
      writeRoots: grant.writeRoots.filter((root) => pathInside(root, canonicalKey)),
      resourceDirs: grant.resourceDirs.filter((dir) => pathInside(dir, canonicalKey)),
      ...grant.sessionId === undefined ? {} : { sessionId: grant.sessionId } })
    return this.mintTarget(canonicalKey, displayPath)
  }

  async withWriteLock<T>(key: string, op: () => Promise<T>): Promise<T> {
    const run = (this.writeLocks.get(key) ?? Promise.resolve()).then(op, op)
    const tail = run.then(() => undefined, () => undefined)
    this.writeLocks.set(key, tail)
    try {
      return await run
    } finally { if (this.writeLocks.get(key) === tail) this.writeLocks.delete(key) }
  }

  pathTypeOf(info: BigIntStats): 'symlink' | 'file' | 'directory' | 'other' {
    if (info.isSymbolicLink()) return 'symlink'
    if (info.isFile()) return 'file'
    if (info.isDirectory()) return 'directory'
    return 'other'
  }

  versionOf(info: BigIntStats): FsVersion {
    return FsVersion(`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`)
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const cwd = opts?.cwd
    let target: FsTarget
    try {
      target = await this.resolve(path, { ...cwd !== undefined ? { cwd } : {},
        ...signal !== undefined ? { signal } : {} })
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return undefined
      throw error
    }
    const grant = await this.assertRead(target)
    const openSubject = target.displayPath
    let bound: BoundLeaf
    try {
      bound = await this.openBoundLeaf(openSubject, target.displayPath, 'lstat', this.liveRootsOf(grant), O_PATH)
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return undefined
      throw error
    }
    try {
      const info = await bound.handle.stat({ bigint: true })
      return {
        version: this.versionOf(info),
        type: this.pathTypeOf(info),
        size: Number(info.size)
      }
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const grant = await this.assertRead(target)
    let bound: BoundLeaf
    try {
      bound = await this.openBoundLeaf(String(target.targetKey), target.displayPath, 'stat', this.liveRootsOf(grant))
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_NOT_FOUND') return undefined
      throw error
    }
    try {
      return await super.stat(this.mintTarget(bound.fdPath, target.displayPath), signal)
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const grant = await this.assertRead(target)
    const bound = await this.openBoundLeaf(String(target.targetKey), target.displayPath, 'read', this.liveRootsOf(grant))
    try {
      return await super.readText(this.mintTarget(bound.fdPath, target.displayPath), signal)
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  override async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const grant = await this.assertRead(target)
    const bound = await this.openBoundLeaf(String(target.targetKey), target.displayPath, 'read', this.liveRootsOf(grant))
    let iterable: AsyncIterable<string>
    try {
      iterable = await super.streamText(this.mintTarget(bound.fdPath, target.displayPath), signal)
    } catch (error) {
      await bound.handle.close().catch(() => undefined)
      throw error
    }
    const handle = bound.handle
    async function* boundStream() {
      try {
        yield* iterable
      } finally { await handle.close().catch(() => undefined) }
    }
    return boundStream()
  }

  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const grant = await this.assertRead(target)
    const bound = await this.openBoundLeaf(String(target.targetKey), target.displayPath, 'read', this.liveRootsOf(grant))
    try {
      return await super.readBytes(this.mintTarget(bound.fdPath, target.displayPath), signal, maxBytes)
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  override async readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    const grant = await this.assertRead(target)
    const bound = await this.openBoundLeaf(String(target.targetKey), target.displayPath, 'read', this.liveRootsOf(grant))
    try {
      return await super.readByteRange(this.mintTarget(bound.fdPath, target.displayPath), range, signal)
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const grant = await this.assertRead(target)
    const roots = this.liveRootsOf(grant)
    const bound = await this.openBoundLeaf(String(target.targetKey), target.displayPath, 'list', roots)
    try {
      const info = await bound.handle.stat({ bigint: true })
      if (!info.isDirectory()) throw new FsError(`cannot list "${target.displayPath}": not a directory`, 'FS_NOT_DIRECTORY')
      const dirReal = bound.real
      const entries = await fsReaddir(bound.fdPath, { withFileTypes: true }).catch((error) => {
        throw this.mapOpenError(error, 'list', target.displayPath) })
      const result: FsDirEntry[] = []
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (signal?.aborted) throw new FsError('list aborted', 'FS_ABORTED')
        const displayChild = join(target.displayPath, entry.name)
        const linfo = await fsLstat(`${bound.fdPath}/${entry.name}`, { bigint: true }).catch(() => undefined)
        if (linfo === undefined) {
          result.push({ name: entry.name, type: 'other',
            target: this.mintTarget(join(dirReal, entry.name), displayChild) })
          continue
        }
        if (!linfo.isSymbolicLink()) {
          const childKey = join(dirReal, entry.name)
          const type = this.pathTypeOf(linfo)
          result.push({ name: entry.name, type: type === 'symlink' ? 'other' : type,
            target: this.mintChildTarget(childKey, displayChild, grant), version: this.versionOf(linfo),
            ...linfo.isFile() ? { size: Number(linfo.size) } : {} })
          continue
        }
        const realpath = await fsRealpath(`${bound.fdPath}/${entry.name}`).catch(() => undefined)
        if (realpath === undefined || !roots.some((root) => pathInside(root, realpath))) {
          result.push({ name: entry.name, type: 'other',
            target: this.mintTarget(realpath ?? join(dirReal, entry.name), displayChild) })
          continue
        }
        const childBound = await this.openBoundLeaf(realpath, displayChild, 'list', roots).catch(() => undefined)
        if (childBound === undefined) {
          result.push({ name: entry.name, type: 'other', target: this.mintTarget(realpath, displayChild) })
          continue
        }
        try {
          const cinfo = await childBound.handle.stat({ bigint: true })
          const ctype = this.pathTypeOf(cinfo)
          result.push({ name: entry.name, type: ctype === 'symlink' ? 'other' : ctype,
            target: this.mintChildTarget(realpath, displayChild, grant), version: this.versionOf(cinfo),
            ...cinfo.isFile() ? { size: Number(cinfo.size) } : {} })
        } finally { await childBound.handle.close().catch(() => undefined) }
      }
      return result
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  async openLeafForWrite(leafPath: string, op: string, displayPath: string): Promise<LeafForWrite | undefined> {
    let meta: FileHandle
    try {
      meta = await fsOpen(leafPath, O_PATH | constants.O_NOFOLLOW | O_CLOEXEC)
    } catch (error) {
      const code = errorCode(error)
      if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
      throw this.mapOpenError(error, op, displayPath)
    }
    try {
      const info = await meta.stat({ bigint: true })
      if (info.isSymbolicLink()) {
        throw new FsError(`cannot ${op} "${displayPath}": symlink outside the authorized open boundary`, 'FS_PERMISSION_DENIED')
      }
      if (!info.isFile()) {
        throw new FsError(`cannot ${op} "${displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      let read: FileHandle | undefined
      try {
        read = await fsOpen(leafPath, constants.O_RDONLY | constants.O_NOFOLLOW | O_CLOEXEC)
      } catch (error) {
        const code = errorCode(error)
        if (code === 'ELOOP') {
          throw new FsError(`cannot ${op} "${displayPath}": symlink outside the authorized open boundary`, 'FS_PERMISSION_DENIED')
        }
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          await meta.close()
          return undefined
        }
        if (code !== 'EACCES' && code !== 'EPERM') throw this.mapOpenError(error, op, displayPath)
      }
      return {
        meta,
        read,
        version: this.versionOf(info),
        mode: Number(info.mode & 0o777n)
      }
    } catch (error) {
      await meta.close().catch(() => undefined)
      throw error
    }
  }

  throwIfAborted(signal: AbortSignal | undefined, verb: string): void {
    if (signal?.aborted) throw new FsError(`${verb} aborted`, 'FS_ABORTED')
  }

  normalizeLineEndings(content: string): string {
    return content.replaceAll('\r\n', '\n')
  }

  detectLineEndings(raw: string): 'CRLF' | 'LF' {
    const sample = raw.slice(0, 4096)
    const crlf = sample.split('\r\n').length - 1
    return crlf > sample.split('\n').length - 1 - crlf ? 'CRLF' : 'LF'
  }

  restoreLineEndings(content: string, lineEndings: 'CRLF' | 'LF'): string {
    return lineEndings === 'LF' ? content : this.normalizeLineEndings(content).split('\n').join('\r\n')
  }

  async readBoundBasis(read: FileHandle, maxBytes: number, signal: AbortSignal | undefined): Promise<string | null> {
    this.throwIfAborted(signal, 'read')
    try {
      const info = await read.stat()
      if (!info.isFile() || info.size >= maxBytes) return null
      const buffer = await read.readFile(signal !== undefined ? { signal } : {})
      if (buffer.length !== info.size || buffer.includes(0)) return null
      try {
        return this.normalizeLineEndings(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        return null
      }
    } catch (error) {
      if (error instanceof FsError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new FsError('read aborted', 'FS_ABORTED')
      if (error instanceof Error && 'code' in error) return null
      throw error
    }
  }

  async readBoundForEdit(read: FileHandle, displayPath: string, signal: AbortSignal | undefined): Promise<{ content: string; lineEndings: 'CRLF' | 'LF' }> {
    this.throwIfAborted(signal, 'edit')
    let buffer: Buffer
    try {
      buffer = await read.readFile(signal !== undefined ? { signal } : {})
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new FsError('edit aborted', 'FS_ABORTED')
      throw this.mapOpenError(error, 'edit', displayPath)
    }
    this.throwIfAborted(signal, 'edit')
    if (buffer.includes(0)) throw new FsError(`cannot edit "${displayPath}": binary file`, 'FS_NOT_TEXT')
    let raw: string
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      throw new FsError(`cannot edit "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT')
    }
    return {
      content: this.normalizeLineEndings(raw),
      lineEndings: this.detectLineEndings(raw)
    }
  }

  applyLiteralEditBound(content: string, oldString: string, newString: string, replaceAll: boolean, displayPath: string): { content: string } {
    const oldNorm = this.normalizeLineEndings(oldString)
    if (oldNorm.length === 0) throw new FsError('old_string must be a non-empty string', 'FS_EDIT_NOT_FOUND')
    const newNorm = this.normalizeLineEndings(newString)
    let count = 0
    for (let index = 0;;) {
      const found = content.indexOf(oldNorm, index)
      if (found === -1) break
      count += 1
      index = found + oldNorm.length
    }
    if (count === 0) throw new FsError(`old_string was not found in "${displayPath}"`, 'FS_EDIT_NOT_FOUND')
    if (!replaceAll && count > 1) {
      throw new FsError(`old_string matched ${count} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`, 'FS_AMBIGUOUS_EDIT')
    }
    return {
      content: content.split(oldNorm).join(newNorm)
    }
  }

  async publishStaged(dirFdPath: string, leafPath: string, content: string, mode: number | undefined, createIfAbsent: boolean, signal: AbortSignal | undefined, displayPath: string): Promise<void> {
    this.throwIfAborted(signal, 'write')
    const tempPath = `${dirFdPath}/.${basename(leafPath)}.${process.pid}.${randomUUID()}.tmp`
    let temp: FileHandle
    try {
      temp = await fsOpen(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | O_CLOEXEC, 0o600)
    } catch (error) {
      throw this.mapOpenError(error, 'write', displayPath)
    }
    try {
      if (mode !== undefined) await temp.chmod(mode)
      await temp.writeFile(content, { encoding: 'utf8', ...signal !== undefined ? { signal } : {} })
      await temp.sync()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new FsError('write aborted', 'FS_ABORTED')
      throw this.mapOpenError(error, 'write', displayPath)
    } finally { await temp.close().catch(() => undefined) }
    try {
      this.throwIfAborted(signal, 'write')
      if (createIfAbsent) {
        try {
          await fsLink(tempPath, leafPath)
        } catch (error) {
          const existing = await fsLstat(leafPath).catch((metaError) => { const code = errorCode(metaError)
            if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
            throw new FsError(`cannot write "${displayPath}": ${(metaError as Error).message}`, 'FS_IO_ERROR', { cause: metaError
            }) })
          if (existing !== undefined) {
            if (!existing.isFile()) {
              throw new FsError(`cannot write "${displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE', {
                cause: error })
            }
            throw new FsError(`cannot overwrite existing "${displayPath}" without reading it first`, 'FS_NOT_OBSERVED', {
              cause: error })
          }
          if (errorCode(error) === 'EEXIST') {
            throw new FsError(`cannot overwrite existing "${displayPath}" without reading it first`, 'FS_NOT_OBSERVED', {
              cause: error })
          }
          throw this.mapOpenError(error, 'write', displayPath)
        }
      } else {
        await fsRename(tempPath, leafPath).catch((error) => { if (errorCode(error) === 'EISDIR') {
          throw new FsError(`cannot write "${displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE', { cause: error
          }) } throw this.mapOpenError(error, 'write', displayPath) })
      }
    } finally { await fsRm(tempPath, { force: true }).catch(() => undefined) }
  }

  async probePublished(leafPath: string): Promise<FsVersion> {
    const info = await fsLstat(leafPath, { bigint: true }).catch(() => undefined)
    if (info === undefined || !info.isFile()) return FsVersion(`missing:${leafPath}`)
    return this.versionOf(info)
  }

  override async writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsWriteOutcome> {
    const root = await this.assertWrite(target, 'write', sandboxPolicy)
    const bound = await this.openBoundParent(String(target.targetKey), target.displayPath, 'write', root)
    try {
      return await this.withWriteLock(bound.lockKey, async () => {
        const leaf = await this.openLeafForWrite(bound.boundPath, 'write', target.displayPath); try {
          if (expected?.kind === 'replaceIfVersion') {
            if (leaf === undefined) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
            if (leaf.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
          } else if (expected?.kind === 'createIfAbsent' && leaf !== undefined) {
            throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
          }
          const before = leaf?.read !== undefined && Buffer.byteLength(content, 'utf8') < this.diffBasisMaxBytes ? await this.readBoundBasis(leaf.read, this.diffBasisMaxBytes, signal) : null
          await this.publishStaged(bound.fdPath, bound.boundPath, content, leaf?.mode, expected?.kind === 'createIfAbsent', signal, target.displayPath)
          const version = await this.probePublished(bound.boundPath); return {
            operation: leaf === undefined ? 'create' : 'update', version, before,
            after: this.normalizeLineEndings(content) } } finally { if (leaf !== undefined) {
            await leaf.meta.close().catch(() => undefined); await leaf.read?.close().catch(() => undefined) } } })
    } finally { await bound.handle.close().catch(() => undefined) }
  }

  override async editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsEditOutcome> {
    const root = await this.assertWrite(target, 'edit', sandboxPolicy)
    const bound = await this.openBoundParent(String(target.targetKey), target.displayPath, 'edit', root)
    try {
      return await this.withWriteLock(bound.lockKey, async () => {
        const leaf = await this.openLeafForWrite(bound.boundPath, 'edit', target.displayPath); try {
          if (leaf === undefined) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
          if (expected !== undefined && leaf.version !== expected.version) {
            throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
          }
          if (leaf.read === undefined) throw new FsError(`cannot edit "${target.displayPath}": permission denied`, 'FS_PERMISSION_DENIED')
          const original = await this.readBoundForEdit(leaf.read, target.displayPath, signal)
          const edited = this.applyLiteralEditBound(original.content, edit.oldString, edit.newString, edit.replaceAll, target.displayPath)
          const content = this.restoreLineEndings(edited.content, original.lineEndings)
          await this.publishStaged(bound.fdPath, bound.boundPath, content, leaf.mode, false, signal, target.displayPath)
          const version = await this.probePublished(bound.boundPath); return { version, before: original.content,
            after: edited.content } } finally { if (leaf !== undefined) {
            await leaf.meta.close().catch(() => undefined); await leaf.read?.close().catch(() => undefined) } } })
    } finally { await bound.handle.close().catch(() => undefined) }
  }
}
