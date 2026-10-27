/**
 * Bounded PDF tools over existing admitted attachment qualification, with no
 * derived store.
 *
 * @module @ourfairy/dsh-attachments/src/pdf
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildBwrapArgv } from '@ourfairy/dsh-spaces/bwrap'
import { mkdtemp, rm, chmod, readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { AttachmentService } from './service.js'
// The dsh context's own seams: the native attachment store, the model catalog
// and the subprocess runtime the worker runs in.
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subprocess'

/** The package root of the built module: `dist/`. */
const root = dirname(fileURLToPath(import.meta.url))
const wheel = join(root, '../pdf/pypdf-6.21.0-py3-none-any.whl')
// The worker is a non-TS asset, so it lives in the package's own `assets/`
// directory and is resolved one level above the built `dist/`.
const worker = join(root, '../assets/pdf-worker.py')

/** The mode one PDF tool call runs in. */
type PdfMode = 'info' | 'render' | 'pages'

/** The arguments the PDF tools take. */
interface PdfToolArgs {
  readonly file_path: string
  readonly pages?: readonly number[]
}

/** The request the worker itself receives. */
interface WorkerRequest {
  readonly mode: PdfMode
  readonly pages?: readonly number[]
}

/** The one page the worker read or rendered. */
type WorkerPage = {
  page: number
  status: number
  text?: string
  truncated?: boolean
  needsImage?: boolean
  error?: string
  warning?: string
  image?: ImageAttachmentRef
}

/** The worker's answer, as the product reads it. */
type WorkerResult = {
  status: number
  error?: string
  pageCount?: number
  pages?: WorkerPage[]
  scope?: string
  file_path?: string
  name?: string
}

/** The canonical value one PDF tool call returns. */
type PdfToolValue = Record<string, JsonValue>

const failure = (error: string): WorkerResult => ({ status: 3, error }) // 1 成功，2 部分页失败，3 失败。

/**
 * Whether one value is a safe integer.
 *
 * The check is `Number.isSafeInteger` itself; it is written as a type guard so
 * the value that passes it can be used as a number.
 */
const isSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value)

/**
 * The worker's answer, read back from its JSON output.
 *
 * The worker is the product's own process and its answer is JSON, so it is read
 * back here as the shape the worker writes.
 */
function workerResult(text: string): WorkerResult {
  const parsed: unknown = JSON.parse(text)
  return parsed as WorkerResult
}

/**
 * The canonical value one PDF tool call returns.
 *
 * The worker's answer is JSON, but the render step attaches a native image
 * reference to a page, and that reference is not a JSON value in the type
 * system. The tool's output schema is open, so the product's own shape is
 * carried through it.
 */
function canonical(result: WorkerResult): PdfToolValue {
  return result as unknown as PdfToolValue
}

async function runWorker(ctx: Context, directory: string, request: WorkerRequest, callerSignal: AbortSignal | undefined): Promise<WorkerResult> {
  const argv = buildBwrapArgv('bwrap', { workspaceRoot: directory, network: false, readRoots: [worker, wheel, ...(request.mode === 'render' ? ['/etc/fonts'] : [])], writable: request.mode === 'render' },
    ['/usr/bin/prlimit', '--as=536870912', '--cpu=5', request.mode === 'render' ? '--fsize=8388608' : '--fsize=1048576', '--nofile=64', '--',
      '/usr/bin/python3', '-B', worker, wheel, join(directory, 'input.pdf'), JSON.stringify(request)])
  callerSignal?.throwIfAborted()
  // The wall deadline is the product's budget; the service owns killing the range.
  const deadline = AbortSignal.timeout(10000)
  // `stderr` is a small bounded collector that nobody reads: the seam has no
  // discard mode, so 'ignore' would be an unbounded collector.
  const handle = ctx.subprocess.spawn({ argv, cwd: directory, graceMs: 1000, stdio: { stdin: 'ignore', stderr: { maxBytes: 4096 },
    stdout: { maxBytes: 256 * 1024 } }, signal: callerSignal === undefined ? deadline : AbortSignal.any([callerSignal, deadline]) })
  try {
    const outcome = await handle.done
    // The spec asked for a collected stdout, so the reader is there.
    const output = (handle.collected.stdout as SubprocessOutputReader).readFrom(0)
    // bwrap re-raises a killed payload as 128+signal and reports no signal of its
    // own: prlimit's SIGXCPU is 152, the SIGKILL escalation and an OOM kill are 137.
    // The service's own termination (deadline or caller stop) arrives as SIGTERM.
    const terminated = deadline.aborted || callerSignal?.aborted === true
      || outcome.signal === 'SIGTERM' || outcome.signal === 'SIGKILL' || outcome.signal === 'SIGXCPU'
      || outcome.exitCode === 137 || outcome.exitCode === 152
    if (terminated || output.lossy) return failure('resource-limit')
    if (outcome.exitCode !== 0) return failure('worker-unavailable')
    try { return workerResult(output.text) } catch { return failure('worker-unavailable') }
  } catch (error) {
    if (deadline.aborted || callerSignal?.aborted === true) return failure('resource-limit')
    throw error
  } finally {
    await handle.waitForExit().catch(() => {})
  }
}

