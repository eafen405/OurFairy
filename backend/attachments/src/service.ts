/**
 * Upload lifecycle is business state; admitted native messages alone grant
 * content access.
 *
 * @module @ourfairy/dsh-attachments/src/service
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { SessionScopeError, OwnedSessionService } from '@ourfairy/dsh-sessions'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { createReadStream, realpathSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { IdentityService } from '@ourfairy/dsh-identity'
import type { OwnedSession } from '@ourfairy/dsh-spaces'
// The dsh context's own seams: the native attachment store this service saves
// into, the model catalog it asks about image input, the default model, the
// filesystem and the working directory. The imports are type-only, so they add
// no runtime dependency.
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
// The product's own seam: the space scope that owns the file roots.
import type {} from '@ourfairy/dsh-spaces'

const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024
export const MAX_ATTACHMENTS = 8
export const MAX_CHUNK_BYTES = 256 * 1024

/** The owner facts the owned-session service names a caller by. */
type SessionOwner = NonNullable<ReturnType<OwnedSessionService['authenticate']>>

/** One upload row, as the identity store returns it. */
type UploadRow = NonNullable<ReturnType<IdentityService['uploads']['read']>>

/** The upload facts the product exposes to a client. */
export interface ExposedUpload {
  readonly uploadId: string
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly sha256: string
  readonly status: number
  readonly offset: number
  readonly expiresAt: number
}

/** One attachment the product admitted on a message. */
export interface AttachmentInput {
  readonly uploadId: string
  readonly name: string
  readonly mime: string
  readonly original: FileAttachmentRef
  readonly image?: ImageAttachmentRef
}

/**
 * One admitted message, as the attachment manifest reads it.
 *
 * The session log is JSON: the `attachments` field on a message source is the
 * product's own extension, written by the chat package when it admits an
 * upload. The event stream is read back here, at the boundary where JSON
 * becomes product values.
 */
interface AdmittedMessage {
  readonly id: string
  readonly source?: { readonly attachments?: readonly AttachmentInput[] }
}

/** The event types this service reads messages from, as the product's own shapes. */
type AdmittedEvent =
  | { readonly type: 'agent/inbox/spliced'; readonly data: { readonly inserted: readonly AdmittedMessage[] } }
  | { readonly type: 'user/message'; readonly data: AdmittedMessage }
  | { readonly type: 'delivery/message'; readonly data: { readonly message: AdmittedMessage } }

/** The selector one delivery names: an admitted message attachment or a workspace path. */
export interface DeliverySelector {
  /** The admitted message the attachment belongs to. */
  readonly messageId?: string
  /** The attachment's index in that message. */
  readonly index?: number
  /** The workspace path to snapshot instead of an admitted attachment. */
  readonly path?: string
}

/** The one file a delivery shares. */
export interface PreparedFile {
  readonly name: string
  readonly mime: string
  readonly original: FileAttachmentRef
  readonly image?: ImageAttachmentRef
}

export class AttachmentError extends SessionScopeError {}

/** Refuse one request with the product's own error shape. */
function fail(status: number, code: string, message: string): never {
  throw new AttachmentError(status, `attachments/${code}`, message)
}

/**
 * Whether one value is a safe integer.
 *
 * The check is `Number.isSafeInteger` itself; it is written as a type guard so
 * the value that passes it can be used as a number.
 */
const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value)

/**
 * The errno one filesystem call failed with.
 *
 * The pre-migration code read `error.code` straight off the caught value, so
 * this reads the same property the same way.
 */
const errorCode = (error: unknown): string | undefined => (error as { code?: string }).code

/** The attachments one admitted message carries. */
const attachmentManifest = (message: AdmittedMessage): readonly AttachmentInput[] => message.source?.attachments ?? []

/**
 * The admitted messages of one event stream.
 *
 * Only three event types carry a message, and only a user message carries the
 * product's attachment manifest.
 */
function admittedMessages(events: readonly SessionEvent[]): AdmittedMessage[] {
  const admitted = events as unknown as readonly AdmittedEvent[]
  return admitted.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted
    : event.type === 'user/message' ? [event.data]
    : event.type === 'delivery/message' ? [event.data.message] : [])
}

