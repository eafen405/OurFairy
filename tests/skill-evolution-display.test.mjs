/**
 * The deterministic skill-review display (#299).
 *
 * These cases pin the two facts the growth rule depends on: the first block
 * carries the old/new core-body characters and the percentage, and a required
 * `确认增长` instruction survives even when long verification records push the
 * display against its bound. Expected strings come from the ticket, not from a
 * second rendering of the same code.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { buildReviewDisplay } = await import('../backend/skill-creator/dist/creation.js')

/** One review package with the fields the display reads. */
function review({ exceeded, command = 'true', scenarios = 1 }) {
  const oldCharacters = 1000
  const newCharacters = exceeded ? 1110 : 1090
  const executed = Array.from({ length: scenarios }, (_, index) => ({
    name: `scenario-${index}`,
    command,
    status: 'executed',
    exitCode: 0,
    timedOut: false,
    durationMs: 1,
    executedAt: index,
    environment: { cwd: '/tmp/verify/work', home: '/tmp/verify/home' },
    stdoutSummary: '',
    stderrSummary: '',
  }))
  return {
    versionId: 7,
    skillId: 3,
    name: 'demo',
    description: 'Use when demo.',
    scope: 1,
    ownerShortId: 7,
    proposerShortId: null,
    source: { type: 3, location: null, focus: null },
    status: 0,
    manifestHash: 'abc123',
    parentVersionId: 6,
    growth: { exceeded, oldCharacters, newCharacters, ratio: newCharacters / oldCharacters },
    coreCharacters: newCharacters,
    license: null,
    applicability: { whenToUse: 'Use when demo.', notApplicable: null },
    benefit: 'fix the failing step',
    package: [],
    packageTotal: 0,
    changes: { added: [], removed: [], changed: ['SKILL.md'], summary: '相对父版本：新增 0 个，删除 0 个，修改 1 个' },
    verification: { complete: true, executed, reused: [], unexecuted: [], failed: [], comparisons: [], environment: 'bwrap', ranAt: 1 },
    nextActions: ['approve', 'request_changes', 'reject'],
    growthConfirmation: {
      required: exceeded,
      oldCharacters,
      newCharacters,
      percent: Math.round((newCharacters / oldCharacters - 1) * 1_000) / 10,
      instruction: exceeded ? '超过旧版核心正文 10%；请在展示后单独回复「确认增长」，再批准。' : '',
    },
  }
}

test('a growth-exceeded display carries the characters, percentage and the exact instruction', () => {
  const display = buildReviewDisplay(review({ exceeded: true }))

  assert.ok(display.includes('核心正文 1000 → 1110 字符（+11.0%）'), display)
  assert.ok(display.includes('目标收益：fix the failing step'), display)
  assert.ok(display.includes('篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」'), display)
  assert.ok(display.endsWith('篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」'),
    'the instruction is the last line the user acts on')
})

test('a display within the growth limit carries no confirmation instruction', () => {
  const display = buildReviewDisplay(review({ exceeded: false }))

  assert.ok(display.includes('核心正文 1000 → 1090 字符（+9.0%）'), display)
  assert.ok(!display.includes('确认增长'), '109% needs no extra turn')
})

test('a zero-length parent body names the counts instead of an infinite percentage', () => {
  const reviewPackage = review({ exceeded: true })
  reviewPackage.growth = { exceeded: true, oldCharacters: 0, newCharacters: 10, ratio: Infinity }
  reviewPackage.coreCharacters = 10
  reviewPackage.growthConfirmation = { required: true, oldCharacters: 0, newCharacters: 10, percent: null, instruction: '' }
  const display = buildReviewDisplay(reviewPackage)

  assert.ok(display.includes('核心正文 0 → 10 字符'), display)
  assert.ok(!display.includes('Infinity'), display)
})

test('a long verification list cannot clip the required growth instruction away', () => {
  const command = `# ${'x'.repeat(1_990)}\ntrue`
  const display = buildReviewDisplay(review({ exceeded: true, command, scenarios: 20 }))

  assert.ok(display.length <= 4_000, `the display stays bounded; got ${display.length}`)
  assert.ok(display.includes('核心正文 1000 → 1110 字符（+11.0%）'), 'the first block survives the bound')
  assert.ok(display.endsWith('篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」'),
    'the instruction is reserved after the clipped body')
})
