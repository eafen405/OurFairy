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
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { LANDING_BRANCH, collect, render, specStatus, specsInCheckout, worktreeNamesSpec } from '../scripts/specs-status.ts'

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

/** Commit files, path to content, on the branch the fixture has checked out. */
function commitFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'ticket copies'])
}

/** A ticket README that declares its parent spec the way the ticket copies do. */
function declaresParent(spec) {
  return `# 票面\n\n父规格：[#${spec}](https://github.com/eafen405/OurFairy/issues/${spec})。\n`
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

test('cherry-picked content is landed without an ancestor merge', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-908', 'work/implementation/evidence/908-closeout/README.md')
  git(root, ['push', '--quiet', 'origin', 'integration/spec-908'])
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  git(root, ['cherry-pick', '--no-commit', 'integration/spec-908'])
  git(root, ['commit', '--quiet', '-m', 'apply 908'])
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  const report = collect({ root, offline: true })
  const row = report.rows.find(row => row.spec === 908)

  assert.equal(row.merged, false, 'the cherry-pick is not the branch ancestor')
  assert.equal(row.contentLanded, true, 'the same change is already in main')
  assert.equal(row.landed, true)
  assert.equal(row.state, 'landed')
  assert.equal(row.defect, false)
  const output = render(report)
  assert.match(output, /spec\/batch\s+state\s+branch\s+tip\s+push\s+merged\s+content\s+land/u)
  assert.match(output, /908\s+landed\s+integration\/spec-908\s+\S+\s+ok\s+-\s+ok\s+ok/u)
})

test('content that has not been applied is not content landed', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-909', 'work/implementation/evidence/909-closeout/README.md')
  git(root, ['push', '--quiet', 'origin', 'integration/spec-909'])

  const row = collect({ root, offline: true }).rows.find(row => row.spec === 909)

  assert.equal(row.merged, false)
  assert.equal(row.contentLanded, false)
  assert.equal(row.landed, false)
  assert.equal(row.state, 'in-flight')
})

test('a merge conflict never gets a green content landing', () => {
  const root = fixture()
  writeFileSync(join(root, 'shared.txt'), 'base\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'shared base'])
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])
  git(root, ['checkout', '--quiet', '-b', 'integration/spec-910', LANDING_BRANCH])
  writeFileSync(join(root, 'shared.txt'), 'branch\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'branch change'])
  git(root, ['push', '--quiet', 'origin', 'integration/spec-910'])
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  writeFileSync(join(root, 'shared.txt'), 'main\n')
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'main change'])

  const report = collect({ root, offline: true })
  const row = report.rows.find(row => row.spec === 910)

  assert.equal(row.merged, false)
  assert.equal(row.contentLanded, false)
  assert.equal(row.landed, false)
  assert.equal(row.state, 'in-flight')
  assert.match(render(report), /910\s+in-flight\s+integration\/spec-910\s+\S+\s+ok\s+-\s+-\s+-/u)
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

test('a named ticket directory declaring its parent spec is that spec copy on the landing branch', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  commitFiles(root, {
    'work/tickets/fairy-memory/README.md': declaresParent(915),
    'work/tickets/fairy-memory/01-ticket.md': 'ticket\n',
  })
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  const report = collect({ root, offline: true })
  const row = report.rows.find(row => row.spec === 915)

  assert.equal(specsInCheckout(root).has(915), true, 'the declared parent names a spec the checkout knows')
  assert.ok(row, 'a named copy puts #915 in the report although no directory is called 915')
  assert.equal(row.copies, true, 'the landing tree carries the declared copy')
  assert.match(render(report), /915\s+planned\s+-\s+-\s+-\s+-\s+-\s+-\s+0\s+ok\s+0/u)
})

test('a spec branch tip carrying a named ticket copy is that spec copy', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', '-b', 'integration/spec-916', LANDING_BRANCH])
  commitFiles(root, {
    'work/tickets/memory-wave/README.md': declaresParent(916),
    'work/tickets/memory-wave/01-ticket.md': 'ticket\n',
  })
  git(root, ['push', '--quiet', 'origin', 'integration/spec-916'])
  // Leave the landing branch checked out: the copy is reachable only in the branch tree.
  git(root, ['checkout', '--quiet', LANDING_BRANCH])

  assert.equal(specStatus(916, { root, worktrees: [] }).copies, true,
    'the copy is read from the branch tree, not from the working tree')
})

test('a directory that declares no parent spec is not a copy of any spec', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  commitFiles(root, {
    'work/tickets/local-drafts/README.md': '# 草案\n\n父规格：见正文。\n',
    'work/tickets/local-drafts/01-ticket.md': 'ticket\n',
    'work/tickets/no-declaration/README.md': '# 说明\n\n这里只是本地工作副本。\n',
  })
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  assert.equal(specStatus(917, { root, worktrees: [] }).copies, false, 'a prose 父规格 line names no spec')
  assert.equal(specStatus(918, { root, worktrees: [] }).copies, false, 'an arbitrary README is not a ticket copy')
  assert.equal(specsInCheckout(root).has(917), false)
})

test('a numeric ticket directory stays its own spec, whatever its README says', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  commitFiles(root, {
    'work/tickets/919/README.md': declaresParent(920),
    'work/tickets/919/01-ticket.md': 'ticket\n',
  })
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  assert.equal(specStatus(919, { root, worktrees: [] }).copies, true, 'a numeric directory is its own spec')
  assert.equal(specStatus(920, { root, worktrees: [] }).copies, false, 'a numeric directory does not speak for another spec')
})

