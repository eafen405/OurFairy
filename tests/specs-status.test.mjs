/**
 * `specs-status` must report what git and the tracker actually say (retro finding 1).
 *
 * The 131–137 wave finished with three of six integration branches never pushed,
 * six worktrees still present, and no way to see any of it: the next session
 * spent ~30 `git log --all` / `reflog` / `merge-tree` / `gh issue view` calls to
 * answer "did spec 136 ever ship?". The command exists to make that one call.
 *
 * These tests build throwaway repositories rather than asserting against this
 * checkout: the checkout's own state changes with every wave, so an assertion
 * on it would either rot or force the state to be frozen. Each case is one
 * fact the report derives — pushed, landed, leftover, copies, tracker — and the
 * command is driven at its exported seam.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { LANDING_BRANCH, collect, render, specStatus, worktreeNamesSpec } from '../scripts/specs-status.ts'

const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Run git in a fixture repository, failing loudly when the fixture itself is wrong. */
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * A repository with a landing branch, an origin that already has it, and the
 * ticket-copy layout the report reads. Commits are made by the fixture, so the
 * landing branch and the spec branches are real refs rather than stubs.
 * @returns {string} the repository root
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-specs-status-'))
  roots.push(root)
  git(root, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['config', 'user.email', 'fixture@example.invalid'])
  git(root, ['config', 'user.name', 'Fixture'])
  mkdirSync(join(root, 'work', 'tickets'), { recursive: true })
  writeFileSync(join(root, 'combo.json'), '{}\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'initial'])
  // The landing branch may be the fixture's own default branch (main); only a
  // separate landing ref has to be created.
  if (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== LANDING_BRANCH) {
    git(root, ['branch', LANDING_BRANCH])
  }
  // A bare origin holding the landing branch, so "pushed" has something to compare with.
  const origin = `${root}-origin.git`
  roots.push(origin)
  git(tmpdir(), ['init', '--quiet', '--bare', origin])
  git(root, ['remote', 'add', 'origin', origin])
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])
  return root
}

/** Commit one file on a new branch off the landing branch. */
function commitOn(root, branch, path) {
  git(root, ['checkout', '--quiet', '-b', branch, LANDING_BRANCH])
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), 'evidence\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', `${branch} work`])
}

test('a branch that never left the machine is the defect this command exists for', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-900', 'work/implementation/evidence/900-local-only/README.md')

  const row = specStatus(900, { root, worktrees: [] })

  assert.equal(row.state, 'unpushed')
  assert.equal(row.pushed, false, 'no origin counterpart means not pushed')
  assert.equal(row.landed, false)
  assert.equal(row.defect, true, 'local-only work is what a reader must act on')
})

test('a pushed branch is in flight until it lands, and landed once merged', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-901', 'work/implementation/evidence/901-closeout/README.md')
  git(root, ['push', '--quiet', 'origin', 'integration/spec-901'])

  assert.equal(specStatus(901, { root, worktrees: [] }).state, 'in-flight')

  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  git(root, ['merge', '--quiet', '--no-ff', 'integration/spec-901', '-m', 'merge 901'])
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  const landed = specStatus(901, { root, worktrees: [] })
  assert.equal(landed.state, 'landed')
  assert.equal(landed.defect, false)
})

test('a landed spec that still holds a worktree is a defect', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-902', 'work/implementation/evidence/902-closeout/README.md')
  git(root, ['push', '--quiet', 'origin', 'integration/spec-902'])
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  git(root, ['merge', '--quiet', '--no-ff', 'integration/spec-902', '-m', 'merge 902'])
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  const leftover = '/elsewhere/.worktrees/spec-902'
  const row = specStatus(902, { root, worktrees: [leftover, '/elsewhere/.worktrees/146-147-triage'] })

  assert.equal(row.state, 'stale-worktree')
  assert.deepEqual(row.worktrees, [leftover], 'only the worktree naming this spec is counted')
  assert.equal(row.defect, true)
})

test('worktree names match a spec, its ticket worktrees, and nothing else', () => {
  assert.equal(worktreeNamesSpec('/r/.worktrees/spec-131', 131), true)
  assert.equal(worktreeNamesSpec('/r/.worktrees/131-review-fixes', 131), true)
  assert.equal(worktreeNamesSpec('/r/.worktrees/1310-other', 131), false)
  assert.equal(worktreeNamesSpec('/r/.worktrees/146-147-triage', 131), false)
})

test('ticket copies are read from the branch, and a missing copy is reported', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-903', 'work/tickets/903/01-ticket.md')

  assert.equal(specStatus(903, { root, worktrees: [] }).copies, true, 'a copy on the spec branch is reachable')
  assert.equal(specStatus(904, { root, worktrees: [] }).copies, false, 'a spec with no copy says so')
})

test('the report keeps the tracker half injectable and offline mode honest', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-905', 'work/implementation/evidence/905-closeout/README.md')

  const offline = collect({ root, offline: true })
  assert.equal(offline.tracker, 'skipped')
  assert.equal(offline.rows.find(row => row.spec === 905).issue, undefined, 'offline rows carry no tracker fact')

  const tracker = new Map([[905, { state: 'OPEN', title: 'a spec' }]])
  const online = collect({ root, specs: [905], tracker })
  assert.equal(online.tracker, 'ok')
  assert.equal(online.rows[0].issue, 'OPEN')
  assert.equal(online.rows[0].title, 'a spec')
})

test('the landing branch having unpushed commits is reported, and rendered', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  writeFileSync(join(root, 'late.md'), 'late\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'unpushed landing commit'])

  const report = collect({ root, offline: true })
  const landing = report.landing.find(entry => entry.branch === LANDING_BRANCH)
  assert.equal(landing.ahead, 1, 'the landing branch is one commit ahead of origin')
  assert.match(render(report), new RegExp(`${LANDING_BRANCH} is 1 ahead`, 'u'))
  assert.match(render(report), /need attention/u)
})

test('a branch that exists only on origin is reported instead of vanishing', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-903', 'work/implementation/evidence/903-closeout/README.md')
  git(root, ['push', '--quiet', 'origin', 'integration/spec-903'])
  // The local branch is gone; only origin still has it, as after a cleanup or a fresh clone.
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  git(root, ['branch', '--quiet', '-D', 'integration/spec-903'])

  assert.ok(collect({ root, offline: true }).rows.some(row => row.spec === 903),
    'the spec set must include a branch that only origin carries')

  const row = specStatus(903, { root, worktrees: [] })
  assert.equal(row.state, 'orphan')
  assert.equal(row.defect, true, 'a spec whose only branch is remote is work a reader must act on')
  assert.equal(row.branch, null)
})
