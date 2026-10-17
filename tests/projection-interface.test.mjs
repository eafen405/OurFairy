/**
 * Interface contract for the chat projection module (ticket #67).
 *
 * `receiptIn` and `transcript` are the module's public seam; the text helpers
 * are internal. No backend module or test consumes the helpers, so exporting
 * them only widened the interface. A behaviour test cannot observe this — the
 * projection keeps working either way, which is exactly why this checks the
 * source, following the same reasoning as the reach-through check in
 * tests/conversation-search.test.mjs. The module cannot be imported standalone
 * here either: its `@deepseek-ai` peers only resolve inside the generated
 * profile, while its behaviour is already covered through the chat service.
 * The expected surface below comes from the interface decision, not from the
 * module's own export list.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const projectionSource = readFileSync(new URL('../backend/chat/src/projection.mjs', import.meta.url), 'utf8')

/**
 * Every name an `export` declaration in this module would publish.
 *
 * The declaration form is part of the surface: `export async function` and
 * `export function*` publish a name exactly like `export function` does, so the
 * pattern accepts the optional `async` and generator star instead of silently
 * skipping those declarations. `export default <expression>` publishes only
 * `default`, which is why the default form is counted separately.
 */
function publishedNames(source) {
  const declared = [...source.matchAll(
    /export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([\w$]+)/g,
  )].map(match => match[1])
  const listed = [...source.matchAll(/export\s*(?:\{([^}]*)\}|\*)/g)].flatMap(match => match[1] === undefined
    ? ['*'] : match[1].split(',').map(entry => entry.trim().split(/\s+as\s+/).pop()).filter(Boolean))
  const defaulted = /export\s+default\b/.test(source) ? ['default'] : []
  return [...declared, ...listed, ...defaulted].sort()
}

test('projection publishes exactly its receipt and transcript seam', () => {
  assert.deepEqual(publishedNames(projectionSource), ['receiptIn', 'transcript'])
})

test('the export parser sees async, generator, and class declarations', () => {
  // The expected names are written out here, not derived from the parser: this
  // fixture is the self-check that the seam assertion above cannot silently miss
  // a declaration form the module might adopt. `export async function` and
  // `export function*` were both invisible to the first parser, so converting
  // the seam to either shape would have left the surface check green.
  const fixture = [
    'export const a = 1',
    'export let b = 2',
    'export function c() {}',
    'export async function d() {}',
    'export function* e() {}',
    'export async function* f() {}',
    'export class G {}',
    'export { h, i as j }',
    'export default 1',
  ].join('\n')
  assert.deepEqual(publishedNames(fixture), ['G', 'a', 'b', 'c', 'd', 'default', 'e', 'f', 'h', 'j'])
})
