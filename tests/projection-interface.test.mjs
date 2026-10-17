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

/** Every name an `export` declaration in this module would publish. */
function publishedNames(source) {
  const declared = [...source.matchAll(/export\s+(?:const|let|var|function|class)\s+([\w$]+)/g)].map(match => match[1])
  const listed = [...source.matchAll(/export\s*(?:\{([^}]*)\}|\*)/g)].flatMap(match => match[1] === undefined
    ? ['*'] : match[1].split(',').map(entry => entry.trim().split(/\s+as\s+/).pop()).filter(Boolean))
  const defaulted = /export\s+default\b/.test(source) ? ['default'] : []
  return [...declared, ...listed, ...defaulted].sort()
}

test('projection publishes exactly its receipt and transcript seam', () => {
  assert.deepEqual(publishedNames(projectionSource), ['receiptIn', 'transcript'])
})
