/**
 * The `user:<shortId>` owner encoding has one home: identity's codec.
 *
 * `SessionHeader.owner` is the only ownership authority, so a module that picks
 * the encoding itself becomes a second authority: two spellings accept the same
 * strings only until one guard shifts, and a shifted guard is an authorization
 * decision, not a formatting one. Spellings that agree today cannot be told
 * apart by behavior, so the claim is pinned where the duplication lives —
 * product sources (`CODING_STANDARDS.md`: a claim that two things cannot
 * disagree needs a check that fails when they do). The behavior those modules
 * implement stays covered by the owned-sessions, delivery, spaces and
 * attachments suites.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

const backend = join(repoRoot, 'backend')
/** The one file allowed to spell the encoding. */
const CODEC = 'identity/src/owner.mjs'
/** The test-only liveness probe is not part of the product bundle; its literal names the seeded administrator. */
const PROBE = 'probe/'

/** Every product module source, minus the codec itself and the test-only probe. */
function productSources() {
  return readdirSync(backend, { recursive: true })
    .filter(path => /^[^/]+\/src\/.+\.mjs$/.test(path))
    .filter(path => path !== CODEC && !path.startsWith(PROBE))
    .sort()
}

const read = path => readFileSync(join(backend, path), 'utf8')

/** The writings that used to repeat the encoding outside the codec. */
const WRITINGS = [
  { pattern: /user:\$\{/, what: 'build the encoding with a template string' },
  { pattern: /\buser:[0-9]/, what: 'hardcode an encoded owner' },
  { pattern: /(['"`])user:\1/, what: "spell the 'user:' prefix as its own literal" },
  { pattern: /\^user:/, what: 're-implement the owner grammar as a regular expression' },
  { pattern: /\bowner\.(slice|substring|replace|split|match)\(/, what: 'parse an owner string by hand' },
]

test('the owner encoding is written only in identity\'s codec', () => {
  // Expected value is the encoding's one allowed home, not a second copy of it:
  // every other product module must ask ownerOf/shortIdOf (directly, or through
  // the spaces scope that does) instead of repeating either direction.
  assert.ok(productSources().length > 0, 'the scan must see product sources')
  for (const path of productSources()) {
    const source = read(path)
    for (const { pattern, what } of WRITINGS) {
      assert.doesNotMatch(source, pattern, `${path} must not ${what}; the owner codec owns that`)
    }
  }
})

test('ownership consumers take the encoding from the codec', () => {
  // Importing the codec is the deliverable itself: the names make a consumer's
  // owner handling searchable, and reading/writing a SessionHeader.owner without
  // them is exactly the drift this ticket removes.
  const consumers = [
    ['sessions/src/service.mjs', [/\bownerOf\(/]],
    ['chat/src/delivery.mjs', [/\bownerOf\(/, /\bshortIdOf\(/]],
    ['spaces/src/scope.mjs', [/\bshortIdOf\(/]],
  ]
  for (const [path, uses] of consumers) {
    const source = read(path)
    assert.match(source, /from '@ourfairy\/dsh-identity\/owner'/,
      `${path} must import the owner codec from @ourfairy/dsh-identity/owner`)
    for (const use of uses) assert.match(source, use, `${path} must resolve ownership through the codec`)
  }
})

test('callers use the short number the spaces scope returns, not a re-converted copy', () => {
  // The scope answers with the codec's short number; `Number(...)` over it is the
  // round-trip habit this ticket removes, and it hides a future change of type.
  for (const path of ['attachments/src/service.mjs', 'spaces/src/groups.mjs']) {
    assert.doesNotMatch(read(path), /Number\([^)]*(?:ourfairySpaces\.owner|scope\.owner)\(/,
      `${path} must use the short number the spaces scope returns`)
  }
})
