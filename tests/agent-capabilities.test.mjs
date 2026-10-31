/**
 * Ticket #279: one named predicate replaces the scattered maintenance-preset
 * checks in the product tool rows.
 *
 * The two agents that exist today must keep their current default: a user's own
 * session gets the product tool surface, a memory maintenance child gets only
 * what memory grants it. The two shapes that do not exist yet are pinned too:
 * an owned child and an ownerless, preset-less agent are not user sessions, so
 * they default to no product tools until a creator grants them.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { ownerOf } = await import('../backend/identity/dist/owner.js')
const { isUserSession } = await import('../backend/identity/dist/session.js')

/** The durable preset id a memory maintenance child carries (the memory row owns it). */
const MAINTENANCE_PRESET = 'ourfairy:memory-maintenance'

test('only an owned, top-level, preset-less session is a user session', () => {
  const cases = [
    ['user session', { owner: ownerOf(7) }, true],
    ['maintenance child', { parentSession: 'source-session', agentPreset: MAINTENANCE_PRESET }, false],
    ['owned child', { owner: ownerOf(7), parentSession: 'source-session' }, false],
    ['ownerless, preset-less', {}, false],
    ['owned preset session', { owner: ownerOf(7), agentPreset: 'future-agent' }, false],
    ['missing header', undefined, false],
  ]
  for (const [label, header, expected] of cases) {
    assert.equal(
      isUserSession(header),
      expected,
      `${label} must ${expected ? '' : 'not '}be a user session: ${JSON.stringify(header)}`,
    )
  }
})