/** The three PDF tools the product registers, and the mode each one runs. */
const TOOLS = [
  ['pdf_info', 'info', 'Get the page count and a bounded first-page text sample from a qualified PDF file handle. Only the sample page is read; do not claim to understand unread pages.'],
  ['pdf_render_pages', 'render', 'Render 1–3 selected 1-based pages of a qualified PDF and return page images through the current official vision route. Use for scans, charts and layout only as needed; cite page numbers.'],
  ['pdf_read_pages', 'pages', 'Read 1–5 selected 1-based PDF pages from a qualified file handle. Returns page numbers, bounded text, truncation and empty-page/image-reading hints. Original downloads are unchanged.'],
] as const

/**
 * Register the PDF tools on every agent.
 *
 * @param ctx - the context the tools and the worker run in.
 * @param service - the attachment service that qualifies the files.
 */
export function installPdf(ctx: Context, service: AttachmentService): void {
  let active = 0
  const execute = async (agent: Agent, args: PdfToolArgs, mode: PdfMode, signal: AbortSignal | undefined): Promise<PdfToolValue> => {
    const input = await service.qualifiedFile(agent.session, args.file_path)
    if (input.mime !== 'application/pdf') return canonical(failure('not-pdf'))
    if (mode !== 'info' && (!Array.isArray(args.pages) || args.pages.length < 1 || args.pages.length > (mode === 'render' ? 3 : 5)
      || args.pages.some(page => !isSafeInteger(page) || page < 1) || new Set(args.pages).size !== args.pages.length)) return canonical(failure('invalid-pages'))
    if (mode === 'render') {
      const routed = agent.session.requestHeader()?.config
      const model = await ctx.llm.resolveModelInfo(routed?.provider ?? agent.options.provider as string, routed?.model ?? agent.options.model as string, signal)
      if (!model.inputModalities?.includes('image')) return canonical(failure('image-unsupported'))
    }
    if (active >= 2) return canonical(failure('busy'))
    active++
    let directory: string | undefined
    try {
      directory = await mkdtemp(join(tmpdir(), 'ourfairy-pdf-'))
      await chmod(directory, 0o700)
      await pipeline(ctx.attachments.readFileStream(input.original, signal), createWriteStream(join(directory, 'input.pdf'), { mode: 0o600 }), { signal })
      const result = await runWorker(ctx, directory, { mode, ...(mode !== 'info' ? { pages: args.pages } : {}) }, signal)
      if (mode === 'render' && result.pages) {
        result.file_path = args.file_path
        result.name = input.name
        for (const page of result.pages) {
          if (page.status === 3) continue
          page.image = await ctx.attachments.saveImage({ data: await readFile(join(directory, `page-${page.page}.png`)),
            mediaType: 'image/png', name: `${input.name}-page-${page.page}.png` })
        }
        result.scope = 'Only returned pages were rendered. Cite their page numbers; visual reading may not perfectly recover complex tables.'
      }
      return canonical(result)
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true })
      active--
    }
  }
  const register = (agent: Agent): undefined => {
    // The memory maintenance child (preset `ourfairy:memory-maintenance`) may
    // use long-term memory tools only; a scope's own registration cannot be
    // hidden by dsh's tool restriction, so every product row skips this preset.
    if (agent.session.header?.agentPreset === 'ourfairy:memory-maintenance') return undefined
    for (const [name, mode, description] of TOOLS) agent.ctx.tools.register(defineTool({ name, description,
      parameters: { file_path: { type: 'string', required: true }, ...(mode !== 'info' ? { pages: { type: 'array', required: true, items: { type: 'integer' } } } : {}) },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => {
        const pages = (value.pages ?? []) as unknown as WorkerPage[]
        return [{ type: 'text', text: JSON.stringify(value) },
          ...pages.filter((page): page is WorkerPage & { image: ImageAttachmentRef } => Boolean(page.image))
            .map(page => ({ type: 'image' as const, attachment: page.image }))] } },
      // The tool's schema is the authority for the arguments it takes; the
      // pages property is present only for the tools that declare it.
      execute: (args, exec) => execute(exec.agent as Agent, args as PdfToolArgs, mode, exec.signal),
    }))
    return undefined
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}
