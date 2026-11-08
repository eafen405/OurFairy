/**
 * The skill store's creation/review transactions, tested without a backend.
 *
 * These are the fast seams for the #297 state machine: a draft is one pending
 * version on an identity that has no approved current version; a settled
 * review is final; publish re-checks the row inside `BEGIN IMMEDIATE` and moves
 * the current pointer in one transaction. Expected values come from the design
 * (one current version, one decision, a preference written once), not from
 * re-running the implementation.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'ourfairy-skill-store-'))
after(() => rmSync(root, { recursive: true, force: true }))

/** One fresh skill store in a temporary data root. */
async function open(name) {
  const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
  const directory = join(root, name)
  return { store: new SkillStore({ path: join(directory, 'skill.sqlite') }), root: directory }
}

/** One pending draft, named by the table facts it stores. */
let draftNo = 0
function draft(overrides = {}) {
  draftNo += 1
  return {
    name: `draft-${draftNo}`,
    scope: 1,
    ownerShortId: 7,
    createdBy: 7,
    packagePath: `candidates/uuid-${draftNo}`,
    manifest: '[]',
    manifestHash: `hash-${draftNo}`,
    coreCharacters: 100,
    sourceType: 0,
    sourceLocation: JSON.stringify({ sessionId: 'session-1' }),
    ...overrides,
  }
}

