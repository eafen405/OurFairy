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
import { after, test } from 'node:test'

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
