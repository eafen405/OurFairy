/**
 * A cancelled PDF worker still answers with the numeric failure and leaves nothing behind.
 *
 * The PDF module builds the tool, not the composition: this test loads the shipped
 * module into the real local subprocess provider, feeds it an attachment that keeps
 * the parser busy, and cancels the tool call while that worker is alive. The worker is
 * located through its own temporary directory, so the assertions are about the process
 * this call started — the same call must report status 3, remove its directory, and
 * leave no process or shared network namespace behind.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire, registerHooks } from 'node:module'
import { deflateSync } from 'node:zlib'
import { readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshDir = combo.repos.dsh.localPath
const dshRequire = createRequire(join(dshDir, 'packages/subprocess/subprocess-local/package.json'))

// The product module's dsh peers resolve inside the installed profile, not in
// this worktree; the two bare specifiers are the whole surface it needs.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: pathToFileURL(join(dshDir, 'packages/core/tools/lib/index.js')).href, shortCircuit: true }
    if (specifier === '@ourfairy/dsh-spaces/bwrap') return { url: pathToFileURL(join(repoRoot, 'backend/spaces/src/bwrap.mjs')).href, shortCircuit: true }
    return next(specifier, context)
  },
})
test.after(() => hooks.deregister())

async function load() {
  const { Context } = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/cordis')).href)
  const { default: LocalSubprocess } = await import(pathToFileURL(join(dshDir, 'packages/subprocess/subprocess-local/lib/index.js')).href)
  const { installPdf } = await import(pathToFileURL(join(repoRoot, 'backend/attachments/src/pdf.mjs')).href)
  const ctx = new Context()
  ctx.plugin(LocalSubprocess)
  for (let tick = 0; tick < 100 && ctx.subprocess === undefined; tick++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(ctx.subprocess !== undefined, 'the local subprocess provider must register ctx.subprocess')
  return { ctx, installPdf }
}

/** A document whose text extraction costs seconds: the worker stays alive long enough to cancel. */
function costlyPdf() {
  const content = Buffer.from('BT /F1 12 Tf (' + 'X'.repeat(4 * 1024 * 1024) + ') Tj ET\n')
  const stream = deflateSync(content, { level: 9 }), chunks = [Buffer.from('%PDF-1.7\n')], offsets = [0]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')]),
  ]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(chunks).length)
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n'))
  }
  const xref = Buffer.concat(chunks).length
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return Buffer.concat(chunks)
}

/** Every process whose command line names `needle`, with its own network namespace. */
function processesMentioning(needle, startsWith) {
  const found = []
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/u.test(entry)) continue
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      if (!cmdline.includes(needle) || (startsWith !== undefined && !cmdline.startsWith(startsWith))) continue
      found.push({ pid: Number(entry), netns: readlinkSync(`/proc/${entry}/ns/net`) })
    } catch {
      // A process may exit between listing and reading; that is not a match.
    }
  }
  return found
}

async function waitFor(predicate, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const value = predicate()
    if (value?.length) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return undefined
}

test('a cancelled PDF worker reports the numeric failure, removes its directory, and leaves no process or shared network', async () => {
  const { ctx, installPdf } = await load()
  const pdf = costlyPdf()
  const before = new Set(readdirSync('/tmp').filter(name => name.startsWith('ourfairy-pdf-')))
  let registered
  const agent = { session: {}, options: {} }
  installPdf({ subprocess: ctx.subprocess, llm: {}, on() {}, agents: { list: () => [{ ...agent, ctx: { tools: { register: definition => { registered = definition } } } }] },
    attachments: { readFileStream: async function* () { yield pdf } } }, { qualifiedFile: async () => ({ mime: 'application/pdf', name: 'costly.pdf', original: {} }) })
  assert.equal(registered?.name, 'pdf_read_pages')

  const controller = new AbortController()
  const started = Date.now()
  const running = registered.execute({ file_path: 'qualified.pdf', pages: [1] }, { agent, signal: controller.signal })
  const directory = await waitFor(() => readdirSync('/tmp').filter(name => name.startsWith('ourfairy-pdf-') && !before.has(name)))
  try {
    assert.ok(directory?.length, 'the PDF call must start a worker in its own temporary directory')
    const path = join('/tmp', directory[0])
    const workers = await waitFor(() => processesMentioning(path, '/usr/bin/python3'))
    assert.ok(workers?.length, `the running parser must be observable under ${path}`)
    // The parser is untrusted input handling: its own network namespace, not the host's.
    assert.ok(workers.every(worker => worker.netns !== readlinkSync('/proc/self/ns/net')),
      `the PDF parser must not share the host network: ${JSON.stringify(workers)}`)
    controller.abort(new Error('user stopped the reply'))
    const result = await running
    assert.equal(result.status, 3, `a cancelled worker is a numeric failure: ${JSON.stringify(result)}`)
    assert.ok(Date.now() - started < 8000, 'cancellation must not wait for the worker deadline')
    assert.deepEqual(processesMentioning(path), [], 'the cancelled worker must not survive its call')
  } finally {
    controller.abort()
    await running.catch(() => {})
    assert.ok(!readdirSync('/tmp').some(name => name.startsWith('ourfairy-pdf-') && !before.has(name)),
      'the temporary directory must be removed after the call')
    await ctx.dispose?.()
  }
})
