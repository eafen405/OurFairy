/** Upload lifecycle is business state; admitted native messages alone grant content access. */
import { Service } from '@deepseek-ai/cordis'
import { SessionScopeError } from '@ourfairy/dsh-sessions'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { createReadStream, realpathSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024
export const MAX_ATTACHMENTS = 8
export const MAX_CHUNK_BYTES = 256 * 1024
export class AttachmentError extends SessionScopeError {}
const fail = (status, code, message) => { throw new AttachmentError(status, `attachments/${code}`, message) }
const attachmentManifest = message => message.source?.attachments ?? []
function admittedMessages(events) {
  return events.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted
    : event.type === 'user/message' ? [event.data] : event.type === 'delivery/message' ? [event.data.message] : [])
}
export function uploadIdsOf(value = []) {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS || value.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))
    || new Set(value).size !== value.length) fail(400, 'invalid-request', 'provide at most 8 distinct upload IDs')
  return value
}
function safeName(name) {
  if (typeof name !== 'string' || name.length > 1024) fail(400, 'invalid-request', 'provide a display filename')
  const leaf = name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim().replace(/[. ]+$/u, '').slice(0, 128)
  return !leaf || leaf === '.' || leaf === '..' ? 'file' : leaf
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export class AttachmentService extends Service {
  _queues = new Map()
  _qualified = new WeakMap()
  constructor(ctx, { root }) { super(ctx, 'ourfairyAttachments'); this.root = root }
  caller(request) {
    const owner = this.ctx.ourfairySessions.authenticate(request)
    if (!owner) fail(401, 'unauthorized', 'present a live session credential')
    return owner
  }
  get store() { return this.ctx.identity.store }
  _path(id) { return join(this.root, id) }
  async _locked(id, action) {
    const before = this._queues.get(id) ?? Promise.resolve(), started = before.then(action, action)
    const tail = started.then(() => {}, () => {}); this._queues.set(id, tail)
    try { return await started } finally { if (this._queues.get(id) === tail) this._queues.delete(id) }
  }
  expose(row) {
    return { uploadId: row.uploadId, name: row.name, mime: row.mime, size: row.size, sha256: row.sha256,
      status: row.status, offset: row.offset, expiresAt: row.expiresAt }
  }
  async _owned(owner, id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) fail(404, 'unknown-upload', 'upload is unavailable')
    const row = this.store.readUpload(id)
    if (!row || row.owner !== owner.shortId) fail(404, 'unknown-upload', 'upload is unavailable')
    await this.ctx.ourfairySessions.read(owner, row.sessionId)
    if (row.status === 2 || row.expiresAt <= Date.now()) {
      this.store.updateUpload(id, { status: 2 })
      await unlink(this._path(id)).catch(error => { if (error.code !== 'ENOENT') throw error })
      fail(410, 'expired', 'upload expired; select and upload again')
    }
    return row
  }
  async propose(owner, { sessionId, name, mime, size, sha256 }) {
    await this.ctx.ourfairySessions.read(owner, sessionId)
    name = safeName(name)
    if (typeof mime !== 'string' || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mime)
      || !Number.isSafeInteger(size) || size < 1 || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) fail(400, 'invalid-request', 'provide MIME, positive original size and SHA-256')
    if (size > MAX_FILE_BYTES || (mime.startsWith('image/') && size > this.ctx.attachments.imageLimits.maxImageBytes)) fail(413, 'too-large', 'attachment exceeds the original byte limit')
    if (mime.startsWith('image/') && !this.ctx.attachments.imageLimits.mediaTypes.includes(mime)) fail(400, 'image-unsupported', 'supported images are PNG, JPEG, WebP and GIF')
    const uploadId = randomBytes(16).toString('hex'), now = Date.now()
    await mkdir(this.root, { recursive: true })
    const handle = await open(this._path(uploadId), 'wx', 0o600)
    await handle.close()
    const row = { uploadId, owner: owner.shortId, sessionId, name, mime, size, sha256, status: 0, offset: 0,
      expiresAt: now + 24 * 60 * 60 * 1000, createdAt: now, updatedAt: now, original: null, image: null }
    try { this.store.insertUpload(row) } catch (error) { await unlink(this._path(uploadId)); throw error }
    return this.expose(row)
  }
  async chunk(owner, uploadId, offset, data) {
    return this._locked(uploadId, async () => {
      const row = await this._owned(owner, uploadId)
      if (!Number.isSafeInteger(offset) || offset < 0 || data.length === 0) fail(400, 'invalid-request', 'provide a byte offset and nonempty chunk')
      if (data.length > MAX_CHUNK_BYTES || offset + data.length > row.size) fail(413, 'too-large', 'chunk exceeds the byte limit')
      if (row.status !== 0) fail(409, 'offset-conflict', 'upload is already complete')
      const handle = await open(this._path(uploadId), 'r+')
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
        this.store.updateUpload(uploadId, { offset: offset + data.length })
        return this.expose({ ...row, offset: offset + data.length })
      } finally { await handle.close() }
    })
  }
  async complete(owner, { uploadId }) {
    return this._locked(uploadId, async () => {
      const row = await this._owned(owner, uploadId)
      if (row.status === 1) return this.expose(row)
      if (row.offset !== row.size) fail(409, 'incomplete', 'upload all original bytes before completion')
      const bytes = await readFile(this._path(uploadId))
      if (bytes.length !== row.size || hash(bytes) !== row.sha256) fail(409, 'digest-mismatch', 'original bytes do not match the proposal')
      let image = null
      if (row.mime.startsWith('image/')) {
        try { image = await this.ctx.attachments.saveImage({ data: bytes, name: row.name, mediaType: row.mime }) }
        catch { fail(400, 'image-invalid', 'image decoding or normalization failed') }
      }
      const original = await this.ctx.attachments.saveFileStream({ data: createReadStream(this._path(uploadId)), name: row.name })
      this.store.updateUpload(uploadId, { status: 1, original, image })
      await unlink(this._path(uploadId))
      return this.expose({ ...row, status: 1, original, image })
    })
  }
  async inputs(owner, sessionId, uploadIds) {
    const inputs = []
    for (const uploadId of uploadIdsOf(uploadIds)) {
      const row = await this._owned(owner, uploadId)
      if (row.sessionId !== sessionId || row.status !== 1 || !row.original) fail(404, 'unknown-upload', 'completed upload is unavailable in this session')
      inputs.push({ uploadId, name: row.original.name, mime: row.mime, original: row.original, ...(row.image ? { image: row.image } : {}) })
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
  async prepareDeliveryFile(agent, selector, signal) {
    const owner = this.ctx.identity.store.userByShortId(this.ctx.ourfairySpaces.owner(agent.session))
    if (!selector.path) {
      const input = await this.download(owner, { sessionId: agent.session.id, messageId: selector.messageId, index: selector.index })
      // A saved reference must still have readable original bytes before it is shared.
      for await (const _ of this.ctx.attachments.readFileStream(input.original, signal)) {}
      return { name: input.name, mime: input.mime, original: input.original, ...(input.image ? { image: input.image } : {}) }
    }
    await this.refresh(agent.session)
    return this.ctx.ourfairySpaces.run(agent.session, async () => {
      const target = await this.ctx.fs.resolve(selector.path, { cwd: this.ctx.workingDirectory.get(agent.session), signal })
      const bytes = await this.ctx.fs.readBytes(target, signal, MAX_FILE_BYTES)
      const name = basename(target.displayPath)
      const mime = ({ '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.pdf': 'application/pdf',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })[extname(name).toLowerCase()] ?? 'application/octet-stream'
      const original = await this.ctx.attachments.saveFile({ data: bytes, name })
      const image = mime.startsWith('image/') ? await this.ctx.attachments.saveImage({ data: bytes, name, mediaType: mime }) : null
      return { name: original.name, mime, original, ...(image ? { image } : {}) }
    })
  }
  async _events(sessionId) {
    return (await readSessionEvents(this.ctx, sessionId)).events
  }
  async download(owner, { sessionId, messageId, index }) {
    await this.ctx.ourfairySessions.read(owner, sessionId)
    if (!Number.isSafeInteger(index) || index < 0) fail(400, 'invalid-request', 'provide an attachment index')
    const message = admittedMessages(await this._events(sessionId)).find(message => message.id === messageId)
    const input = message && attachmentManifest(message)[index]
    if (!input) fail(404, 'unknown-input', 'message attachment is unavailable')
    return input
  }
  /** File handles are usable only when an admitted message in this session grants them. */
  async qualifiedFile(session, path) {
    this.ctx.ourfairySpaces.owner(session)
    for (const message of admittedMessages(await this._events(session.id))) {
      for (const input of attachmentManifest(message)) {
        const originalPath = this.ctx.attachments.fileHostPath(input.original)
        if (typeof path === 'string' && (path === originalPath || path === realpathSync(originalPath))) return input
      }
    }
    fail(404, 'unknown-input', 'qualified session attachment is unavailable')
  }
  async refresh(session) {
    this.ctx.ourfairySpaces.owner(session)
    const paths = new Set()
    for (const message of admittedMessages(await this._events(session.id))) {
      for (const input of attachmentManifest(message)) {
        const originalPath = this.ctx.attachments.fileHostPath(input.original)
        paths.add(originalPath); paths.add(realpathSync(originalPath))
        if (input.image) {
          const imagePath = this.ctx.attachments.imageHostPath(input.image)
          paths.add(imagePath); paths.add(realpathSync(imagePath))
        }
      }
    }
    this._qualified.set(session, [...paths])
  }
  readonlyFiles(session) { this.ctx.ourfairySpaces.owner(session); return this._qualified.get(session) ?? [] }
}
