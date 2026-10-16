#!/usr/bin/env node
/** Official-cloud handoff: authenticated product upload → PDF tool turn → original download. */
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'

const base = process.env.OURFAIRY_URL ?? 'http://127.0.0.1:3080'
const token = process.env.OURFAIRY_TOKEN
const sample = process.argv[2] ?? 'scan'
if (!token || !['scan', 'mixed', 'chart'].includes(sample)) throw new Error('Set OURFAIRY_TOKEN and select scan, mixed or chart')
async function request(path, body, headers = {}) {
  const response = await fetch(new URL(path, base), { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers,
  }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response
}
const bytes = await readFile(new URL(`../tests/fixtures/pdf/${sample}.pdf`, import.meta.url))
const { session } = await (await request('/sessions/create', {})).json()
const { upload } = await (await request('/attachments/propose', { sessionId: session.id, name: `${sample}.pdf`, mime: 'application/pdf',
  size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })).json()
for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
  await request('/attachments/chunk', bytes.subarray(offset, offset + 256 * 1024), {
    'content-type': 'application/octet-stream', 'x-upload-id': upload.uploadId, 'x-upload-offset': String(offset),
  })
}
await request('/attachments/complete', { uploadId: upload.uploadId })
const page = sample === 'mixed' ? 2 : 1
const requestId = `pdf-flash-${randomUUID()}`
await request('/chat/send', { sessionId: session.id, requestId, uploadIds: [upload.uploadId],
  text: `Inspect only page ${page} of the attached PDF. First use pdf_info, then use pdf_render_pages with pages:[${page}]. Describe the three bars' colors and relative heights, cite the page number, and include any visible title/caption/values. Do not infer other pages.` })
const deadline = Date.now() + 120000
while (Date.now() < deadline) {
  const { projection } = await (await request('/chat/read', { sessionId: session.id })).json()
  if (projection.error) throw new Error(JSON.stringify(projection.error))
  if (projection.replyStatus === 0 && projection.messages.some(message => message.role === 2)) {
    const input = projection.messages.find(message => message.requestId === requestId)
    const original = Buffer.from(await (await request('/attachments/download', { sessionId: session.id, messageId: input.messageId, index: 0 })).arrayBuffer())
    if (!original.equals(bytes)) throw new Error('Downloaded original differs from uploaded bytes')
    console.log(JSON.stringify({ sessionId: session.id, requestId, sample, page, originalUnchanged: true, projection }, null, 2))
    process.exit(0)
  }
  await new Promise(resolve => setTimeout(resolve, 500))
}
throw new Error(`Turn did not finish within 120 seconds; inspect session ${session.id}`)
