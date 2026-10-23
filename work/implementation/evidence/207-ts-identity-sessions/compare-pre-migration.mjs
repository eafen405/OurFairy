/**
 * Compare the identity store before and after the TypeScript migration.
 *
 * OLD is `backend/identity/src/store.mjs` at BASELINE, the pre-migration tip
 * this ticket branched from. NEW is `backend/identity/dist/store.js`, built
 * from the ticket branch. Each case runs against its own temporary SQLite
 * file, so every case starts from the same empty state and the two stores are
 * compared on what they did and what they left in the row.
 *
 * Preconditions:
 *   - the product packages are built: `npm run clean && npm run build`;
 *   - `git` and `tar` are on PATH — the baseline tree is extracted with
 *     `git archive <baseline> backend/identity | tar -x`.
 *
 * The baseline tree and every SQLite file live in a temporary directory that is
 * removed when the run ends. This script writes nothing into the repository.
 *
 * Usage: node work/implementation/evidence/207-ts-identity-sessions/compare-pre-migration.mjs
 * Exit code 0 when every case behaves the same in both stores, 1 otherwise.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

/** The pre-migration baseline of this ticket. */
const BASELINE = '0b816e441b'

/** The repository root, four levels up from this file's directory. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')

/** The upload columns one lifecycle update may change. */
const COLUMNS = { status: 'status', offset: 'offset', original: 'original_ref', image: 'image_ref' }

/** Extract the baseline's identity package into a temporary directory. */
function extractBaseline() {
  const dir = mkdtempSync(join(tmpdir(), 'of207-baseline-'))
  const archive = execFileSync('git', ['archive', BASELINE, 'backend/identity'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', dir], { input: archive })
  return dir
}

const baselineDir = extractBaseline()
const { IdentityStore: OldStore } = await import(pathToFileURL(join(baselineDir, 'backend/identity/src/store.mjs')).href)
const { IdentityStore: NewStore } = await import(pathToFileURL(join(repoRoot, 'backend/identity/dist/store.js')).href)

/** One upload row, so the lifecycle update has a row to change. */
function insertUpload(store) {
  store.insertUpload({
    uploadId: 'u1', owner: 1, sessionId: 's1', name: 'n.txt', mime: 'text/plain',
    size: 1, sha256: 'deadbeef', status: 0, offset: 0,
    expiresAt: Date.now() + 60000, createdAt: 1, updatedAt: 1,
  })
}

/** What one upload update did, and what the row holds afterwards. */
function runUploadCase(Store, field, value) {
  const dir = mkdtempSync(join(tmpdir(), 'of207-case-'))
  const path = join(dir, 'identity.db')
  const store = new Store({ path })
  insertUpload(store)
  let outcome
  try {
    store.updateUpload('u1', { [field]: value })
    outcome = 'ok'
  } catch (error) {
    outcome = `threw ${error.constructor.name}: ${error.message}`
  }
  const column = COLUMNS[field]
  const db = new DatabaseSync(path)
  const row = db.prepare(`SELECT ${column} AS value, typeof(${column}) AS value_type FROM uploads WHERE upload_id = ?`).get('u1')
  db.close()
  rmSync(dir, { recursive: true, force: true })
  return { outcome, stored: `${JSON.stringify(row.value)} (sqlite typeof ${row.value_type})` }
}

/** What one delivery read did, for a row whose attachments_json is `json`. */
function runDeliveryCase(Store, json) {
  const dir = mkdtempSync(join(tmpdir(), 'of207-case-'))
  const path = join(dir, 'identity.db')
  const store = new Store({ path })
  const db = new DatabaseSync(path)
  db.prepare(`INSERT INTO deliveries
    (delivery_id,sender_short_id,sender_session_id,recipient_short_id,recipient_session_id,text,attachments_json,status,created_by,updated_by,created_at,updated_at)
    VALUES ('d1',1,'s1',2,'s2','hi',?,0,1,1,1,1)`).run(json)
  db.close()
  let outcome
  try {
    const pending = store.pendingDeliveries()
    outcome = `ok, returned ${pending.length} row(s), files = ${JSON.stringify(pending[0]?.files)}`
  } catch (error) {
    outcome = `threw ${error.constructor.name}: ${error.message}`
  }
  rmSync(dir, { recursive: true, force: true })
  return { outcome }
}

/** The value as it is written in a call, for the case label. */
function label(value) {
  if (value === undefined) return 'undefined'
  const encoded = JSON.stringify(value)
  return encoded === undefined ? `a ${typeof value}` : encoded
}

/** Every case this comparison runs. */
const CASES = [
  { group: 'upload lifecycle binding', field: 'status', value: '2' },
  { group: 'upload lifecycle binding', field: 'status', value: 'abc' },
  { group: 'upload lifecycle binding', field: 'status', value: null },
  { group: 'upload lifecycle binding', field: 'status', value: undefined },
  { group: 'upload lifecycle binding', field: 'offset', value: '2' },
  { group: 'upload lifecycle binding', field: 'offset', value: 'abc' },
  { group: 'upload lifecycle binding', field: 'offset', value: null },
  { group: 'upload lifecycle binding', field: 'offset', value: undefined },
  { group: 'upload reference binding', field: 'original', value: 'abc' },
  { group: 'upload reference binding', field: 'original', value: { a: 1 } },
  { group: 'upload reference binding', field: 'original', value: null },
  { group: 'upload reference binding', field: 'original', value: undefined },
  { group: 'upload reference binding', field: 'original', value: () => {} },
  { group: 'upload reference binding', field: 'image', value: 'abc' },
  { group: 'upload reference binding', field: 'image', value: undefined },
]

const DELIVERY_CASES = ['null', '{"a":1}', '[']

let group = ''
let differences = 0

for (const testCase of CASES) {
  if (testCase.group !== group) {
    group = testCase.group
    console.log(`\n=== ${group} ===`)
  }
  const old = runUploadCase(OldStore, testCase.field, testCase.value)
  const fresh = runUploadCase(NewStore, testCase.field, testCase.value)
  const same = old.outcome === fresh.outcome && old.stored === fresh.stored
  if (!same) differences += 1
  console.log(`\nupdateUpload({ ${testCase.field}: ${label(testCase.value)} })`)
  console.log(`  OLD: ${old.outcome} — stored ${testCase.field} = ${old.stored}`)
  console.log(`  NEW: ${fresh.outcome} — stored ${testCase.field} = ${fresh.stored}`)
  console.log(`  same: ${same ? 'yes' : 'NO'}`)
}

console.log('\n=== delivery read of a non-file-list attachments_json ===')
for (const json of DELIVERY_CASES) {
  const old = runDeliveryCase(OldStore, json)
  const fresh = runDeliveryCase(NewStore, json)
  const same = old.outcome === fresh.outcome
  if (!same) differences += 1
  console.log(`\nattachments_json = ${json}`)
  console.log(`  OLD: ${old.outcome}`)
  console.log(`  NEW: ${fresh.outcome}`)
  console.log(`  same: ${same ? 'yes' : 'NO'}`)
}

rmSync(baselineDir, { recursive: true, force: true })
console.log(`\ndifferences: ${differences}`)
process.exit(differences === 0 ? 0 : 1)
