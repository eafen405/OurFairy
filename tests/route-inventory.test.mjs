/**
 * Ticket #272: the product HTTP surface is one exported inventory per row.
 *
 * The same 38 addresses used to be restated five ways — path literals in each
 * row, the boundary doc's path table, a six-address fence test, and the actual
 * registration. This file reads the inventory the rows export (`SURFACE`) and
 * fixes the facts the next mounting step needs: the count, the row and prefix
 * grouping, the method/body/response matrix, and the path constants each row
 * already publishes. It deliberately holds no path list of its own; a copy
 * would be a second authority and would keep passing after the mounted address
 * moved.
 *
 * Whether an address is actually registered is proven against the running
 * backend by `tests/identity-http.test.mjs`, which derives its untrusted-Host
 * cases from these same exports; a published address that no row mounted would
 * answer 404 there instead of the fence's 403.
 *
 * @covers backend/http — the shared `SurfaceEntry` shape and `freezeSurface`.
 * @covers backend/identity, backend/sessions, backend/chat, backend/gateway,
 * backend/memory, backend/attachments, backend/speech — each row's published
 * table and the handler table it builds.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'
import { IDENTITY_PATHS, SURFACE as IDENTITY_SURFACE } from '../backend/identity/dist/index.js'
import { identityHandlers } from '../backend/identity/dist/routes.js'
import {
  SESSION_PATHS, SESSION_RENAME_PATH, SURFACE as SESSIONS_SURFACE,
} from '../backend/sessions/dist/index.js'
import { sessionHandlers } from '../backend/sessions/dist/http.js'
import { SURFACE as CHAT_SURFACE } from '../backend/chat/dist/index.js'
import { GATEWAY_PATHS, SURFACE as GATEWAY_SURFACE } from '../backend/gateway/dist/index.js'
import { gatewayHandlers } from '../backend/gateway/dist/http.js'
import { IMPRESSION_PATHS, SURFACE as IMPRESSION_SURFACE } from '../backend/memory/dist/index.js'
import { impressionHandlers } from '../backend/memory/dist/impression.js'
import { SURFACE as ATTACHMENTS_SURFACE } from '../backend/attachments/dist/index.js'
import { SURFACE as SPEECH_SURFACE } from '../backend/speech/dist/index.js'

/** Each row in package order, with the surface that package publishes. */
const ROWS = [
  ['identity', IDENTITY_SURFACE],
  ['sessions', SESSIONS_SURFACE],
  ['chat', CHAT_SURFACE],
  ['gateway', GATEWAY_SURFACE],
  ['memory', IMPRESSION_SURFACE],
  ['attachments', ATTACHMENTS_SURFACE],
  ['speech', SPEECH_SURFACE],
]

/** Every published address, tagged with the row that serves it. */
const ALL = ROWS.flatMap(([row, surface]) => surface.map(entry => ({ row, ...entry })))

/** The entry fields, exactly; an added or missing field is a shape change. */
const FIELDS = ['auth', 'body', 'method', 'path', 'prefix', 'response']

const AUTH = ['fence', 'authentication', 'ownership', 'role']
const BODY = ['json', 'binary', 'none']
const RESPONSE = ['json', 'sse', 'binary']

/**
 * Count occurrences of each value.
 * @param {string[]} values
 * @returns {Record<string, number>}
 */
