/**
 * The one verification-report reader and verdict (#329).
 *
 * Approval, the background claim's settle decision and the review display all
 * consume the stored `skill_version.verification` facts through
 * `src/verification-report.ts`. These cases pin that module's input/output
 * contract directly: what a missing, broken or malformed report reads as, when
 * a candidate needs an execution of its own, and which refusal a report earns.
 * Expected values come from the ticket and the rules the previous gates
 * enforced, not from a second implementation.
 *
 * @covers backend/skill-creator
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { emptyVerificationReport, needsFreshExecution, readVerificationReport, verificationVerdict } = await import('../backend/skill-creator/dist/verification-report.js')

/** One recorded scenario, enough for the report reader and the counts it drives. */
function record(name, status = 'executed') {
  return {
    name,
    command: 'true',
    status,
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    executedAt: 1_700_000_000_000,
    environment: { cwd: '/tmp/verify/work', home: '/tmp/verify/home' },
    stdoutSummary: '',
    stderrSummary: '',
  }
}

test('a version with no stored report reads as an incomplete empty report stamped with its creation time', () => {
  const report = readVerificationReport({ verification: null, created_at: 1_700_000_000_123 })

  assert.deepEqual(report, {
    complete: false,
    executed: [],
    reused: [],
    unexecuted: [],
    failed: [],
    comparisons: [],
    environment: '',
    ranAt: 1_700_000_000_123,
  })
})

test('the explicit empty report has the same shape and is never complete', () => {
  assert.deepEqual(emptyVerificationReport(42), {
    complete: false,
    executed: [],
    reused: [],
    unexecuted: [],
    failed: [],
    comparisons: [],
    environment: '',
    ranAt: 42,
  })
})

test('a stored report reads back every recorded fact', () => {
  const executed = record('runs the workflow')
  const reused = { ...record('reads notes'), reusedFrom: 6 }
  const unexecuted = { ...record('needs network'), status: 'unexecuted', exitCode: null, durationMs: 0 }
  const failed = { ...record('exits non-zero'), status: 'failed', exitCode: 3 }
  const comparison = {
    name: 'with and without',
    withSkill: record('with skill'),
    withoutSkill: record('without skill'),
  }
  const stored = {
    complete: true,
    executed: [executed],
    reused: [reused],
    unexecuted: [unexecuted],
    failed: [failed],
    comparisons: [comparison],
    environment: 'bwrap 0.9.0, disposable HOME',
    ranAt: 1_700_000_000_999,
  }

  const report = readVerificationReport({ verification: JSON.stringify(stored), created_at: 1 })

  assert.deepEqual(report, stored)
})

test('bad JSON reads as an incomplete empty report, never as an approval-worthy one', () => {
  const report = readVerificationReport({ verification: '{"complete":true,', created_at: 7 })

  assert.equal(report.complete, false)
  assert.deepEqual(report.executed, [])
  assert.deepEqual(report.reused, [])
  assert.deepEqual(report.unexecuted, [])
  assert.deepEqual(report.failed, [])
  assert.deepEqual(report.comparisons, [])
  assert.equal(report.environment, '')
  assert.equal(report.ranAt, 7, 'a broken report falls back to the row creation time')
})

test('a JSON null or non-object reads as an incomplete empty report', () => {
  for (const verification of ['null', '[]', '"complete"', '42']) {
    const report = readVerificationReport({ verification, created_at: 11 })
    assert.equal(report.complete, false, verification)
    assert.deepEqual(report.executed, [], verification)
    assert.equal(report.ranAt, 11, verification)
  }
})

test('malformed fields converge to their documented defaults instead of leaking through', () => {
  const report = readVerificationReport({
    verification: JSON.stringify({
      complete: 'true',
      executed: {},
      reused: null,
      unexecuted: 'one',
      failed: 42,
      comparisons: {},
      environment: 7,
      ranAt: 'now',
    }),
    created_at: 5,
  })

  assert.equal(report.complete, false, 'only the literal boolean true is complete')
  assert.deepEqual(report.executed, [])
  assert.deepEqual(report.reused, [])
  assert.deepEqual(report.unexecuted, [])
  assert.deepEqual(report.failed, [])
  assert.deepEqual(report.comparisons, [])
  assert.equal(report.environment, '')
  assert.equal(report.ranAt, 5)
})

test('a report with only some fields keeps the fields it has and defaults the rest', () => {
  const executed = record('ran')
  const report = readVerificationReport({
    verification: JSON.stringify({ complete: true, executed: [executed] }),
    created_at: 9,
  })

  assert.equal(report.complete, true)
  assert.deepEqual(report.executed, [executed])
  assert.deepEqual(report.reused, [])
  assert.deepEqual(report.failed, [])
  assert.equal(report.environment, '')
  assert.equal(report.ranAt, 9)
})

test('content changed from its parent needs an execution of its own', () => {
  assert.equal(needsFreshExecution({ candidateManifestHash: 'new-hash', parentManifestHash: 'old-hash' }), true)
})