/** The rows the SQLite file holds, through a second connection. */
function rows(path, sql, ...parameters) {
  const database = new DatabaseSync(path)
  try {
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

test('a first draft creates the identity; a second draft joins it while no version is approved', async () => {
  const { store, root: directory } = await open('drafts')
  try {
    const first = store.createDraft(draft({ name: 'shared-name' }))
    assert.equal(first.createdSkill, true)
    const second = store.createDraft(draft({ name: 'shared-name' }))
    assert.equal(second.createdSkill, false, 'the second draft joins the same identity')
    assert.equal(second.skillId, first.skillId)
    assert.notEqual(second.versionId, first.versionId)

    const identities = rows(join(directory, 'skill.sqlite'), 'SELECT * FROM skill')
    assert.equal(identities.length, 1, 'one identity, not one row per draft')
    assert.equal(identities[0].current_version_id, null, 'a draft never becomes the current version')

    const pending = store.pendingDrafts(7)
    assert.deepEqual(pending.map(row => row.id).sort(), [first.versionId, second.versionId].sort())
    assert.ok(pending.every(row => row.status === 0 && row.skill_name === 'shared-name'))
    assert.deepEqual(store.pendingDrafts(8), [], 'another owner sees no personal pending draft')
  } finally {
    store.close()
  }
})

test('a name conflict with an approved identity is refused, while personal and common may share a name', async () => {
  const { store } = await open('conflict')
  try {
    const personal = store.createDraft(draft({ name: 'same-name' }))
    assert.equal(personal.createdSkill, true)
    store.publishDraft({
      versionId: personal.versionId,
      packagePath: 'versions/1/one',
      reviewer: 7,
      reviewedAt: 1,
      ownerShortId: 7,
      defaultEnable: true,
      recheck: () => true,
    })

    assert.throws(() => store.createDraft(draft({ name: 'same-name' })), /revision/u,
      'an approved identity accepts no second identity of the same name')
    const common = store.createDraft(draft({ name: 'same-name', scope: 2, ownerShortId: undefined, createdBy: 9 }))
    assert.equal(common.createdSkill, true, 'personal and common identities may share a name')
  } finally {
    store.close()
  }
})

test('a draft package path must be a safe relative path under candidates/', async () => {
  const { store } = await open('invalid-path')
  try {
    for (const packagePath of [
      '', 'candidates', 'candidates/', 'candidates//uuid', 'candidates/./uuid', 'candidates/../uuid',
      './candidates/uuid', '/candidates/uuid', 'versions/1/uuid', 'candidates\\uuid',
    ]) {
      assert.throws(
        () => store.createDraft(draft({ packagePath })),
        error => error.code === 'skills/invalid-path',
        `createDraft must refuse ${JSON.stringify(packagePath)}`,
      )
    }
    assert.deepEqual(store.pendingDrafts(7), [], 'a refused path writes no row')
  } finally {
    store.close()
  }
})

test('a pending version settles once; request-changes and reject are terminal for that row', async () => {
  const { store } = await open('settle')
  try {
    const { versionId } = store.createDraft(draft())
    const decided = store.recordReviewDecision({ versionId, status: 1, reviewer: 7, reviewedAt: 2, note: 'tighten the steps' })
    assert.equal(decided, true)
    assert.equal(store.version(versionId).status, 1)
    assert.equal(store.version(versionId).review_note, 'tighten the steps')

    assert.equal(store.recordReviewDecision({ versionId, status: 2, reviewer: 7, reviewedAt: 3, note: 'late reject' }), false,
      'a settled version cannot be decided again')
    assert.equal(store.version(versionId).status, 1, 'the first decision stands')

    const rejected = store.createDraft(draft())
    assert.equal(store.recordReviewDecision({ versionId: rejected.versionId, status: 2, reviewer: 7, reviewedAt: 4 }), true)
    assert.equal(store.version(rejected.versionId).status, 2)
  } finally {
    store.close()
  }
})

test('publish approves atomically, supersedes the previous current version and enables the first personal approval', async () => {
  const { store, root: directory } = await open('publish')
  try {
    const first = store.createDraft(draft({ name: 'workflow' }))
    const second = store.createDraft(draft({ name: 'workflow' }))
    assert.equal(second.skillId, first.skillId, 'both drafts are the same identity while nothing is approved')
    const published = store.publishDraft({
      versionId: first.versionId,
      packagePath: 'versions/1/one',
      reviewer: 7,
      reviewedAt: 5,
      ownerShortId: 7,
      defaultEnable: true,
      recheck: () => true,
    })
    assert.equal(published.skillId, first.skillId)
    assert.equal(published.previousVersionId, null)
    assert.equal(store.version(first.versionId).status, 3)
    assert.equal(store.identity(first.skillId).current_version_id, first.versionId)
    assert.equal(store.preference(7, first.skillId).enabled, 1,
      'the first personal approval enables the owner by default')
    assert.throws(() => store.createDraft(draft({ name: 'workflow' })), /revision/u,
      'an approved identity refuses a second identity of the same name')

    // No preference is ever second-guessed: a later publish keeps the row.
    store.setPreference({ shortId: 7, skillId: first.skillId, enabled: false })
    const next = store.publishDraft({
      versionId: second.versionId,
      packagePath: 'versions/1/two',
      reviewer: 7,
      reviewedAt: 6,
      ownerShortId: 7,
      defaultEnable: true,
      recheck: () => true,
    })
    assert.equal(next.previousVersionId, first.versionId)
    assert.equal(store.version(first.versionId).status, 4, 'the old current version becomes superseded')
    assert.equal(store.version(second.versionId).status, 3)
    assert.equal(store.identity(first.skillId).current_version_id, second.versionId)
    assert.equal(store.preference(7, first.skillId).enabled, 0, 'publish preserves an explicit preference')

    const current = rows(join(directory, 'skill.sqlite'), "SELECT id FROM skill_version WHERE skill_id = ? AND status = 3 AND deleted_at IS NULL", first.skillId)
    assert.equal(current.length, 1, 'the unique index leaves exactly one current version')
  } finally {
    store.close()
  }
})

test('publish refuses a settled or stale row and rolls its re-check failure back', async () => {
  const { store } = await open('rollback')
  try {
    const { versionId } = store.createDraft(draft())
    assert.throws(() => store.publishDraft({
      versionId, packagePath: 'versions/1/one', reviewer: 7, reviewedAt: 1, ownerShortId: 7,
      defaultEnable: true, recheck: () => false,
    }), /re-check|changed/u)
    assert.equal(store.version(versionId).status, 0, 'a failed re-check leaves the version pending')
    assert.equal(store.identity(store.version(versionId).skill_id).current_version_id, null)

    assert.equal(store.recordReviewDecision({ versionId, status: 2, reviewer: 7, reviewedAt: 2 }), true)
    assert.throws(() => store.publishDraft({
      versionId, packagePath: 'versions/1/one', reviewer: 7, reviewedAt: 3, ownerShortId: 7,
      defaultEnable: true, recheck: () => true,
    }), /pending/u, 'a rejected version cannot be published')
  } finally {
    store.close()
  }
})

test('verification is stored on the version and pending drafts are bounded', async () => {
  const { store } = await open('verification')
  try {
    const { versionId } = store.createDraft(draft())
    assert.equal(store.updateVerification(versionId, JSON.stringify({ complete: true })), true)
    assert.deepEqual(JSON.parse(store.version(versionId).verification), { complete: true })

    for (let index = 0; index < 55; index += 1) store.createDraft(draft({ name: `bounded-${index}` }))
    assert.equal(store.pendingDrafts(7).length, 50, 'the pending read is bounded to 50')
  } finally {
    store.close()
  }
})

test('a revision draft publishes only against its own parent and only with the growth confirmation', async () => {
  const { store } = await open('revision-publish')
  try {
    const first = store.createDraft(draft({ name: 'evolve' }))
    store.publishDraft({
      versionId: first.versionId, packagePath: 'versions/1/one', reviewer: 7, reviewedAt: 1,
      ownerShortId: 7, defaultEnable: true, recheck: () => true,
    })
    store.setPreference({ shortId: 7, skillId: first.skillId, enabled: false })

    const revision = store.createDraft(draft({
      name: 'evolve', parentVersionId: first.versionId, growthExceeded: true,
    }))
    assert.equal(revision.createdSkill, false, 'a revision joins the approved identity')
    assert.throws(() => store.createDraft(draft({ name: 'evolve', parentVersionId: 999_999 })), /revision/u,
      'a draft coexisting with a current version must name exactly that current version')

    const withoutConfirmation = () => store.publishDraft({
      versionId: revision.versionId, packagePath: 'versions/1/two', reviewer: 7, reviewedAt: 2,
      ownerShortId: 7, defaultEnable: true, recheck: () => true,
    })
    assert.throws(withoutConfirmation, /confirmation/u, 'an exceeded growth cannot publish without the confirmation')
    assert.equal(store.version(revision.versionId).status, 0)

    const published = store.publishDraft({
      versionId: revision.versionId, packagePath: 'versions/1/two', reviewer: 7, reviewedAt: 3,
      ownerShortId: 7, defaultEnable: true,
      confirmGrowth: { confirmedBy: 7, confirmedAt: 123, messageId: 'message-1' },
      recheck: () => true,
    })
    assert.equal(published.previousVersionId, first.versionId)
    const stored = store.version(revision.versionId)
    assert.equal(stored.status, 3)
    assert.equal(stored.growth_confirmed_by, 7)
    assert.equal(stored.growth_confirmed_at, 123)
    assert.equal(stored.growth_confirm_message, 'message-1')
    assert.equal(store.preference(7, first.skillId).enabled, 0, 'the version switch preserves the preference')

    const stale = store.createDraft(draft({ name: 'evolve', parentVersionId: revision.versionId }))
    const newer = store.createDraft(draft({ name: 'evolve', parentVersionId: revision.versionId }))
    store.publishDraft({
      versionId: newer.versionId, packagePath: 'versions/1/three', reviewer: 7, reviewedAt: 4,
      ownerShortId: 7, defaultEnable: true, recheck: () => true,
    })
    assert.throws(() => store.publishDraft({
      versionId: stale.versionId, packagePath: 'versions/1/four', reviewer: 7, reviewedAt: 5,
      ownerShortId: 7, defaultEnable: true, recheck: () => true,
    }), /changed/u, 'a revision whose parent is no longer current cannot publish')
    assert.equal(store.version(stale.versionId).status, 0)
    assert.equal(store.identity(first.skillId).current_version_id, newer.versionId)
  } finally {
    store.close()
  }
})

test('openDraftSkillIds counts a pending sibling and a newest changes-requested one only', async () => {
  const { store } = await open('open-drafts')
  try {
    const first = store.createDraft(draft({ name: 'in-progress' }))
    store.publishDraft({
      versionId: first.versionId, packagePath: 'versions/1/one', reviewer: 7, reviewedAt: 1,
      ownerShortId: 7, defaultEnable: true, recheck: () => true,
    })
    assert.equal(store.openDraftSkillIds(7).has(first.skillId), false)

    const requested = store.createDraft(draft({ name: 'in-progress', parentVersionId: first.versionId }))
    store.recordReviewDecision({ versionId: requested.versionId, status: 1, reviewer: 7, reviewedAt: 2 })
    assert.equal(store.openDraftSkillIds(7).has(first.skillId), true,
      'a newest changes-requested revision still marks the current version')
    assert.equal(store.openDraftSkillIds(8).has(first.skillId), false, 'another owner sees no draft')

    const settled = store.createDraft(draft({ name: 'in-progress', parentVersionId: first.versionId }))
    store.recordReviewDecision({ versionId: settled.versionId, status: 2, reviewer: 7, reviewedAt: 3 })
    assert.equal(store.openDraftSkillIds(7).has(first.skillId), false,
      'a newer settled draft replaces the older changes-requested state')
  } finally {
    store.close()
  }
})

describe('schema v3', () => {
  /** Open the store on a published row so the migration has real data to keep. */
  async function seeded(name) {
    const { store, root: directory } = await open(name)
    try {
      const created = store.createDraft(draft({ name: 'kept' }))
      store.publishDraft({
        versionId: created.versionId, packagePath: 'versions/1/kept', reviewer: 7, reviewedAt: 1,
        ownerShortId: 7, defaultEnable: true, recheck: () => true,
      })
    } finally {
      store.close()
    }
    return { path: join(directory, 'skill.sqlite') }
  }

  /** Downgrade one v3 file to the v2 shape: no v3 columns or indexes. */
  function downgradeToV2(path) {
    const database = new DatabaseSync(path)
    try {
      database.exec('DROP INDEX IF EXISTS skill_version_growth_confirm_unique')
      database.exec('DROP INDEX IF EXISTS skill_reuse_signal_by_revoked')
      database.exec('ALTER TABLE skill_version DROP COLUMN approval_message_id')
      database.exec('ALTER TABLE skill_learning_state DROP COLUMN attempts')
      database.exec("UPDATE meta SET value = '2' WHERE key = 'schema_version'")
    } finally {
      database.close()
    }
  }

  test('a v2 file migrates in place and keeps its rows', async () => {
    const { path } = await seeded('migrate-v2')
    downgradeToV2(path)
    const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
    const store = new SkillStore({ path })
    try {
      assert.equal(store.schemaVersion(), 3)
      const version = store.version(1)
      assert.ok(version, 'a v2 version row survives')
      assert.equal(version.approval_message_id, null)
      assert.equal(store.identity(1).current_version_id, 1, 'the pointer survives')
      const indexes = rows(path, "SELECT name FROM sqlite_master WHERE type = 'index'").map(row => row.name)
      assert.ok(indexes.includes('skill_version_growth_confirm_unique'), 'the growth-confirmation unique index is created')
      assert.ok(indexes.includes('skill_reuse_signal_by_revoked'), 'the revocation index is created')
      store.observeLearning({ sourceSession: 'migrated-session', lastClosedSeq: 2, lastClosedAt: 1 })
      assert.equal(store.learning('migrated-session').attempts, 0, 'the attempts column exists with its default')
    } finally {
      store.close()
    }
  })

  test('a v1 file upgrades through v2 to v3', async () => {
    const { path } = await seeded('migrate-v1')
    const database = new DatabaseSync(path)
    try {
      database.exec('DROP INDEX IF EXISTS skill_version_growth_confirm_unique')
      database.exec('DROP INDEX IF EXISTS skill_reuse_signal_by_revoked')
      database.exec('ALTER TABLE skill_version DROP COLUMN approval_message_id')
      database.exec('DROP TABLE skill_learning_state')
      database.exec('DROP TABLE skill_reuse_signal')
      database.exec('DROP TABLE skill_creation_job')
      database.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'")
    } finally {
      database.close()
    }
    const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
    const store = new SkillStore({ path })
    try {
      assert.equal(store.schemaVersion(), 3)
      assert.equal(store.identity(1).current_version_id, 1, 'the v1 row survives')
      assert.equal(store.learning('nobody'), undefined)
      store.observeLearning({ sourceSession: 'v1-upgraded', lastClosedSeq: 1, lastClosedAt: 2 })
      assert.equal(store.learning('v1-upgraded').attempts, 0)
      const indexes = rows(path, "SELECT name FROM sqlite_master WHERE type = 'index'").map(row => row.name)
      assert.ok(indexes.includes('skill_version_growth_confirm_unique'))
      assert.ok(indexes.includes('skill_reuse_signal_by_revoked'))
    } finally {
      store.close()
    }
  })

  test('the approval message is recorded and one growth confirmation settles one version', async () => {
    const { store } = await open('review-evidence')
    try {
      const first = store.createDraft(draft({ name: 'graded' }))
      store.publishDraft({
        versionId: first.versionId, packagePath: 'versions/1/one', reviewer: 7, reviewedAt: 1,
        ownerShortId: 7, defaultEnable: true, approvalMessageId: 'approval-message-1', recheck: () => true,
      })
      assert.equal(store.version(first.versionId).approval_message_id, 'approval-message-1')

      const grown = store.createDraft(draft({ name: 'graded', parentVersionId: first.versionId, growthExceeded: true }))
      store.publishDraft({
        versionId: grown.versionId, packagePath: 'versions/1/two', reviewer: 7, reviewedAt: 2,
        ownerShortId: 7, defaultEnable: true,
        confirmGrowth: { confirmedBy: 7, confirmedAt: 2, messageId: 'one-confirmation' },
        recheck: () => true,
      })
      assert.equal(store.version(grown.versionId).growth_confirm_message, 'one-confirmation')

      const again = store.createDraft(draft({ name: 'graded', parentVersionId: grown.versionId, growthExceeded: true }))
      assert.throws(() => store.publishDraft({
        versionId: again.versionId, packagePath: 'versions/1/three', reviewer: 7, reviewedAt: 3,
        ownerShortId: 7, defaultEnable: true,
        confirmGrowth: { confirmedBy: 7, confirmedAt: 3, messageId: 'one-confirmation' },
        recheck: () => true,
      }), /already confirmed/u, 'one user confirmation message cannot approve two growth candidates')
      assert.equal(store.version(again.versionId).status, 0, 'the conflicting publish rolls back')
    } finally {
      store.close()
    }
  })
})

describe('atomic learning settle and attempts', () => {
  test('fail/resume counts attempts and settle writes evidence and watermark in one transaction', async () => {
    const { store } = await open('learning-settle')
    try {
      assert.throws(() => store.settleLearning({
        sourceSession: 'missing', childSession: 'child', cutSeq: 1, ownerShortId: 7, signals: [],
      }), /interval/u, 'a session without the claimed interval cannot settle')

      store.observeLearning({ sourceSession: 'source', lastClosedSeq: 3, lastClosedAt: 10 })
      assert.equal(store.claimLearning({ sourceSession: 'source', cutSeq: 3, lastClosedAt: 10, childSession: 'child' }), true)
      assert.equal(store.failLearning({ sourceSession: 'source', childSession: 'child', retryDelayMs: 0 }), 1)
      assert.equal(store.failLearning({ sourceSession: 'source', childSession: 'child', retryDelayMs: 0 }), 2)
      assert.equal(store.learning('source').status, 2)
      assert.equal(store.learning('source').attempts, 2, 'a restart cannot reset the attempt budget')

      // A failed row is still the same child's interval; a different child or
      // cut may not settle it.
      assert.throws(() => store.settleLearning({
        sourceSession: 'source', childSession: 'other-child', cutSeq: 3, ownerShortId: 7, signals: [],
      }), /interval/u)
      assert.throws(() => store.settleLearning({
        sourceSession: 'source', childSession: 'child', cutSeq: 4, ownerShortId: 7, signals: [],
      }), /interval/u)

      const ids = store.settleLearning({
        sourceSession: 'source', childSession: 'child', cutSeq: 3, ownerShortId: 7,
        signals: [{ ownerShortId: 999, sourceSession: 'spoofed', taskKey: 'workflow:release', evidenceStartSeq: -1, evidenceEndSeq: 3, status: 0 }],
      })
      assert.equal(ids.length, 1)
      const signal = store.signal(ids[0])
      assert.equal(signal.owner_short_id, 7, 'the settle call owner is the authority')
      assert.equal(signal.source_session, 'source', 'the settle call source session is the authority')
      const settled = store.learning('source')
      assert.equal(settled.status, 0)
      assert.equal(settled.watermark_seq, 3)
      assert.equal(settled.cut_seq, 3)
      assert.equal(settled.attempts, 0)
      assert.equal(settled.retry_at, null)
    } finally {
      store.close()
    }
  })

  test('an exhausted interval is abandoned in place and reset starts a fresh budget', async () => {
    const { store } = await open('learning-abandon')
    try {
      store.observeLearning({ sourceSession: 'source', lastClosedSeq: 5, lastClosedAt: 10 })
      store.claimLearning({ sourceSession: 'source', cutSeq: 5, lastClosedAt: 10, childSession: 'child' })
      store.failLearning({ sourceSession: 'source', childSession: 'child', retryDelayMs: 0 })
      store.abandonLearning({ sourceSession: 'source', childSession: 'child', cutSeq: 5 })
      const abandoned = store.learning('source')
      assert.equal(abandoned.status, 3, 'the row is given up, not merely failed')
      assert.equal(abandoned.cut_seq, 5, 'the frozen cut is kept so only a newer closed turn releases it')
      assert.equal(abandoned.child_session, 'child')
      assert.equal(abandoned.attempts, 1)
      assert.equal(abandoned.retry_at, null)
      assert.throws(() => store.settleLearning({
        sourceSession: 'source', childSession: 'child', cutSeq: 5, ownerShortId: 7, signals: [],
      }), /interval/u, 'a given-up interval can never settle')

      store.resetLearning('source')
      const reset = store.learning('source')
      assert.equal(reset.status, 0)
      assert.equal(reset.cut_seq, null)
      assert.equal(reset.child_session, null)
      assert.equal(reset.attempts, 0)
    } finally {
      store.close()
    }
  })
})

describe('creation claim terminal state', () => {
  test('an exhausted claim ends terminal, consumes its evidence and lets newer evidence claim again', async () => {
    const { store } = await open('creation-terminal')
    try {
      const first = store.insertSignals([
        { ownerShortId: 7, sourceSession: 's1', taskKey: 'workflow:release', evidenceStartSeq: -1, evidenceEndSeq: 1, status: 0 },
        { ownerShortId: 7, sourceSession: 's2', taskKey: 'workflow:release', evidenceStartSeq: -1, evidenceEndSeq: 1, status: 0 },
      ])
      assert.equal(store.creationCandidates().length, 1)
      const claimed = store.claimCreationJob({ ownerShortId: 7, taskKey: 'workflow:release', childSession: 'child-1' })
      assert.equal(claimed.claimed, true)
      if (claimed.claimed !== true) return
      assert.equal(store.failCreationJob({ id: claimed.job.id, retryDelayMs: 0 }), true)
      assert.throws(() => store.abandonCreationJob({ id: claimed.job.id + 999 }), /failed claim/u)
      store.abandonCreationJob({ id: claimed.job.id })
      assert.equal(store.creationJob(claimed.job.id).state, 5, 'an exhausted claim settles as terminal')
      assert.equal(store.creationJob(claimed.job.id).next_retry_at, null)
      assert.equal(store.activeCreationJob(7, 'workflow:release'), undefined, 'a terminal claim does not block the key')
      assert.deepEqual(store.creationCandidates(), [], 'the terminal claim consumed the frozen evidence')

      const newer = store.insertSignals([
        { ownerShortId: 7, sourceSession: 's3', taskKey: 'workflow:release', evidenceStartSeq: 1, evidenceEndSeq: 2, status: 0 },
        { ownerShortId: 7, sourceSession: 's4', taskKey: 'workflow:release', evidenceStartSeq: 1, evidenceEndSeq: 2, status: 0 },
      ])
      assert.equal(store.creationCandidates().length, 1, 'newer evidence can claim again')
      const again = store.claimCreationJob({ ownerShortId: 7, taskKey: 'workflow:release', childSession: 'child-2' })
      assert.equal(again.claimed, true)
      if (again.claimed !== true) return
      assert.deepEqual(again.signalIds, newer, 'only the newer evidence contributes')
      assert.deepEqual(store.jobSignals(again.job).map(row => row.id), newer)
      assert.ok(first.length > 0)
    } finally {
      store.close()
    }
  })
})