function countsOf(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

/**
 * The method/body/response matrix one row serves.
 *
 * Read from the row's own request handling, not from this file's copy of a
 * path: the identity, session, chat, gateway, memory, propose, complete and
 * download handlers all go through `postHandler` (JSON body, JSON response);
 * `/attachments/chunk` reads octet-stream bytes, `/attachments/download` writes
 * the original bytes, `/chat/observe` writes SSE, `/speech` is the one GET,
 * and `/speech/transcriptions` reads audio bytes. The counts are the acceptance
 * facts for the 35 JSON-after-fence addresses and the three handwritten ones.
 */
const MATRIX = {
  identity: { 'POST/json/json': 6 },
  sessions: { 'POST/json/json': 7 },
  chat: { 'POST/json/json': 9, 'POST/json/sse': 1 },
  gateway: { 'POST/json/json': 7 },
  memory: { 'POST/json/json': 2 },
  attachments: { 'POST/json/json': 2, 'POST/binary/json': 1, 'POST/json/binary': 1 },
  speech: { 'GET/none/json': 1, 'POST/binary/json': 1 },
}

test('the seven rows publish 38 unique addresses, read-only and grouped as declared', () => {
  assert.equal(ALL.length, 38, 'the product HTTP surface is 38 addresses')
  assert.equal(new Set(ALL.map(entry => entry.path)).size, 38, 'every published path is unique')

  for (const [row, surface] of ROWS) {
    assert.ok(Object.isFrozen(surface), `${row} must publish its SURFACE as a read-only array`)
    for (const entry of surface) {
      assert.ok(Object.isFrozen(entry), `${row}'s ${entry.path} entry must be read-only too`)
      assert.deepEqual(Object.keys(entry).sort(), FIELDS, `${row}'s entries carry exactly the surface fields`)
      assert.ok(entry.path.startsWith('/'), `${row} publishes an absolute path: ${entry.path}`)
      assert.equal(entry.path.split('/')[1], entry.prefix,
        `${entry.path} must answer under its own error prefix ${entry.prefix}`)
      assert.ok(AUTH.includes(entry.auth), `${entry.path} declares a known admission: ${entry.auth}`)
      assert.ok(BODY.includes(entry.body), `${entry.path} declares a known request body: ${entry.body}`)
      assert.ok(RESPONSE.includes(entry.response), `${entry.path} declares a known response: ${entry.response}`)
    }
  }

  assert.deepEqual(countsOf(ALL.map(entry => entry.row)), {
    identity: 6, sessions: 7, chat: 10, gateway: 7, memory: 2, attachments: 4, speech: 2,
  }, 'the rows must publish the declared number of addresses')

  // The chat row owns nine chat addresses and serves the session family's one
  // rename address; the prefix counts therefore differ from the row counts.
  assert.deepEqual(countsOf(CHAT_SURFACE.map(entry => entry.prefix)), { chat: 9, sessions: 1 },
    'the chat row publishes nine chat addresses and the one session rename')
  assert.deepEqual(countsOf(ALL.map(entry => entry.prefix)), {
    identity: 6, sessions: 8, chat: 9, gateway: 7, impression: 2, attachments: 4, speech: 2,
  }, 'the error-prefix grouping is the one the addresses answer with')

  const renames = CHAT_SURFACE.filter(entry => entry.prefix === 'sessions')
  assert.deepEqual(renames.map(entry => entry.path), [SESSION_RENAME_PATH],
    'the chat row serves the rename path the session row exports')
})

test('each row serves the method/body/response matrix it publishes', () => {
  for (const [row, surface] of ROWS) {
    assert.deepEqual(
      countsOf(surface.map(entry => `${entry.method}/${entry.body}/${entry.response}`)),
      MATRIX[row],
      `${row} must serve exactly the matrix its addresses declare`,
    )
  }

  assert.deepEqual(countsOf(ALL.map(entry => entry.method)), { POST: 37, GET: 1 },
    'every address is POST except the speech availability read')
  assert.deepEqual(countsOf(ALL.map(entry => entry.body)), { json: 35, binary: 2, none: 1 },
    '35 addresses read a JSON object; chunk and transcriptions read raw bytes; the GET reads none')
  assert.deepEqual(countsOf(ALL.map(entry => entry.response)), { json: 36, sse: 1, binary: 1 },
    'every address answers JSON except the SSE and download responses')
})

test('the handler table each row builds holds exactly its published addresses, in order', () => {
  const fence = () => undefined
  const tables = [
    ['identity', IDENTITY_SURFACE, identityHandlers({ service: {}, store: {}, fence })],
    ['sessions', SESSIONS_SURFACE, sessionHandlers({ service: {}, fence })],
    ['gateway', GATEWAY_SURFACE, gatewayHandlers({ service: {}, authenticate: () => undefined, fence })],
    ['memory', IMPRESSION_SURFACE,
      impressionHandlers({ service: {}, authenticate: () => undefined, fence })],
  ]
  for (const [row, surface, handlers] of tables) {
    assert.deepEqual([...handlers.keys()], surface.map(entry => entry.path),
      `${row}'s handler table must hold exactly the published addresses, in registration order`)
  }
})

test('the paths each row already exported are the same list as its surface', () => {
  assert.deepEqual([...IDENTITY_PATHS], IDENTITY_SURFACE.map(entry => entry.path))
  assert.deepEqual([...SESSION_PATHS], SESSIONS_SURFACE.map(entry => entry.path))
  assert.deepEqual([...GATEWAY_PATHS], GATEWAY_SURFACE.map(entry => entry.path))
  assert.deepEqual([...IMPRESSION_PATHS], IMPRESSION_SURFACE.map(entry => entry.path))
})

test('the boundary doc points at this inventory', () => {
  const doc = readFileSync(join(repoRoot, 'docs', 'architecture', 'dsh-ecosystem-boundary.md'), 'utf8')
  const row = doc.split('\n').find(line => line.startsWith('| 路径 |'))
  assert.ok(row !== undefined, 'the boundary doc keeps its transport path row')
  assert.ok(row.includes('tests/route-inventory.test.mjs'),
    `the path row must point at this inventory; got: ${row}`)
})