test('unchanged content and a brand-new skill need no execution of their own', () => {
  assert.equal(needsFreshExecution({ candidateManifestHash: 'same-hash', parentManifestHash: 'same-hash' }), false,
    'a reuse-only report for unchanged content is legitimate')
  assert.equal(needsFreshExecution({ candidateManifestHash: 'new-hash', parentManifestHash: null }), false,
    'an explicit create has no parent to differ from')
})

/** One report with the facts a verdict reads, built from counts. */
function reportOf({ complete = true, executed = 1, reused = 0, unexecuted = 0, failed = 0 } = {}) {
  return {
    complete,
    executed: Array.from({ length: executed }, (_, index) => record(`executed-${index}`)),
    reused: Array.from({ length: reused }, (_, index) => ({ ...record(`reused-${index}`), reusedFrom: 6 })),
    unexecuted: Array.from({ length: unexecuted }, (_, index) => ({ ...record(`unexecuted-${index}`), status: 'unexecuted', exitCode: null })),
    failed: Array.from({ length: failed }, (_, index) => ({ ...record(`failed-${index}`), status: 'failed', exitCode: 1 })),
    comparisons: [],
    environment: '',
    ranAt: 1,
  }
}

test('an incomplete report is refused as incomplete with the approval gate message', () => {
  const verdict = verificationVerdict({
    report: reportOf({ complete: false }),
    candidateManifestHash: 'same',
    parentManifestHash: 'same',
  })

  assert.deepEqual(verdict, {
    ok: false,
    refusal: 'incomplete',
    message: 'the verification report is incomplete; run it again',
  })
})

test('a complete report with no executed and no reused scenario has no evidence and is refused', () => {
  const verdict = verificationVerdict({
    report: reportOf({ executed: 0 }),
    candidateManifestHash: 'same',
    parentManifestHash: null,
  })

  assert.deepEqual(verdict, {
    ok: false,
    refusal: 'no-evidence',
    message: 'the verification report has no executed or reused scenario',
  })
})

test('an unexecuted scenario refuses the report', () => {
  const verdict = verificationVerdict({
    report: reportOf({ unexecuted: 1 }),
    candidateManifestHash: 'same',
    parentManifestHash: 'same',
  })

  assert.deepEqual(verdict, {
    ok: false,
    refusal: 'unexecuted',
    message: 'the verification report has unexecuted scenarios',
  })
})

test('a failed scenario refuses the report', () => {
  const verdict = verificationVerdict({
    report: reportOf({ failed: 1 }),
    candidateManifestHash: 'same',
    parentManifestHash: 'same',
  })

  assert.deepEqual(verdict, {
    ok: false,
    refusal: 'failed',
    message: 'a verification scenario failed; change the candidate and verify it again',
  })
})

test('changed content with a reuse-only report is refused as reused-only', () => {
  const verdict = verificationVerdict({
    report: reportOf({ executed: 0, reused: 1 }),
    candidateManifestHash: 'new-hash',
    parentManifestHash: 'old-hash',
  })

  assert.deepEqual(verdict, {
    ok: false,
    refusal: 'reused-only',
    message: 'the candidate content changed from its parent but its report only reuses the parent\'s runs; verify it again',
  })
})

test('a verdict with real execution of changed content is ok', () => {
  assert.deepEqual(verificationVerdict({
    report: reportOf({ executed: 1, reused: 3 }),
    candidateManifestHash: 'new-hash',
    parentManifestHash: 'old-hash',
  }), { ok: true })
})

test('unchanged content may be approved on a reuse-only report', () => {
  assert.deepEqual(verificationVerdict({
    report: reportOf({ executed: 0, reused: 1 }),
    candidateManifestHash: 'same-hash',
    parentManifestHash: 'same-hash',
  }), { ok: true })
})

test('a brand-new skill may be approved on a reuse-only report', () => {
  assert.deepEqual(verificationVerdict({
    report: reportOf({ executed: 0, reused: 1 }),
    candidateManifestHash: 'new-hash',
    parentManifestHash: null,
  }), { ok: true })
})

test('the first refusal wins in the fixed order: evidence, then unexecuted, then failed', () => {
  const verdict = verificationVerdict({
    report: reportOf({ unexecuted: 1, failed: 1 }),
    candidateManifestHash: 'same',
    parentManifestHash: 'same',
  })
  assert.equal(verdict.refusal, 'unexecuted', 'unexecuted is checked before failed')

  const noEvidence = verificationVerdict({
    report: reportOf({ executed: 0, unexecuted: 1, failed: 1 }),
    candidateManifestHash: 'same',
    parentManifestHash: 'same',
  })
  assert.equal(noEvidence.refusal, 'no-evidence', 'no evidence is checked before failure/unexecuted')

  const incomplete = verificationVerdict({
    report: reportOf({ complete: false, executed: 0, reused: 0, failed: 1 }),
    candidateManifestHash: 'same',
    parentManifestHash: 'same',
  })
  assert.equal(incomplete.refusal, 'incomplete', 'incomplete is checked before everything else')
})
