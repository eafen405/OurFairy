#!/usr/bin/env node
/**
 * Relative regression gates for the projection benchmark (#94).
 *
 * Reads one or more before-change JSON documents and one or more after-change
 * documents produced by `scripts/bench-projection.ts`, takes the per-cell
 * median across every recorded repetition, and fails (exit 1) when any gate in
 * {@link LIMITS} is crossed. This is the executable form of the #94 table: a
 * regression changes the benchmark JSON and this command goes red instead of
 * relying on a reader comparing prose.
 *
 * Usage:
 *   node scripts/bench-gate.ts --baseline <json...> --after <json...>
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The agreed relative limits. Every value is an after/before ratio. */
export const LIMITS = Object.freeze({
  /** 160-turn per-fragment CPU ÷ the same metric at 40 turns. */
  historySlope: 1.20,
  /** After-change 160-turn per-observer CPU ÷ baseline same cell. */
  cost160: 0.85,
  /** Total per-fragment CPU at two observers ÷ one observer (160 turns). */
  observerRatio: 1.80,
  /** After-change stream `/chat/read` p95 ÷ baseline same cell. */
  readP95: 1.50,
  /** After-change peak VmHWM ÷ baseline same cell. */
  memory: 1.25,
  /** After-change SSE payload ÷ baseline same cell. */
  payload: 1.05,
})

const CELLS = Object.freeze(['40/1', '40/2', '160/1', '160/2'])

/** One run's metric bundle, in the units the gate compares. */
type Metrics = {
  cpuTotal: number
  cpuPerObserver: number
  readP95: number
  memoryMb: number
  payloadMb: number
  /** The gate reads the bundle by metric name. */
  [metric: string]: number
}

/** One benchmark run, as the projection benchmark writes it. */
export type BenchmarkRun = {
  historyTurns: number
  observers: number
  stream: {
    cpuMsPerFragmentExcludingProbeApprox: number
    reads: { p95: number }
    frames: { bytesTotal: number }
  }
  memory: { peakVmHwmKb: number }
}

/** One benchmark document: the runs it recorded. */
export type BenchmarkDocument = {
  runs: BenchmarkRun[]
}

/** One gate's verdict for one cell. */
export type GateCheck = {
  gate: string
  cell: string
  actual: number
  limit: number
  pass: boolean
}

/** The gate's verdict over one pair of document sets. */
export type GateResult = {
  pass: boolean
  checks: GateCheck[]
  missing: string[]
  before: Record<string, Record<string, number | null>>
  changed: Record<string, Record<string, number | null>>
}

/** Parse the flags; every value belongs to the preceding flag. */
function parseArgs(argv: string[]): { baseline: string[]; after: string[] } | undefined {
  const groups: { baseline: string[]; after: string[] } = { baseline: [], after: [] }
  let current: 'baseline' | 'after' | undefined
  for (const arg of argv) {
    if (arg === '--baseline' || arg === '--after') {
      // The flag is one of the two the branch above accepted, so the slice
      // names the group the following files belong to.
      current = arg.slice(2) as 'baseline' | 'after'
      continue
    }
    if (arg === '--help') return undefined
    if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    if (current === undefined) throw new Error('name --baseline or --after before its files')
    groups[current].push(arg)
  }
  if (groups.baseline.length === 0 || groups.after.length === 0) {
    throw new Error('give at least one --baseline file and one --after file')
  }
  return groups
}

function readDocuments(paths: string[]): BenchmarkDocument[] {
  return paths.map(path => JSON.parse(readFileSync(resolve(path), 'utf8')) as BenchmarkDocument)
}

/** Nearest-rank median; even counts average the two middle values. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** One run's metric bundle, in the units the gate compares. */
function metricsOf(run: BenchmarkRun): Metrics {
  const observers = run.observers
  const cpuTotal = run.stream.cpuMsPerFragmentExcludingProbeApprox
  return {
    cpuTotal,
    cpuPerObserver: cpuTotal / observers,
    readP95: run.stream.reads.p95,
    memoryMb: run.memory.peakVmHwmKb / 1024,
    payloadMb: run.stream.frames.bytesTotal / 1e6,
  }
}