/** The display filename one upload may carry. */
function safeName(name: unknown): string {
  if (typeof name !== 'string' || name.length > 1024) fail(400, 'invalid-request', 'provide a display filename')
  const leaf = name.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim().replace(/[. ]+$/u, '').slice(0, 128) ?? ''
  return !leaf || leaf === '.' || leaf === '..' ? 'file' : leaf
}

/** The digest one upload's original bytes must match. */
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * The upload ids one request names.
 *
 * @param value - the raw request value.
 * @returns the distinct upload ids, in request order.
 */
export function uploadIdsOf(value: unknown = []): string[] {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS || value.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
    || new Set(value).size !== value.length) fail(400, 'invalid-request', 'provide at most 8 distinct upload IDs')
  // Every element passed the string check above, so the array is a list of ids.
  return value as string[]
}

/** The attachment service the composition reads as `ctx.ourfairyAttachments`. */
export class AttachmentService extends Service {
  /** One in-flight operation per upload, so two chunks cannot race. */
  readonly _queues = new Map<string, Promise<unknown>>()
  /** The qualified file paths one session may read. */
  readonly _qualified = new WeakMap<object, string[]>()
  /** The directory the staged originals live in. */
  readonly root: string

  constructor(ctx: Context, { root }: { readonly root: string }) {
    super(ctx, 'ourfairyAttachments')
    this.root = root
  }

  /** The identity store's upload face. */
  get uploads(): IdentityService['uploads'] {
    return this.ctx.identity.uploads
  }

  /** The caller one request belongs to. */
  caller(request: IncomingMessage): SessionOwner {
    const owner = this.ctx.ourfairySessions.authenticate(request)
    if (!owner) fail(401, 'unauthorized', 'present a live session credential')
    return owner
  }

  _path(id: string): string {
    return join(this.root, id)
  }

