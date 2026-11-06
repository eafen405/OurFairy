/**
 * The commit gate runs while a merge is still uncommitted (#17x follow-up).
 *
 * `combo:verify` asks whether the worktree is based on the integration tip.
 * During a merge HEAD is still the branch tip and may predate that tip; the
 * merge result descends from both parents, so the incoming MERGE_HEAD carries
 * the same guarantee. Without this, every merge commit fails the gate and can
 * only land with `--no-verify` — exactly the bypass the gate exists to stop.
 *
 * The same gate runs on machines whose companion checkout lives elsewhere. An
 * absent default checkout is an environment fact, not a combination drift, so
 * the row is reported skipped; a path the caller named explicitly is still a
 * failure when missing.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { basedOnIntegration, repoPath, verifyCombination } from '../scripts/combo.ts'

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

/**
 * A combination whose dsh entry is locked to the integration tip.
 *
 * The remote-tracking ref carries the locked commit while the worktree is
 * checked out somewhere else — the state the dsh row used to report as ok
 * because it compared refs and never HEAD.
 * @returns the fixture root and the two commits.
 */
function dshCombination() {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-combo-head-'))
  git(root, ['init', '-q', '-b', 'main'])
  writeFileSync(join(root, 'file.txt'), 'locked\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'locked'])
  const locked = git(root, ['rev-parse', 'HEAD']).stdout.trim()
  git(root, ['branch', 'product/ourfairy-v1'])
  // A second commit the worktree will be parked on.
  writeFileSync(join(root, 'file.txt'), 'stale\n')
  git(root, ['commit', '-qam', 'stale'])
  const stale = git(root, ['rev-parse', 'HEAD']).stdout.trim()
  git(root, ['branch', '-f', 'product/ourfairy-v1', locked])
  // The worktree must START on the locked commit: that is the state the row
  // accepts, and the test then parks it elsewhere.
  git(root, ['checkout', '-q', '--detach', locked])
  mkdirSync(join(root, 'android'), { recursive: true })
  writeFileSync(join(root, 'android', 'ourfairy-source.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
  writeFileSync(join(root, 'combo.json'), JSON.stringify({
    schemaVersion: 1,
    product: 'test',
    repos: {
      dsh: { role: 'backend-harness', lock: 'commit', localPath: root, integrationBranch: 'product/ourfairy-v1', productCommit: locked },
    },
  }))
  return { root, locked, stale }
}

test('the dsh row fails when the branch ref is locked but the worktree is elsewhere', () => {
  const { root, locked, stale } = dshCombination()
  // `repoPath` reads the environment override first, so the fixture would be
  // bypassed on a machine that sets it. The row under test is the one reading
  // `combo.json`'s own path.
  const override = process.env.OURFAIRY_DSH_DIR
  delete process.env.OURFAIRY_DSH_DIR
  try {
    const clean = verifyCombination({ root })
    assert.equal(clean.rows.find(row => row.key === 'dsh').ok, true, `the locked worktree must pass: ${clean.failures.join('; ')}`)
    // Park the worktree on the other commit: the ref still names the lock.
    git(root, ['checkout', '-q', '--detach', stale])
    assert.equal(git(root, ['rev-parse', 'product/ourfairy-v1']).stdout.trim(), locked, 'the branch ref still names the lock')
    const drifted = verifyCombination({ root })
    const row = drifted.rows.find(entry => entry.key === 'dsh')
    assert.equal(row.ok, false, 'a worktree that is not the locked commit must not report ok')
    assert.match(drifted.failures.join('\n'), /HEAD is [0-9a-f]{40}/u, 'the failure names the worktree commit')
    assert.equal(drifted.ok, false)
  } finally {
    if (override !== undefined) process.env.OURFAIRY_DSH_DIR = override
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * A combination whose dsh entry records `localPath` and whose android
 * declaration matches, so a missing checkout is the only variable.
 * @param {string} localPath
 * @returns
 */
function relativeCombination(localPath) {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-combo-relative-'))
  git(root, ['init', '-q', '-b', 'main'])
  writeFileSync(join(root, 'file.txt'), 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'base'])
  mkdirSync(join(root, 'android'), { recursive: true })
  writeFileSync(join(root, 'android', 'ourfairy-source.json'), JSON.stringify({ commit: 'a'.repeat(40) }))
  writeFileSync(join(root, 'combo.json'), JSON.stringify({
    schemaVersion: 1,
    product: 'test',
    repos: {
      dsh: { role: 'backend-harness', lock: 'commit', localPath, integrationBranch: 'product/ourfairy-v1', productCommit: 'a'.repeat(40) },
    },
    androidSource: { commit: 'a'.repeat(40), declaration: 'android/ourfairy-source.json' },
  }))
  return root
}

test('an absent recorded checkout is skipped, not a combination failure', () => {
  const root = relativeCombination('absent-dsh')
  // The environment override is read before the recorded path, so a machine
  // that sets it would bypass the row under test.
  const override = process.env.OURFAIRY_DSH_DIR
  delete process.env.OURFAIRY_DSH_DIR
  try {
    const result = verifyCombination({ root })
    const row = result.rows.find(entry => entry.key === 'dsh')
    assert.ok(row !== undefined, 'the combination must carry a dsh row')
    assert.equal(result.ok, true, `an absent checkout is an environment fact, not drift: ${result.failures.join('; ')}`)
    assert.deepEqual(result.failures, [], 'a skipped row must not be recorded as a failure')
    assert.equal(row.ok, true)
    assert.match(row.skipped, /no checkout at .*absent-dsh/u, 'the skip names the path it looked at')
    assert.match(row.skipped, /OURFAIRY_DSH_DIR/u, 'the skip names the override that would verify it')
  } finally {
    if (override !== undefined) process.env.OURFAIRY_DSH_DIR = override
    rmSync(root, { recursive: true, force: true })
  }
})

test('an explicit checkout override that is missing is still a failure', () => {
  const root = relativeCombination('absent-dsh')
  const override = process.env.OURFAIRY_DSH_DIR
  process.env.OURFAIRY_DSH_DIR = join(root, 'no-such-dsh')
  try {
    const result = verifyCombination({ root })
    const row = result.rows.find(entry => entry.key === 'dsh')
    assert.ok(row !== undefined, 'the combination must carry a dsh row')
    assert.equal(result.ok, false, 'a missing path the caller named is a mistaken path, not an absent companion')
    assert.equal(row.ok, false)
    assert.equal(row.skipped, undefined)
    assert.match(result.failures.join('\n'), /checkout missing at .*no-such-dsh/u)
  } finally {
    if (override !== undefined) process.env.OURFAIRY_DSH_DIR = override
    else delete process.env.OURFAIRY_DSH_DIR
    rmSync(root, { recursive: true, force: true })
  }
})

test('a relative localPath reads the same from the primary checkout and a linked worktree', () => {
  const base = mkdtempSync(join(tmpdir(), 'ourfairy-combo-worktree-'))
  const root = join(base, 'OurFairy')
  mkdirSync(root)
  git(root, ['init', '-q', '-b', 'main'])
  writeFileSync(join(root, 'file.txt'), 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'base'])
  writeFileSync(join(root, 'combo.json'), JSON.stringify({
    schemaVersion: 1,
    product: 'test',
    repos: {
      dsh: { role: 'backend-harness', lock: 'commit', localPath: '../deepseek-harness', integrationBranch: 'product/ourfairy-v1', productCommit: 'a'.repeat(40) },
    },
  }))
  const worktree = join(base, 'ticket-worktree')
  git(root, ['worktree', 'add', '-q', worktree, '-b', 'ticket/test'])
  const override = process.env.OURFAIRY_DSH_DIR
  delete process.env.OURFAIRY_DSH_DIR
  try {
    const combo = JSON.parse(readFileSync(join(root, 'combo.json'), 'utf8'))
    const expected = join(base, 'deepseek-harness')
    assert.equal(repoPath(combo, 'dsh', root), expected, 'a relative path is anchored at the primary checkout')
    assert.equal(repoPath(combo, 'dsh', worktree), expected,
      'a ticket worktree must read the same companion checkout as the primary checkout')
  } finally {
    if (override !== undefined) process.env.OURFAIRY_DSH_DIR = override
    rmSync(base, { recursive: true, force: true })
  }
})
