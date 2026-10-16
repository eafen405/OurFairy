/** Two PDF tools over existing admitted attachment qualification, with no derived store. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildBwrapArgv } from '@ourfairy/dsh-spaces/bwrap'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, chmod } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const wheel = join(root, '../pdf/pypdf-6.21.0-py3-none-any.whl')
const worker = join(root, 'pdf-worker.py')
const failure = error => ({ status: 3, error }) // 1 成功，2 部分页失败，3 失败。

function runWorker(directory, request, signal) {
  const argv = buildBwrapArgv('bwrap', { workspaceRoot: directory, readRoots: [worker, wheel], writable: false },
    ['/usr/bin/prlimit', '--as=536870912', '--cpu=5', '--fsize=1048576', '--nofile=64', '--',
      '/usr/bin/python3', '-B', worker, wheel, join(directory, 'input.pdf'), JSON.stringify(request)])
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], signal })
    let output = '', bytes = 0, limited = false
    const timer = setTimeout(() => { limited = true; child.kill('SIGKILL') }, 10000)
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 256 * 1024) { limited = true; child.kill('SIGKILL') }
      else output += chunk
    })
    // Drain parser diagnostics without exposing host paths or unbounded logs to the model.
    child.stderr.resume()
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', (code, killed) => {
      clearTimeout(timer)
      if (limited || killed === 'SIGXCPU' || killed === 'SIGKILL') return resolve(failure('resource-limit'))
      if (code !== 0) return resolve(failure('worker-unavailable'))
      try { resolve(JSON.parse(output)) } catch { resolve(failure('worker-unavailable')) }
    })
  })
}

export function installPdf(ctx, service) {
  let active = 0
  const execute = async (agent, args, mode, signal) => {
    const input = await service.qualifiedFile(agent.session, args.file_path)
    if (input.mime !== 'application/pdf') return failure('not-pdf')
    if (mode === 'pages' && (!Array.isArray(args.pages) || args.pages.length < 1 || args.pages.length > 5
      || args.pages.some(page => !Number.isSafeInteger(page) || page < 1) || new Set(args.pages).size !== args.pages.length)) return failure('invalid-pages')
    if (active >= 2) return failure('busy')
    active++
    let directory
    try {
      directory = await mkdtemp(join(tmpdir(), 'ourfairy-pdf-'))
      await chmod(directory, 0o700)
      await pipeline(ctx.attachments.readFileStream(input.original, signal), createWriteStream(join(directory, 'input.pdf'), { mode: 0o600 }), { signal })
      return await runWorker(directory, { mode, ...(mode === 'pages' ? { pages: args.pages } : {}) }, signal)
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true })
      active--
    }
  }
  const register = agent => {
    for (const [name, mode, description] of [
      ['pdf_info', 'info', 'Get the page count and a bounded first-page text sample from a qualified PDF file handle. Only the sample page is read; do not claim to understand unread pages.'],
      ['pdf_read_pages', 'pages', 'Read 1–5 selected 1-based PDF pages from a qualified file handle. Returns page numbers, bounded text, truncation and empty-page/image-reading hints. Original downloads are unchanged.'],
    ]) agent.ctx.tools.register(defineTool({ name, description,
      parameters: { file_path: { type: 'string', required: true }, ...(mode === 'pages' ? { pages: { type: 'array', required: true, items: { type: 'integer' } } } : {}) },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, exec) => execute(exec.agent, args, mode, exec.signal),
    }))
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}