/** Median metrics per `history/observers` cell over every repetition in the documents. */
export function mediansOf(documents: BenchmarkDocument[]): Record<string, Record<string, number | null>> {
  const cells: Record<string, Metrics[]> = {}
  for (const document of documents) {
    for (const run of document.runs) {
      const key = `${run.historyTurns}/${run.observers}`
      ;(cells[key] ??= []).push(metricsOf(run))
    }
  }
  const result: Record<string, Record<string, number | null>> = {}
  for (const [key, runs] of Object.entries(cells)) {
    result[key] = Object.fromEntries(Object.keys(runs[0]!).map(metric => [metric, median(runs.map(run => run[metric]!))]))
  }
  return result
}

/**
 * Evaluate the six gates over parsed benchmark documents.
 * @param baseline - before-change JSON documents.
 * @param after - after-change JSON documents.
 * @returns the result.
 */
export function evaluateGates(baseline: BenchmarkDocument[], after: BenchmarkDocument[]): GateResult {
  const before = mediansOf(baseline)
  const changed = mediansOf(after)
  const missing = CELLS.filter(cell => before[cell] === undefined || changed[cell] === undefined)
  const checks: GateCheck[] = []
  const add = (gate: string, cell: string, actual: number, limit: number) => checks.push({ gate, cell, actual, limit,
    pass: Number.isFinite(actual) && actual <= limit })

  if (missing.length === 0) {
    // Every cell the gates read is present here, so the assertion holds.
    for (const observers of [1, 2]) {
      add('historySlope', `160/${observers}`, changed[`160/${observers}`]!.cpuPerObserver! / changed[`40/${observers}`]!.cpuPerObserver!,
        LIMITS.historySlope)
      add('cost160', `160/${observers}`, changed[`160/${observers}`]!.cpuPerObserver! / before[`160/${observers}`]!.cpuPerObserver!,
        LIMITS.cost160)
    }
    add('observerRatio', '160', changed['160/2']!.cpuTotal! / changed['160/1']!.cpuTotal!, LIMITS.observerRatio)
    for (const cell of CELLS) {
      add('readP95', cell, changed[cell]!.readP95! / before[cell]!.readP95!, LIMITS.readP95)
      add('memory', cell, changed[cell]!.memoryMb! / before[cell]!.memoryMb!, LIMITS.memory)
      add('payload', cell, changed[cell]!.payloadMb! / before[cell]!.payloadMb!, LIMITS.payload)
    }
  }
  return { pass: missing.length === 0 && checks.every(check => check.pass), checks, missing, before, changed }
}

/** Human-readable table for the command line. */
function render(result: GateResult): string {
  const lines = ['gate            cell    actual   limit   result']
  for (const check of result.checks) {
    lines.push(`${check.gate.padEnd(15)} ${check.cell.padEnd(6)} ${check.actual.toFixed(3).padStart(7)} ${String(check.limit).padStart(7)}   ${check.pass ? 'ok' : 'FAIL'}`)
  }
  if (result.missing.length > 0) lines.push(`missing cell(s): ${result.missing.join(', ')}`)
  return lines.join('\n')
}

function main(argv: string[]): void {
  let groups: { baseline: string[]; after: string[] } | undefined
  try {
    groups = parseArgs(argv)
  } catch (error) {
    // The caught value is whatever the flag parser threw; the report only
    // reads its `message`, exactly as the pre-migration code did.
    process.stderr.write(`bench-gate: ${(error as Error).message}\n`)
    process.exit(2)
  }
  if (groups === undefined) {
    process.stderr.write('usage: node scripts/bench-gate.ts --baseline <json...> --after <json...>\n')
    return
  }
  const result = evaluateGates(readDocuments(groups.baseline), readDocuments(groups.after))
  process.stdout.write(`${render(result)}\n${result.pass ? 'bench-gate: all gates pass' : 'bench-gate: regression'}\n`)
  if (!result.pass) process.exitCode = 1
}

if (import.meta.main) main(process.argv.slice(2))
