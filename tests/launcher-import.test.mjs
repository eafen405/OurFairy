/**
 * Importing the launcher must be inert (ticket #156).
 *
 * `scripts/ourfairy-backend.mjs` used to run its CLI at module load: importing
 * it parsed argv, read combo.json, and exited. That made the module impossible
 * to import from a test (the test process would exit) and coupled every
 * composition fact to a subprocess. The launcher now guards its CLI behind
 * `import.meta.main`, so an in-process import is the seam that proves the guard
 * holds.
 *
 * The failure mode is the assertion: `node --test <file>` passes
 * `[node, <test file>]` as argv, so an unguarded launcher takes the help branch
 * and exits the test process with code 2 before this assertion runs.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('importing the launcher has no side effects and exposes main', async () => {
  const launcher = await import('../scripts/ourfairy-backend.mjs')
  assert.equal(
    typeof launcher.main,
    'function',
    'the launcher must export main(argv) so a caller can run it without the import itself being a CLI run',
  )
  assert.equal(typeof launcher.repoRoot, 'string', 'the launcher must keep exporting the repository root')
})
