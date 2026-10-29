/**
 * The #94 relative gates are executable, not prose (ticket #94).
 *
 * `scripts/bench-gate.ts` is the command the evidence cites. This test fixes
 * its arithmetic and its failure direction with synthetic benchmark documents:
 * a passing after-run, a history-slope regression, and a missing cell.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateGates, median } from '../scripts/bench-gate.ts'

const run = (historyTurns, observers, { cpu, readP95, memoryMb, payloadMb }) => ({
  historyTurns,
  observers,
  stream: { cpuMsPerFragmentExcludingProbeApprox: cpu, reads: { p95: readP95 },
    frames: { bytesTotal: payloadMb * 1e6 } },
  memory: { peakVmHwmKb: memoryMb * 1024 },
})

const doc = runs => ({ runs })

const baseline = doc([
  run(40, 1, { cpu: 2.0, readP95: 10, memoryMb: 250, payloadMb: 27 }),
  run(40, 2, { cpu: 4.0, readP95: 12, memoryMb: 250, payloadMb: 54 }),
  run(160, 1, { cpu: 2.6, readP95: 10, memoryMb: 350, payloadMb: 27 }),
  run(160, 2, { cpu: 4.2, readP95: 15, memoryMb: 350, payloadMb: 54 }),
])
const passing = doc([
  run(40, 1, { cpu: 1.8, readP95: 11, memoryMb: 255, payloadMb: 27.2 }),
  run(40, 2, { cpu: 2.9, readP95: 12, memoryMb: 255, payloadMb: 54.4 }),
  run(160, 1, { cpu: 1.7, readP95: 8, memoryMb: 380, payloadMb: 27.2 }),
  run(160, 2, { cpu: 2.8, readP95: 10, memoryMb: 370, payloadMb: 54.4 }),
])

test('the gate arithmetic passes a within-limit after-run', () => {
  const result = evaluateGates([baseline], [passing])
  assert.equal(result.missing.length, 0)
  assert.equal(result.pass, true, JSON.stringify(result.checks.filter(check => !check.pass)))
  assert.equal(result.checks.find(check => check.gate === 'historySlope' && check.cell === '160/1').actual, 1.7 / 1.8)
  assert.equal(result.checks.find(check => check.gate === 'observerRatio').actual, 2.8 / 1.7)
})

test('the gate evaluates the six gates over the four measured cells', () => {
  const result = evaluateGates([baseline], [passing])
  assert.deepEqual([...new Set(result.checks.map(check => check.gate))].sort(),
    ['cost160', 'historySlope', 'memory', 'observerRatio', 'payload', 'readP95'])
  const cells = [...new Set(result.checks.filter(check => check.gate !== 'observerRatio').map(check => check.cell))].sort()
  assert.deepEqual(cells, ['160/1', '160/2', '40/1', '40/2'])
  assert.deepEqual(result.checks.filter(check => check.gate === 'observerRatio').map(check => check.cell), ['160'])
  assert.equal(result.checks.length, 17, '2 historySlope + 2 cost160 + 1 observerRatio + 4 cells × 3')
})

test('a 160-turn CPU regression fails historySlope and cost160', () => {
  const slow = doc([
    run(40, 1, { cpu: 1.8, readP95: 11, memoryMb: 255, payloadMb: 27.2 }),
    run(40, 2, { cpu: 2.9, readP95: 12, memoryMb: 255, payloadMb: 54.4 }),
    run(160, 1, { cpu: 3.4, readP95: 8, memoryMb: 380, payloadMb: 27.2 }),
    run(160, 2, { cpu: 2.8, readP95: 10, memoryMb: 370, payloadMb: 54.4 }),
  ])
  const result = evaluateGates([baseline], [slow])
  assert.equal(result.pass, false)
  assert.deepEqual(result.checks.filter(check => !check.pass).map(check => check.gate).sort(), ['cost160', 'historySlope'])
})

test('a missing cell fails instead of silently skipping a gate', () => {
  const incomplete = doc(passing.runs.slice(0, 3))
  const result = evaluateGates([baseline], [incomplete])
  assert.equal(result.pass, false)
  assert.deepEqual(result.missing, ['160/2'])
})

test('median uses the two middle values for an even sample', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.equal(median([3]), 3)
  assert.equal(median([]), null)
})
