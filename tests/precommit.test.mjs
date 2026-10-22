/**
 * The commit gate's split must stay what it claims (retro finding 3).
 *
 * The hook used to run the whole suite on every commit, `--amend` included. In
 * the 131–137 wave that was 272 commits × ~110 s, and the gate was bypassed
 * with `--no-verify` 27 times — a gate people cannot afford is a gate people
 * route around. The split is a claim ("Markdown-only changes cannot break the
 * backend suite"), so it gets an executable form here rather than a sentence
 * in the hook that nothing checks.
 *
 * The commands themselves are not run: this file pins the classification and
 * the command list, and the hook's own run is what proves the suite still
 * passes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DOCS_COMMANDS, FULL_COMMANDS, classify, plan } from '../scripts/precommit.mjs'
import { repoRoot } from './helpers/backend.mjs'

test('a Markdown-only change gets the docs gate, not the backend suite', () => {
  const paths = [
    'work/implementation/evidence/137-launcher-split/README.md',
    'docs/README.md',
    'AGENTS.md',
    'backend/chat/README.md',
  ]
  assert.equal(classify(paths), 'docs')
  assert.deepEqual(plan(paths).commands, DOCS_COMMANDS)
})

test('one code, config, or test path pulls the full suite back in', () => {
  const cases = [
    ['backend/chat/src/index.mjs'],
    ['combo.json'],
    ['package.json'],
    ['tests/specs-status.test.mjs'],
    ['scripts/precommit.mjs'],
    ['android/ourfairy-source.json'],
    ['work/implementation/evidence/137-launcher-split/README.md', 'scripts/ourfairy-backend.mjs'],
  ]
  for (const paths of cases) {
    assert.equal(classify(paths), 'full', `${paths.join(', ')} must run the full suite`)
  }
})

test('a message-only amend has no paths and runs the cheap gate', () => {
  assert.equal(classify([]), 'docs', 'an amend of an already-committed tree cannot break the backend')
  assert.deepEqual(plan([]).commands, DOCS_COMMANDS)
})

test('both gates keep the combination check, so drift is caught either way', () => {
  for (const commands of [DOCS_COMMANDS, FULL_COMMANDS]) {
    assert.ok(
      commands.some(step => step.args.join(' ') === 'run combo:verify'),
      'combo:verify is the check that catches a drifted checkout; every gate keeps it',
    )
  }
})

test('the hook runs the shared script instead of its own command list', () => {
  const hook = readFileSync(join(repoRoot, '.githooks', 'pre-commit'), 'utf8')
  assert.match(hook, /exec node scripts\/precommit\.mjs/u, 'the hook must delegate, or the split is unreachable')
  assert.doesNotMatch(hook, /^npm test$/mu, 'the hook must not keep its own copy of the command list')
})