  /** Run one action with every other action on the same upload behind it. */
  async _locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const before = this._queues.get(id) ?? Promise.resolve(), started = before.then(action, action)
    const tail = started.then(() => undefined, () => undefined); this._queues.set(id, tail)
    try { return await started } finally { if (this._queues.get(id) === tail) this._queues.delete(id) }
  }

  /** The upload facts a client may see. */
  expose(row: UploadRow): ExposedUpload {
    return { uploadId: row.uploadId, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256,
      status: row.status, offset: row.offset, expiresAt: row.expiresAt }
  }

  /** The live upload one owner names. */
  async _owned(owner: SessionOwner, id: unknown): Promise<UploadRow> {
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) fail(404, 'unknown-upload', 'upload is unavailable')
    const row = this.uploads.read(id)
    if (!row || row.owner !== owner.shortId) fail(404, 'unknown-upload', 'upload is unavailable')
    await this.ctx.ourfairySessions.read(owner, row.sessionId)
    if (row.status === 2 || row.expiresAt <= Date.now()) {
      this.uploads.update(id, { status: 2 })
      await unlink(this._path(id)).catch(error => { if (errorCode(error) !== 'ENOENT') throw error })
      fail(410, 'expired', 'upload expired; select and upload again')
    }
    return row
  }

  /** Propose one upload: the client states the original bytes it will send. */
  async propose(owner: SessionOwner, { sessionId, name, mime, size, sha256 }: Record<string, unknown>): Promise<ExposedUpload> {
    await this.ctx.ourfairySessions.read(owner, sessionId)
    const safe = safeName(name)
    if (typeof mime !== 'string' || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)
      || !isSafeInteger(size) || size < 1 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) fail(400, 'invalid-request', 'provide MIME, positive original size and SHA-256')
    if (size > MAX_FILE_BYTES || (mime.startsWith('image/') && size > this.ctx.attachments.imageLimits.maxImageBytes)) fail(413, 'too-large', 'attachment exceeds the original byte limit')
    if (mime.startsWith('image/') && !this.ctx.attachments.imageLimits.mediaTypes.some(allowed => allowed === mime)) fail(400, 'image-unsupported', 'supported images are PNG, JPEG, WebP and GIF')
    const uploadId = randomBytes(16).toString('hex'), now = Date.now()
    await mkdir(this.root, { recursive: true })
    const handle = await open(this._path(uploadId), 'wx', 0o600)
    await handle.close()
    const row = { uploadId, owner: owner.shortId, sessionId: sessionId as string, name: safe, mime, size, sha256, status: 0, offset: 0,
      expiresAt: now + 24 * 60 * 60 * 1000, createdAt: now, updatedAt: now, original: null, image: null }
    try { this.uploads.insert(row) } catch (error) { await unlink(this._path(uploadId)); throw error }
    return this.expose(row)
  }

  /** Write one chunk of an upload's original bytes. */
  async chunk(owner: SessionOwner, uploadId: unknown, offset: number, data: Buffer): Promise<ExposedUpload> {
    // The lock only orders the calls that name one upload; `_owned` refuses an
    // id the store does not hold.
    return this._locked(uploadId as string, async () => {
      const row = await this._owned(owner, uploadId)
      if (!isSafeInteger(offset) || offset < 0 || data.length === 0) fail(400, 'invalid-request', 'provide a byte offset and nonempty chunk')
      if (data.length > MAX_CHUNK_BYTES || offset + data.length > row.size) fail(413, 'too-large', 'chunk exceeds the byte limit')
      if (row.status !== 0) fail(409, 'offset-conflict', 'upload is already complete')
      const handle = await open(this._path(row.uploadId), 'r+')
      try {
        // A lost HTTP ACK can retry its exact already committed chunk.
        if (offset < row.offset && offset + data.length <= row.offset) {
          const saved = Buffer.alloc(data.length)
          const { bytesRead } = await handle.read(saved, 0, saved.length, offset)
          if (bytesRead !== saved.length || !saved.equals(data)) fail(409, 'offset-conflict', 'retry bytes differ')
          return this.expose(row)
        }
        if (offset !== row.offset) fail(409, 'offset-conflict', 'resume at the acknowledged offset')
        let written = 0
        while (written < data.length) {
          const { bytesWritten } = await handle.write(data, written, data.length - written, offset + written)
          if (!bytesWritten) throw new Error('staging write made no progress')
          written += bytesWritten
        }
        await handle.sync()
        this.uploads.update(row.uploadId, { offset: offset + data.length })
        return this.expose({ ...row, offset: offset + data.length })
      } finally { await handle.close() }
    })
  }

  /** Complete one upload: the staged bytes become the stored original. */
  async complete(owner: SessionOwner, { uploadId }: Record<string, unknown>): Promise<ExposedUpload> {
    return this._locked(uploadId as string, async () => {
      const row = await this._owned(owner, uploadId)
      if (row.status === 1) return this.expose(row)
      if (row.offset !== row.size) fail(409, 'incomplete', 'upload all original bytes before completion')
      const bytes = await readFile(this._path(row.uploadId))
      if (bytes.length !== row.size || hash(bytes) !== row.sha256) fail(409, 'digest-mismatch', 'original bytes do not match the proposal')
      let image: ImageAttachmentRef | null = null
      if (row.mime.startsWith('image/')) {
        try {
          // The store admitted this mime as one of its image media types when
          // the upload was proposed; the native store validates it again here.
          image = await this.ctx.attachments.saveImage({ data: bytes, name: row.name, mediaType: row.mime as ImageMediaType })
        } catch { fail(400, 'image-invalid', 'image decoding or normalization failed') }
      }
      const original = await this.ctx.attachments.saveFileStream({ data: createReadStream(this._path(row.uploadId)), name: row.name })
      this.uploads.update(row.uploadId, { status: 1, original, image })
      await unlink(this._path(row.uploadId))
      return this.expose({ ...row, status: 1, original, image })
    })
  }

  /** The attachments one session's message may carry. */
  async inputs(owner: SessionOwner, sessionId: unknown, uploadIds: unknown): Promise<AttachmentInput[]> {
    const inputs: AttachmentInput[] = []
    for (const uploadId of uploadIdsOf(uploadIds)) {
      const row = await this._owned(owner, uploadId)
      const original = row.original as FileAttachmentRef | null
      if (row.sessionId !== sessionId || row.status !== 1 || !original) fail(404, 'unknown-upload', 'completed upload is unavailable in this session')
      const image = row.image as ImageAttachmentRef | null
      inputs.push({ uploadId, name: original.name, mime: row.mime, original, ...(image ? { image } : {}) })
    }
    if (inputs.reduce((total, input) => total + input.original.bytes, 0) > MAX_MESSAGE_BYTES) fail(413, 'too-large', 'message attachments exceed 64 MiB')
    if (inputs.some(item => item.image)) {
      const selection = this.ctx.agentDefaultModel.currentSelection()
      const info = await this.ctx.llm.resolveModelInfo(selection.provider, selection.model)
      if (!info.inputModalities?.includes('image')) fail(400, 'image-unsupported', 'the shared model cannot accept image input')
    }
    return inputs
  }

  /** Snapshot only an explicitly selected source through the sender's existing scope. */
  async prepareDeliveryFile(agent: Agent, selector: DeliverySelector, signal: AbortSignal | undefined): Promise<PreparedFile> {
    // The identity store names the owner of a live short id; the lookup is the
    // store's own, so a live owner is always named.
    const owner = this.ctx.identity.users.byShortId(this.ctx.ourfairySpaces.owner(agent.session)) as SessionOwner
    if (!selector.path) {
      const input = await this.download(owner, { sessionId: agent.session.id, messageId: selector.messageId, index: selector.index })
      // A saved reference must still have readable original bytes before it is shared.
      for await (const _ of this.ctx.attachments.readFileStream(input.original, signal)) { }
      return { name: input.name, mime: input.mime, original: input.original, ...(input.image ? { image: input.image } : {}) }
    }
    await this.refresh(agent.session)
    return this.ctx.ourfairySpaces.run(agent.session, async () => {
      const target = await this.ctx.fs.resolve(selector.path as string, { cwd: this.ctx.workingDirectory.get(agent.session), ...signal !== undefined ? { signal } : {} })
      const bytes = await this.ctx.fs.readBytes(target, signal, MAX_FILE_BYTES)
      const name = basename(target.displayPath)
      const mime = ({ '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.pdf': 'application/pdf',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as Record<string, string>)[extname(name).toLowerCase()] ?? 'application/octet-stream'
      const original = await this.ctx.attachments.saveFile({ data: bytes, name })
      const image = mime.startsWith('image/') ? await this.ctx.attachments.saveImage({ data: bytes, name, mediaType: mime as ImageMediaType }) : null
      return { name: original.name, mime, original, ...(image ? { image } : {}) }
    })
  }

  /** The event stream of one session. */
  async _events(sessionId: SessionId): Promise<readonly SessionEvent[]> {
    return (await readSessionEvents(this.ctx, sessionId)).events
  }


  /** The attachment one admitted message names. */
  async download(owner: SessionOwner, { sessionId, messageId, index }: Record<string, unknown>): Promise<AttachmentInput> {
    await this.ctx.ourfairySessions.read(owner, sessionId)
    if (!isSafeInteger(index) || index < 0) fail(400, 'invalid-request', 'provide an attachment index')
    // The owned-session read has just refused any session id the caller does
    // not own, so the id it accepted is the one the events are read for.
    const message = admittedMessages(await this._events(sessionId as SessionId)).find(message => message.id === messageId)
    const input = message && attachmentManifest(message)[index]
    if (!input) fail(404, 'unknown-input', 'message attachment is unavailable')
    return input
  }

  /** File handles are usable only when an admitted message in this session grants them. */
  async qualifiedFile(session: Session, path: unknown): Promise<AttachmentInput> {
    this.ctx.ourfairySpaces.owner(session)
    for (const message of admittedMessages(await this._events(session.id))) {
      for (const input of attachmentManifest(message)) {
        // The native store wrote this reference, so it names a stored file.
        const originalPath = this.ctx.attachments.fileHostPath(input.original) as string
        if (typeof path === 'string' && (path === originalPath || path === realpathSync(originalPath))) return input
      }
    }
    fail(404, 'unknown-input', 'qualified session attachment is unavailable')
  }

  /** The qualified file paths one session may read. */
  async refresh(session: Session): Promise<void> {
    this.ctx.ourfairySpaces.owner(session)
    const paths = new Set<string>()
    for (const message of admittedMessages(await this._events(session.id))) {
      for (const input of attachmentManifest(message)) {
        const originalPath = this.ctx.attachments.fileHostPath(input.original) as string
        paths.add(originalPath); paths.add(realpathSync(originalPath))
        if (input.image) {
          const imagePath = this.ctx.attachments.imageHostPath(input.image) as string
          paths.add(imagePath); paths.add(realpathSync(imagePath))
        }
      }
    }
    this._qualified.set(session, [...paths])
  }

  /** The read-only files one session's admitted messages grant. */
  readonlyFiles(session: OwnedSession): string[] {
    this.ctx.ourfairySpaces.owner(session)
    return this._qualified.get(session) ?? []
  }
}
