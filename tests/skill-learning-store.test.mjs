/**
 * Ticket #300: the background-learning store (schema v2) without a backend.
 *
 * These are the fast seams for the facts a model double cannot force
 * deterministically: the v1 → v2 ladder, the atomic creation claim (one job per
 * owner/task key), the immutable signal rows and the "valid success" rule that
 * a later revocation row never rewrites. Expected values come from the design
 * (design.md D4/D21), not from re-running the implementation.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'ourfairy-skill-learning-store-'))
after(() => rmSync(root, { recursive: true, force: true }))

/** The v1 schema exactly as #296 shipped it (a fresh file is migrated by the store). */
const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE skill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, scope INTEGER NOT NULL, owner_short_id INTEGER,
  current_version_id INTEGER, archived_at INTEGER, created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL, proposed_by INTEGER, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE skill_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id INTEGER NOT NULL, parent_version_id INTEGER,
  package_path TEXT NOT NULL, manifest TEXT NOT NULL, manifest_hash TEXT NOT NULL,
  core_characters INTEGER NOT NULL, license TEXT, source_type INTEGER NOT NULL,
  source_location TEXT, status INTEGER NOT NULL, verification TEXT,
  growth_exceeded INTEGER NOT NULL DEFAULT 0, growth_confirmed_by INTEGER,
  growth_confirmed_at INTEGER, growth_confirm_message TEXT, reviewer INTEGER,
  reviewed_at INTEGER, review_note TEXT, created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE skill_user_preference (
  id INTEGER PRIMARY KEY AUTOINCREMENT, short_id INTEGER NOT NULL, skill_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`

/** One fresh skill store in a temporary data root. */
async function open(name) {
  const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
  const directory = join(root, name)
  return { store: new SkillStore({ path: join(directory, 'skill.sqlite') }), directory }
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

/** One signal payload as the detection child submits it. */
let signalNo = 0
function signal(overrides = {}) {
  signalNo += 1
  return {
    ownerShortId: 7,
    taskKey: 'release-checklist:changelog',
    sourceSession: `source-${signalNo}`,
    evidenceStartSeq: 1,
    evidenceEndSeq: 10,
    status: 0,
    ...overrides,
  }
}

test('schema v1 migrates to v2 in place: v1 rows survive and the three learning tables appear', async () => {
  const directory = join(root, 'ladder')
  const path = join(directory, 'skill.sqlite')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(directory, { recursive: true })
  const seed = new DatabaseSync(path)
  try {
    seed.exec(V1)
    seed.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run()
    seed.prepare("INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at) VALUES ('kept-skill', 1, 7, 7, 7, 11, 11)").run()
    seed.prepare(`INSERT INTO skill_version
      (skill_id, package_path, manifest, manifest_hash, core_characters, source_type, status, created_by, created_at, updated_at)
      VALUES (1, 'versions/1/one', '[]', 'hash', 10, 0, 3, 7, 11, 11)`).run()
    seed.prepare('UPDATE skill SET current_version_id = 1 WHERE id = 1').run()
    seed.prepare('INSERT INTO skill_user_preference (short_id, skill_id, enabled, created_at, updated_at) VALUES (7, 1, 1, 11, 11)').run()
  } finally {
    seed.close()
  }

  const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
  const store = new SkillStore({ path })
  try {
    assert.equal(store.schemaVersion(), 2, 'the ladder stamps the new version')
  } finally {
    store.close()
  }

  const facts = rows(path, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  assert.deepEqual(facts.map(row => row.name), [
    'meta', 'skill', 'skill_creation_job', 'skill_learning_state', 'skill_reuse_signal',
    'skill_user_preference', 'skill_version',
  ], 'schema v2 adds exactly the three learning tables')
  assert.equal(rows(path, 'SELECT name FROM skill WHERE id = 1')[0].name, 'kept-skill', 'the identity survives')
  assert.equal(rows(path, 'SELECT manifest_hash FROM skill_version WHERE id = 1')[0].manifest_hash, 'hash', 'the version survives')
  assert.equal(rows(path, 'SELECT enabled FROM skill_user_preference WHERE short_id = 7')[0].enabled, 1, 'the preference survives')
  assert.equal(rows(path, "SELECT value FROM meta WHERE key = 'schema_version'")[0].value, '2')

  // Reopening an already-migrated file is a no-op, not a second ladder step.
  const again = new SkillStore({ path })
  try {
    assert.equal(again.schemaVersion(), 2)
  } finally {
    again.close()
  }
})

test('a revoked success is never a valid success, and the original evidence row is not rewritten', async () => {
  const { store } = await open('revocation')
  try {
    const [successId] = store.insertSignals([signal({ taskKey: 'release-checklist:changelog' })])
    assert.deepEqual(store.validSuccessSignals(7, 'release-checklist:changelog').map(row => row.id), [successId])

    // The correction arrives in a later interval of the same source session.
    const [revocationId] = store.insertSignals([{
      ownerShortId: 7,
      taskKey: 'release-checklist:changelog',
      sourceSession: 'source-1',
      evidenceStartSeq: 11,
      evidenceEndSeq: 20,
      status: 3,
      revokesSignalId: successId,
    }])
    assert.notEqual(revocationId, successId, 'a revocation is a new row')
    const original = store.signal(successId)
    assert.equal(original.status, 0, 'the original status is not rewritten')
    assert.equal(original.evidence_end_seq, 10, 'the original evidence range is not rewritten')
    assert.deepEqual(store.validSuccessSignals(7, 'release-checklist:changelog'), [])
    assert.deepEqual(store.validSuccessSignals(8, 'release-checklist:changelog'), [], 'another owner never sees it')

    // A revocation of a signal from another owner is refused by the claim path.
    const [otherOwner] = store.insertSignals([signal({ ownerShortId: 8 })])
    assert.throws(() => store.insertSignals([{
      ownerShortId: 7,
      taskKey: 'release-checklist:changelog',
      sourceSession: 'source-1',
      evidenceStartSeq: 21,
      evidenceEndSeq: 30,
      status: 3,
      revokesSignalId: otherOwner,
    }]), error => error?.code === 'skills/invalid-revocation')
  } finally {
    store.close()
  }
})

test('the creation claim is atomic and one owner/task key has at most one active or retrying job', async () => {
  const { store } = await open('claim')
  try {
    const first = store.insertSignals([signal({ sourceSession: 'source-a' })])
    const second = store.insertSignals([signal({ sourceSession: 'source-a' })])
    // Two successes in one session are still one independent session: no claim.
    assert.equal(store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-1' }).claimed, false)

    const third = store.insertSignals([signal({ sourceSession: 'source-b' })])
    const claimed = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-1' })
    assert.equal(claimed.claimed, true, `two distinct sessions must claim: ${JSON.stringify(claimed)}`)
    assert.deepEqual(claimed.signalIds.sort((left, right) => left - right),
      [...first, ...second, ...third].sort((left, right) => left - right))
    assert.equal(claimed.job.state, 1)
    assert.equal(claimed.job.through_signal_id, Math.max(...first, ...second, ...third))
    assert.equal(claimed.job.attempts, 1)

    // The same instant's second evaluation sees the claim and does nothing.
    const again = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-2' })
    assert.equal(again.claimed, false)
    assert.equal(again.reason, 'busy')
    assert.equal(rows(join(root, 'claim', 'skill.sqlite'), 'SELECT * FROM skill_creation_job').length, 1)

    // A failed job still owns the key: a retry resumes it instead of a second claim.
    assert.equal(store.failCreationJob({ id: claimed.job.id }), true)
    assert.equal(store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-3' }).claimed, false)
    assert.equal(store.resumeCreationJob({ id: claimed.job.id }), true)
    assert.equal(store.creationJob(claimed.job.id).attempts, 2)

    // Another owner's identical task key is independent.
    store.insertSignals([signal({ ownerShortId: 8, sourceSession: 'source-c' })])
    store.insertSignals([signal({ ownerShortId: 8, sourceSession: 'source-d' })])
    assert.equal(store.claimCreationJob({ ownerShortId: 8, taskKey: 'release-checklist:changelog', childSession: 'child-4' }).claimed, true)
  } finally {
    store.close()
  }
})

test('a completed job gates the next claim: only signals newer than its through id count', async () => {
  const { store } = await open('through')
  try {
    const first = store.insertSignals([signal({ sourceSession: 'source-a' })])
    const second = store.insertSignals([signal({ sourceSession: 'source-b' })])
    const claimed = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-1' })
    assert.equal(claimed.claimed, true)
    store.completeCreationJob({ id: claimed.job.id, state: 3 })
    const through = Math.max(...first, ...second)
    assert.equal(store.lastCompletedCreationJob(7, 'release-checklist:changelog').through_signal_id, through)

    // The same evidence cannot trigger a second creation.
    assert.equal(store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-2' }).claimed, false)
    // Only one new session is not yet two independent sessions.
    store.insertSignals([signal({ sourceSession: 'source-c' })])
    assert.equal(store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-3' }).claimed, false)
    // A second new session, on top of the completed history, is the next interval.
    store.insertSignals([signal({ sourceSession: 'source-d' })])
    const next = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-4' })
    assert.equal(next.claimed, true)
    assert.ok(next.signalIds.every(id => id > through), `only newer signals contribute: ${JSON.stringify(next.signalIds)}`)
  } finally {
    store.close()
  }
})

test('the owner task-key list is bounded and the grammar accepts <type>:<artifact> kebab-case only', async () => {
  const { store } = await open('task-keys')
  try {
    const { MAX_EXISTING_TASK_KEYS, isValidTaskKey, TASK_KEY_MAX_CHARACTERS } = await import('../backend/skill-creator/dist/learning-policy.js')
    for (let index = 0; index < MAX_EXISTING_TASK_KEYS + 5; index += 1) {
      store.insertSignals([signal({ ownerShortId: 7, taskKey: `task-${index}:artifact`, sourceSession: `source-${index}` })])
    }
    const keys = store.taskKeys(7, MAX_EXISTING_TASK_KEYS)
    assert.equal(keys.length, MAX_EXISTING_TASK_KEYS, 'the prompt list is bounded')
    assert.equal(keys[0], `task-${MAX_EXISTING_TASK_KEYS + 4}:artifact`, 'newest key first')
    assert.deepEqual(store.taskKeys(8, MAX_EXISTING_TASK_KEYS), [], 'another owner has no keys')

    for (const key of ['release:changelog', 'bug-fix:release-notes', 'a:b']) assert.equal(isValidTaskKey(key), true, key)
    for (const key of ['', 'release', ':changelog', 'release:', 'Release:changelog', 'release:Change Log', 'release:changelog:extra',
      'release:changelog ', 'r'.repeat(TASK_KEY_MAX_CHARACTERS), `a-${'b'.repeat(TASK_KEY_MAX_CHARACTERS)}:c`]) {
      assert.equal(isValidTaskKey(key), false, JSON.stringify(key))
    }
  } finally {
    store.close()
  }
})

test('a learning state freezes one cut and one child, and no failure advances the watermark', async () => {
  const { store } = await open('learning-state')
  try {
    assert.equal(store.claimLearning({ sourceSession: 'session-1', cutSeq: 10, lastClosedAt: 100, childSession: 'child-1' }), true)
    assert.equal(store.claimLearning({ sourceSession: 'session-1', cutSeq: 20, lastClosedAt: 200, childSession: 'child-2' }), false,
      'a running interval is never claimed twice')
    const running = store.learning('session-1')
    assert.deepEqual([running.watermark_seq, running.cut_seq, running.status, running.child_session], [-1, 10, 1, 'child-1'])

    store.failLearning({ sourceSession: 'session-1', childSession: 'child-1' })
    const failed = store.learning('session-1')
    assert.equal(failed.status, 2)
    assert.equal(failed.watermark_seq, -1, 'a failure keeps the watermark')
    assert.equal(failed.cut_seq, 10, 'a failure keeps the frozen cut')

    store.completeLearning({ sourceSession: 'session-1', cutSeq: 10, childSession: 'child-1' })
    const done = store.learning('session-1')
    assert.deepEqual([done.watermark_seq, done.status], [10, 0], 'a zero-signal completion advances the watermark')

    store.resetLearning('session-1')
    const reset = store.learning('session-1')
    assert.deepEqual([reset.cut_seq, reset.child_session, reset.status, reset.watermark_seq], [null, null, 0, 10])
  } finally {
    store.close()
  }
})