test('a named ticket directory can declare its parent spec in published.json', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', '-b', 'integration/spec-921', LANDING_BRANCH])
  commitFiles(root, {
    'work/tickets/memory-wave/published.json': '{\n  "parent": 921,\n  "title": "记忆治理"\n}\n',
    'work/tickets/memory-wave/01-ticket.md': 'ticket\n',
  })
  assert.equal(specsInCheckout(root).has(921), true, 'the working tree declaration names a known spec')

  git(root, ['push', '--quiet', 'origin', 'integration/spec-921'])
  git(root, ['checkout', '--quiet', LANDING_BRANCH])

  assert.equal(specStatus(921, { root, worktrees: [] }).copies, true, 'the branch tree carries the declared copy')
})

test('a published.json without a parent field is not a copy of any spec', () => {
  const root = fixture()
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  commitFiles(root, {
    'work/tickets/field-map/published.json': '{\n  "01-ticket.md": { "number": 922 }\n}\n',
  })
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])

  assert.equal(specStatus(922, { root, worktrees: [] }).copies, false, 'only a parent field names a spec')
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

test('a non-spec integration branch is a batch row with actionable status', () => {
  const root = fixture()
  commitOn(root, 'integration/fixes-219-221', 'work/implementation/evidence/fixes-219-221/README.md')

  const report = collect({ root, offline: true })

  assert.equal(report.rows.some(row => row.branch === 'integration/fixes-219-221'), false)
  const batch = report.batchRows.find(row => row.branch === 'integration/fixes-219-221')
  assert.ok(batch, 'the fixes branch is discovered without inventing a spec number')
  assert.equal(batch.name, 'fixes-219-221')
  assert.equal(batch.state, 'unpushed')
  assert.equal(batch.pushed, false)
  assert.equal(batch.merged, false)
  assert.equal(batch.contentLanded, false)
  assert.equal(batch.landed, false)
  assert.equal(batch.ahead, 1)
  assert.deepEqual(batch.worktrees, [])
  assert.equal(batch.defect, true)
  assert.match(render(report), /specs-status: 1 need attention — fixes-219-221 unpushed/u)
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

test('running from a secondary worktree does not report the main checkout as orphan', () => {
  const root = fixture()
  const secondary = join(root, 'spec-906')
  roots.push(secondary)
  git(root, ['worktree', 'add', '--quiet', '-b', 'integration/spec-906', secondary])

  const report = collect({ root: secondary, offline: true })

  assert.equal(report.orphanWorktrees.includes(root), false, 'the primary checkout is not an orphan')
  assert.equal(report.rows.find(row => row.spec === 906).worktrees.includes(secondary), true)
  assert.doesNotMatch(render(report), new RegExp(root.replaceAll('/', '\\/'), 'u'))
})

test('a landed spec still counts its ticket worktree by the real branch', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-911', 'work/implementation/evidence/911-closeout/README.md')
  git(root, ['push', '--quiet', 'origin', 'integration/spec-911'])
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  git(root, ['merge', '--quiet', '--no-ff', 'integration/spec-911', '-m', 'merge 911'])
  git(root, ['push', '--quiet', 'origin', LANDING_BRANCH])
  const ticket = join(root, '911-review')
  roots.push(ticket)
  git(root, ['worktree', 'add', '--quiet', '-b', 'ticket/911-review', ticket])

  const report = collect({ root, offline: true })
  const row = report.rows.find(row => row.spec === 911)

  assert.equal(row.state, 'stale-worktree')
  assert.deepEqual(row.worktrees, [ticket])
  assert.deepEqual(report.orphanWorktrees, [])
})

test('worktrees are associated by the branch checked out in porcelain', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-907', 'work/implementation/evidence/907-closeout/README.md')
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  const secondary = join(root, 'arbitrary-location')
  git(root, ['worktree', 'add', '--quiet', secondary, 'integration/spec-907'])

  const report = collect({ root, offline: true })

  assert.deepEqual(report.rows.find(row => row.spec === 907).worktrees, [secondary])
  assert.deepEqual(report.orphanWorktrees, [])
})

test('--spec filters rows without orphaning other known worktrees', () => {
  const root = fixture()
  commitOn(root, 'integration/spec-912', 'work/implementation/evidence/912-filter/README.md')
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  commitOn(root, 'integration/spec-913', 'work/implementation/evidence/913-filter/README.md')
  git(root, ['checkout', '--quiet', LANDING_BRANCH])
  const selected = join(root, 'spec-912')
  const unselected = join(root, 'spec-913')
  roots.push(selected, unselected)
  git(root, ['worktree', 'add', '--quiet', selected, 'integration/spec-912'])
  git(root, ['worktree', 'add', '--quiet', unselected, 'integration/spec-913'])

  const report = collect({ root, offline: true, specs: [912] })

  assert.deepEqual(report.rows.map(row => row.spec), [912])
  assert.deepEqual(report.orphanWorktrees, [])
  assert.doesNotMatch(render(report), /worktrees outside known integration branches/u)
})

test('the landing branch drift appears only once', () => {
  const root = fixture()

  const report = collect({ root, offline: true })

  assert.deepEqual(report.landing.map(entry => entry.branch), [LANDING_BRANCH])
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
