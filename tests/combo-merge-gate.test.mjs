/**
 * The commit gate runs while a merge is still uncommitted (#17x follow-up).
 *
 * `combo:verify` asks whether the worktree is based on the integration tip.
 * During a merge HEAD is still the branch tip and may predate that tip; the
 * merge result descends from both parents, so the incoming MERGE_HEAD carries
 * the same guarantee. Without this, every merge commit fails the gate and can
 * only land with `--no-verify` — exactly the bypass the gate exists to stop.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { basedOnIntegration } from '../scripts/combo.ts'

/** Run git in `root`; a non-zero exit is a test failure unless asked for. */
function git(root, args, { allowFail = false } = {}) {
  const run = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], {
    cwd: root, encoding: 'utf8',
  })
  if (!allowFail) assert.equal(run.status, 0, `git ${args.join(' ')} failed:\n${run.stdout}\n${run.stderr}`)
  return run
}

/** A repository with `integration` at a base, the branch one commit behind, and a merge in progress. */
function mergeInProgress() {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-merge-gate-'))
  git(root, ['init', '-q', '-b', 'main'])
  writeFileSync(join(root, 'file.txt'), 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'base'])
  const base = git(root, ['rev-parse', 'HEAD']).stdout.trim()
  git(root, ['branch', 'integration'])
  // Advance the integration branch past the base.
  git(root, ['checkout', '-q', 'integration'])
  writeFileSync(join(root, 'file.txt'), 'integration\n')
  git(root, ['commit', '-qam', 'integration'])
  const tip = git(root, ['rev-parse', 'HEAD']).stdout.trim()
  // Branch off the base and diverge, so HEAD is not a descendant of the tip.
  git(root, ['checkout', '-q', '--detach', base])
  git(root, ['checkout', '-qb', 'feature'])
  writeFileSync(join(root, 'file.txt'), 'feature\n')
  git(root, ['commit', '-qam', 'feature'])
  const head = git(root, ['rev-parse', 'HEAD']).stdout.trim()
  // Leave the merge unresolved: MERGE_HEAD exists, HEAD is still the feature tip.
  git(root, ['merge', 'integration'], { allowFail: true })
  return { root, base, tip, head }
}

test('an in-progress merge counts as based on the integration tip through MERGE_HEAD', () => {
  const { root, tip, head } = mergeInProgress()
  try {
    assert.equal(git(root, ['rev-parse', 'HEAD']).stdout.trim(), head, 'the fixture must keep HEAD at the branch tip')
    assert.equal(git(root, ['rev-parse', 'MERGE_HEAD']).stdout.trim(), tip, 'the fixture must merge the integration tip')
    assert.equal(basedOnIntegration(root, tip), true,
      'the pending merge result descends from the tip even though HEAD does not')
    // Abort leaves the same HEAD with no MERGE_HEAD: the same check must fail.
    git(root, ['merge', '--abort'])
    assert.equal(basedOnIntegration(root, tip), false,
      'without an incoming merge, a branch off the base is still not based on the tip')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a branch that contains the tip passes without a merge', () => {
  const { root, base } = mergeInProgress()
  try {
    git(root, ['merge', '--abort'])
    assert.equal(basedOnIntegration(root, base), true, 'the base is an ancestor of HEAD')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
