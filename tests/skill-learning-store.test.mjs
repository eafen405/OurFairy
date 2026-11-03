/**
 * Ticket #300 + the adverarial-review fix round: the background-learning store
 * without a backend.
 *
 * These are the fast seams for the facts a model double cannot force
 * deterministically: the schema ladder, the atomic creation claim (one job per
 * owner/task key), the immutable signal rows and the "valid success" rule that
 * a later revocation row never rewrites, the persisted detection attempt budget
 * and the atomic evidence+watermark settle. Expected values come from the
 * design (design.md D4/D21) and the review findings (B1/B3), not from re-running
 * the implementation.
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

test('schema v1 migrates to the current schema in place: v1 rows survive and the learning tables appear', async () => {
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
    assert.equal(store.schemaVersion(), 3, 'the ladder stamps the new version')
  } finally {
    store.close()
  }

  const facts = rows(path, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  assert.deepEqual(facts.map(row => row.name), [
    'meta', 'skill', 'skill_creation_job', 'skill_learning_state', 'skill_reuse_signal',
    'skill_user_preference', 'skill_version',
  ], 'the learning tables are the only tables added to the v1 file')
  assert.equal(rows(path, 'SELECT name FROM skill WHERE id = 1')[0].name, 'kept-skill', 'the identity survives')
  assert.equal(rows(path, 'SELECT manifest_hash FROM skill_version WHERE id = 1')[0].manifest_hash, 'hash', 'the version survives')
  assert.equal(rows(path, 'SELECT enabled FROM skill_user_preference WHERE short_id = 7')[0].enabled, 1, 'the preference survives')
  assert.equal(rows(path, "SELECT value FROM meta WHERE key = 'schema_version'")[0].value, '3')

  // The v3 columns and indexes are part of the same ladder: the detection
  // attempt budget (B1) and the revocation anti-join index (B7).
  const learningColumns = rows(path, 'PRAGMA table_info(skill_learning_state)').map(column => column.name)
  assert.ok(learningColumns.includes('attempts'), 'the detection attempt budget is persisted')
  const versionColumns = rows(path, 'PRAGMA table_info(skill_version)').map(column => column.name)
  assert.ok(versionColumns.includes('approval_message_id'), 'the approval evidence column exists')
  const indexes = rows(path, "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").map(row => row.name)
  assert.ok(indexes.includes('skill_reuse_signal_by_revoked'), 'the revocation anti-join has its partial index')

  // Reopening an already-migrated file is a no-op, not a second ladder step.
  const again = new SkillStore({ path })
  try {
    assert.equal(again.schemaVersion(), 3)
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
    assert.equal(store.failCreationJob({ id: claimed.job.id, retryDelayMs: 2_000 }), true)
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

    assert.equal(store.failLearning({ sourceSession: 'session-1', childSession: 'child-1', retryDelayMs: 2_000 }), 1,
      'one failed run is one spent attempt')
    const failed = store.learning('session-1')
    assert.equal(failed.status, 2)
    assert.equal(failed.attempts, 1)
    assert.ok(failed.retry_at > Date.now(), 'a failure records its retry time')
    assert.equal(failed.watermark_seq, -1, 'a failure keeps the watermark')
    assert.equal(failed.cut_seq, 10, 'a failure keeps the frozen cut')

    assert.equal(store.failLearning({ sourceSession: 'session-1', childSession: 'child-1', retryDelayMs: 2_000 }), 2,
      'the attempt count survives across failure reports')
    assert.equal(store.learning('session-1').attempts, 2)

    store.completeLearning({ sourceSession: 'session-1', cutSeq: 10, childSession: 'child-1' })
    const done = store.learning('session-1')
    assert.deepEqual([done.watermark_seq, done.status, done.attempts], [10, 0, 0],
      'a zero-signal completion advances the watermark and resets the attempt budget')

    store.resetLearning('session-1')
    const reset = store.learning('session-1')
    assert.deepEqual([reset.cut_seq, reset.child_session, reset.status, reset.watermark_seq, reset.attempts], [null, null, 0, 10, 0])
  } finally {
    store.close()
  }
})

test('the detection attempt budget persists and an exhausted interval enters the give-up state in place', async () => {
  const { store } = await open('give-up')
  try {
    assert.equal(store.claimLearning({ sourceSession: 'session-give-up', cutSeq: 30, lastClosedAt: 300, childSession: 'child-g' }), true)
    assert.equal(store.learning('session-give-up').attempts, 0, 'a fresh interval starts with an unspent budget')

    // The engine bounds the retry loop with this persisted count; a restart
    // reads the same number instead of starting the budget over.
    assert.equal(store.failLearning({ sourceSession: 'session-give-up', childSession: 'child-g', retryDelayMs: 2_000 }), 1)
    assert.equal(store.failLearning({ sourceSession: 'session-give-up', childSession: 'child-g', retryDelayMs: 2_000 }), 2)
    store.abandonLearning({ sourceSession: 'session-give-up', childSession: 'child-g', cutSeq: 30 })
    const gaveUp = store.learning('session-give-up')
    assert.deepEqual([gaveUp.status, gaveUp.attempts, gaveUp.cut_seq, gaveUp.child_session, gaveUp.retry_at],
      [3, 2, 30, 'child-g', null], 'a given-up interval keeps its cut, child and spent budget but never retries itself')
    assert.equal(gaveUp.watermark_seq, -1, 'giving up never advances the watermark')

    // A wrong cut/child is refused rather than corrupting another interval.
    assert.throws(() => store.abandonLearning({ sourceSession: 'session-give-up', childSession: 'child-g', cutSeq: 31 }),
      error => error?.code === 'skills/invalid-learning-state')
    assert.throws(() => store.failLearning({ sourceSession: 'session-give-up', childSession: 'other-child', retryDelayMs: 1_000 }),
      error => error?.code === 'skills/invalid-learning-state')

    // Only an explicit reset (a newer closed user turn) releases the source:
    // that reset also starts a new attempt budget and lets the next interval claim.
    store.resetLearning('session-give-up')
    const released = store.learning('session-give-up')
    assert.deepEqual([released.status, released.attempts, released.cut_seq], [0, 0, null])
    assert.equal(store.claimLearning({ sourceSession: 'session-give-up', cutSeq: 40, lastClosedAt: 400, childSession: 'child-h' }), true)
    assert.equal(store.learning('session-give-up').attempts, 0, 'a new interval starts with a fresh budget')
  } finally {
    store.close()
  }
})

test('settleLearning stores evidence and the watermark in one transaction, and a replay writes nothing', async () => {
  const { store } = await open('settle')
  try {
    const { SKILL_SCHEMA_VERSION } = await import('../backend/skill-creator/dist/store.js')
    assert.equal(SKILL_SCHEMA_VERSION, 3)
    store.claimLearning({ sourceSession: 'source-s', cutSeq: 20, lastClosedAt: 200, childSession: 'child-s' })
    const first = store.settleLearning({
      sourceSession: 'source-s',
      childSession: 'child-s',
      cutSeq: 20,
      ownerShortId: 7,
      signals: [signal({ sourceSession: 'source-s', taskKey: 'settle:one' }), signal({ sourceSession: 'source-s', taskKey: 'settle:two' })],
    })
    assert.equal(first.length, 2)
    const row = store.learning('source-s')
    assert.deepEqual([row.status, row.watermark_seq, row.cut_seq, row.attempts], [0, 20, 20, 0],
      'both the evidence and the advanced watermark are committed together')

    // A replay of the same settle (the restart path) is refused by the state
    // check, so the same evidence range can never be inserted twice.
    assert.throws(() => store.settleLearning({
      sourceSession: 'source-s',
      childSession: 'child-s',
      cutSeq: 20,
      ownerShortId: 7,
      signals: [signal({ sourceSession: 'source-s', taskKey: 'settle:one' })],
    }), error => error?.code === 'skills/invalid-learning-state')
    assert.equal(rows(join(root, 'settle', 'skill.sqlite'), 'SELECT * FROM skill_reuse_signal').length, 2,
      'the replay inserted nothing')
  } finally {
    store.close()
  }
})

test('a settle that fails its validation leaves neither evidence nor an advanced watermark behind', async () => {
  const { store } = await open('settle-crash')
  try {
    store.claimLearning({ sourceSession: 'source-c', cutSeq: 15, lastClosedAt: 150, childSession: 'child-c' })
    // The second signal is invalid (bad task key). insertSignals would refuse it
    // after the first row was written if the two writes were not one
    // transaction: the crash window B3 describes. Here the whole settle rolls
    // back, so a later retry can write the interval exactly once.
    assert.throws(() => store.settleLearning({
      sourceSession: 'source-c',
      childSession: 'child-c',
      cutSeq: 15,
      ownerShortId: 7,
      signals: [signal({ sourceSession: 'source-c' }), signal({ sourceSession: 'source-c', taskKey: 'Bad Key' })],
    }), error => error?.code === 'skills/invalid-task-key')
    const row = store.learning('source-c')
    assert.deepEqual([row.status, row.watermark_seq, row.cut_seq], [1, -1, 15],
      'a refused settle keeps the interval running with its watermark untouched')
    assert.equal(rows(join(root, 'settle-crash', 'skill.sqlite'), 'SELECT * FROM skill_reuse_signal').length, 0,
      'the refused settle inserted no partial evidence')

    // The failed settle keeps the same claim retryable: it fails, is resumed and
    // settles once. This is the crash window B3 describes (evidence written but
    // watermark not), proven impossible by the single transaction: the retry
    // stores each row exactly once and advances the watermark exactly once.
    assert.equal(store.failLearning({ sourceSession: 'source-c', childSession: 'child-c', retryDelayMs: 2_000 }), 1)
    assert.equal(store.learning('source-c').status, 2)
    const ids = store.settleLearning({
      sourceSession: 'source-c',
      childSession: 'child-c',
      cutSeq: 15,
      ownerShortId: 7,
      signals: [signal({ sourceSession: 'source-c' })],
    })
    assert.equal(ids.length, 1)
    const settled = store.learning('source-c')
    assert.deepEqual([settled.status, settled.watermark_seq, settled.attempts], [0, 15, 0])
    assert.equal(rows(join(root, 'settle-crash', 'skill.sqlite'), 'SELECT * FROM skill_reuse_signal').length, 1,
      'the retry wrote the interval exactly once')
  } finally {
    store.close()
  }
})

test('the creation retry wait doubles from two seconds and is capped at five minutes', async () => {
  const { creationRetryDelayMs, LEARNING_CREATION_ATTEMPTS, LEARNING_MAX_TURNS, CREATION_RETRY_MAX_MS } = await import('../backend/skill-creator/dist/learning-policy.js')
  assert.deepEqual(LEARNING_CREATION_ATTEMPTS, { default: 5, min: 1, max: 20 }, 'the creation attempt budget has one authority')
  assert.deepEqual(LEARNING_MAX_TURNS, { default: 4, min: 1, max: 20 }, 'the detection budget has one authority')
  assert.deepEqual([1, 2, 3, 4, 5].map(attempt => creationRetryDelayMs(attempt)), [2_000, 4_000, 8_000, 16_000, 32_000],
    'each failed creation run doubles the wait')
  assert.equal(creationRetryDelayMs(9), 300_000, 'the wait is capped at five minutes')
  assert.equal(creationRetryDelayMs(20), CREATION_RETRY_MAX_MS)
  assert.equal(creationRetryDelayMs(0), 2_000, 'a malformed attempt count still backs off instead of spinning')
})

test('the creation recheck drops a later-revoked signal and refuses a claim that no longer has two sessions', async () => {
  const { store } = await open('recheck')
  try {
    const { validJobSignals, creationThresholdHolds } = await import('../backend/skill-creator/dist/deep-creation.js')
    store.insertSignals([signal({ sourceSession: 'source-a' })])
    const revoked = store.insertSignals([signal({ sourceSession: 'source-b' })])
    const claimed = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-1' })
    assert.equal(claimed.claimed, true)

    // The correction lands after the claim; the claim row keeps its frozen ids
    // but the recheck must exclude the invalidated evidence.
    store.insertSignals([{
      ownerShortId: 7,
      taskKey: 'release-checklist:changelog',
      sourceSession: 'source-b',
      evidenceStartSeq: 11,
      evidenceEndSeq: 20,
      status: 3,
      revokesSignalId: revoked[0],
    }])
    const surviving = validJobSignals(store, claimed.job)
    assert.deepEqual(surviving.map(row => row.source_session), ['source-a'])
    assert.equal(creationThresholdHolds(surviving), false,
      'one surviving session after the correction no longer reaches the two-session threshold')

    // The claim itself already owns the key; a second claim is never created.
    assert.equal(store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-2' }).claimed, false)
  } finally {
    store.close()
  }
})

test('an exhausted claim becomes terminal: it consumes its evidence but no longer owns the key', async () => {
  const { store } = await open('terminal-claim')
  try {
    store.insertSignals([signal({ sourceSession: 'source-a' })])
    const [claimedSignal] = store.insertSignals([signal({ sourceSession: 'source-b' })])
    const claimed = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-1' })
    assert.equal(claimed.claimed, true)
    // The claim's last run failed and its budget is spent: the engine records
    // the failure and then the terminal state.
    assert.equal(store.failCreationJob({ id: claimed.job.id, retryDelayMs: 0 }), true)
    store.abandonCreationJob({ id: claimed.job.id })
    const terminal = store.creationJob(claimed.job.id)
    assert.deepEqual([terminal.state, terminal.next_retry_at], [5, null])
    // A terminal claim is not active: it blocks nothing.
    assert.equal(store.activeCreationJob(7, 'release-checklist:changelog'), undefined)
    // It still consumed its evidence: the same signals alone never re-trigger a
    // claim (the through id gates them), yet a later signal can.
    assert.equal(store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-2' }).claimed, false)
    assert.equal(store.creationCandidates().some(candidate => candidate.taskKey === 'release-checklist:changelog'), false)
    store.insertSignals([signal({ sourceSession: 'source-c' })])
    store.insertSignals([signal({ sourceSession: 'source-d' })])
    const next = store.claimCreationJob({ ownerShortId: 7, taskKey: 'release-checklist:changelog', childSession: 'child-3' })
    assert.equal(next.claimed, true, 'new evidence may claim again after a terminal claim')
    assert.ok(next.signalIds.every(id => id > claimedSignal), `only evidence newer than the terminal claim contributes: ${JSON.stringify(next.signalIds)}`)
  } finally {
    store.close()
  }
})
