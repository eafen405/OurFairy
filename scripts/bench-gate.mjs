#!/usr/bin/env node
/**
 * Relative regression gates for the projection benchmark (#94).
 *
 * Reads one or more before-change JSON documents and one or more after-change
 * documents produced by `scripts/bench-projection.mjs`, takes the per-cell
 * median across every recorded repetition, and fails (exit 1) when any gate in
 * {@link LIMITS} is crossed. This is the executable form of the #94 table: a
 * regression changes the benchmark JSON and this command goes red instead of
 * relying on a reader comparing prose.
 *
 * Usage:
 *   node scripts/bench-gate.mjs --baseline <json...> --after <json...>
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

/** Parse the flags; every value belongs to the preceding flag. */
function parseArgs(argv) {
  const groups = { baseline: [], after: [] }
  let current
  for (const arg of argv) {
    if (arg === '--baseline' || arg === '--after') {
      current = arg.slice(2)
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

function readDocuments(paths) {
  return paths.map(path => JSON.parse(readFileSync(resolve(path), 'utf8')))
}

/** Nearest-rank median; even counts average the two middle values. */
export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** One run's metric bundle, in the units the gate compares. */
function metricsOf(run) {
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
export function mediansOf(documents) {
  const cells = {}
  for (const document of documents) {
    for (const run of document.runs) {
      const key = `${run.historyTurns}/${run.observers}`
      ;(cells[key] ??= []).push(metricsOf(run))
    }
  }
  const result = {}
  for (const [key, runs] of Object.entries(cells)) {
    result[key] = Object.fromEntries(Object.keys(runs[0]).map(metric => [metric, median(runs.map(run => run[metric]))]))
  }
  return result
}

/**
 * Evaluate the six gates over parsed benchmark documents.
 * @param {object[]} baseline - before-change JSON documents.
 * @param {object[]} after - after-change JSON documents.
 * @returns {{pass: boolean, checks: object[], missing: string[]}} the result.
 */
export function evaluateGates(baseline, after) {
  const before = mediansOf(baseline)
  const changed = mediansOf(after)
  const missing = CELLS.filter(cell => before[cell] === undefined || changed[cell] === undefined)
  const checks = []
  const add = (gate, cell, actual, limit) => checks.push({ gate, cell, actual, limit,
    pass: Number.isFinite(actual) && actual <= limit })

  if (missing.length === 0) {
    for (const observers of [1, 2]) {
      add('historySlope', `160/${observers}`, changed[`160/${observers}`].cpuPerObserver / changed[`40/${observers}`].cpuPerObserver,
        LIMITS.historySlope)
      add('cost160', `160/${observers}`, changed[`160/${observers}`].cpuPerObserver / before[`160/${observers}`].cpuPerObserver,
        LIMITS.cost160)
    }
    add('observerRatio', '160', changed['160/2'].cpuTotal / changed['160/1'].cpuTotal, LIMITS.observerRatio)
    for (const cell of CELLS) {
      add('readP95', cell, changed[cell].readP95 / before[cell].readP95, LIMITS.readP95)
      add('memory', cell, changed[cell].memoryMb / before[cell].memoryMb, LIMITS.memory)
      add('payload', cell, changed[cell].payloadMb / before[cell].payloadMb, LIMITS.payload)
    }
  }
  return { pass: missing.length === 0 && checks.every(check => check.pass), checks, missing, before, changed }
}

/** Human-readable table for the command line. */
function render(result) {
  const lines = ['gate            cell    actual   limit   result']
  for (const check of result.checks) {
    lines.push(`${check.gate.padEnd(15)} ${check.cell.padEnd(6)} ${check.actual.toFixed(3).padStart(7)} ${String(check.limit).padStart(7)}   ${check.pass ? 'ok' : 'FAIL'}`)
  }
  if (result.missing.length > 0) lines.push(`missing cell(s): ${result.missing.join(', ')}`)
  return lines.join('\n')
}

function main(argv) {
  let groups
  try {
    groups = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`bench-gate: ${error.message}\n`)
    process.exit(2)
  }
  if (groups === undefined) {
    process.stderr.write('usage: node scripts/bench-gate.mjs --baseline <json...> --after <json...>\n')
    return
  }
  const result = evaluateGates(readDocuments(groups.baseline), readDocuments(groups.after))
  process.stdout.write(`${render(result)}\n${result.pass ? 'bench-gate: all gates pass' : 'bench-gate: regression'}\n`)
  if (!result.pass) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
