#!/usr/bin/env node
/**
 * The type-drift instance the ticket's acceptance asks for: drift the PINNED
 * dsh's types and show that the product's `tsc` fails and names the symbol.
 *
 * The pinned dsh checkout is READ-ONLY here: the experiment copies the jobs
 * package's type tree into a scratch directory, mutates the COPY, and points
 * a scratch project's `paths` at it. Nothing outside `work/tmp/` is touched.
 *
 * Four drifts are tried, in order:
 *
 * 1. `JobStatus` gains a member. The product reads a job's status through
 *    `taskStatusOf(status: string)`, so the compiler does NOT see the narrower
 *    union: the drift is caught at RUN time by the table in
 *    `backend/chat/src/units.ts` and by `tests/native-job-status.test.mjs`.
 * 2. `kill()`'s return shape gains a member. Same reason: `stopOutcomeOf`
 *    takes a `string` and refuses an unknown outcome at RUN time.
 * 3. `JobOutputRead.next` changes type. The product passes it through into an
 *    inferred wire object, so the compiler still accepts it.
 * 4. `JobId`'s parameter changes type, and then the `JobId` export itself
 *    disappears from the package root. The product imports the symbol
 *    directly, so the compiler fails AND names it.
 *
 * Usage:
 *   node work/implementation/evidence/211-ts-scripts/type-drift.mjs
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(import.meta.dirname, '../../../..')
const dshRoot = process.env.OURFAIRY_DSH_DIR ?? '/home/eafen405/projects/deepseek-harness'
const scratch = join(repoRoot, 'work', 'tmp', 'drift-211')
const types = join(scratch, 'jobs-types')
const source = join(dshRoot, 'packages', 'jobs', 'jobs', 'lib', 'types')

/**
 * Run the compiler against the mutated copy and report what it said.
 * @param {string} label - the drift's name.
 * @returns {string} the compiler's output.
 */
function compile(label) {
  const project = join(scratch, 'tsconfig.json')
  writeFileSync(project, `${JSON.stringify({
    extends: '../../../tsconfig.base.json',
    compilerOptions: {
      noEmit: true,
      allowImportingTsExtensions: true,
      erasableSyntaxOnly: true,
      paths: { '@deepseek-ai/dsh-jobs': ['./jobs-types/index.d.ts'] },
    },
    include: ['../../../backend/chat/src/**/*.ts'],
  }, undefined, 2)}\n`)
  let output = ''
  try {
    execFileSync(process.execPath, [join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit', '-p', project, '--pretty', 'false'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  const lines = output.split('\n').filter(line => line.trim() !== '')
  console.log(`--- ${label}`)
  console.log(lines.length === 0 ? '    tsc: no error' : lines.map(line => `    ${line}`).join('\n'))
  return output
}

/**
 * Replace one line of one file in the copy.
 * @param {string} file - the file's name inside the copied type tree.
 * @param {string} from - the text to replace.
 * @param {string} to - the replacement.
 */
function mutate(file, from, to) {
  const path = join(types, file)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(from)) throw new Error(`${file} does not carry the text the drift needs: ${from}`)
  writeFileSync(path, text.replace(from, to))
}

/**
 * Put the copy back the way the pinned dsh has it.
 */
function restore() {
  rmSync(types, { recursive: true, force: true })
  cpSync(source, types, { recursive: true })
}

mkdirSync(scratch, { recursive: true })
restore()
compile('0. the pinned dsh, unmodified')

mutate('view.d.ts',
  "export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';",
  "export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed' | 'cancelled';")
compile("1. JobStatus gains a member")

mutate('index.d.ts',
  "    abstract kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished';",
  "    abstract kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished' | 'cancelled';")
compile("2. kill()'s return shape gains a member")

mutate('types.d.ts',
  "    next: number;\n    /** True when `from` fell below the oldest retained byte, so bytes are missing before `chunks`. */",
  "    next: string;\n    /** True when `from` fell below the oldest retained byte, so bytes are missing before `chunks`. */")
compile('3. JobOutputRead.next changes type')

mutate('brand.d.ts',
  'export declare function JobId(id: string): JobId;',
  'export declare function JobId(id: number): JobId;')
compile("4. JobId's parameter changes type")

mutate('index.d.ts',
  "export { JobGeneration, JobId } from './types.ts';",
  "export { JobGeneration } from './types.ts';")
compile('5. the JobId export disappears from the package root')

rmSync(scratch, { recursive: true, force: true })
