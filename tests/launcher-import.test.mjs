/**
 * Importing the launcher must be inert (ticket #156).
 *
 * `scripts/ourfairy-backend.ts` used to run its CLI at module load: importing
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
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { copyProductRepo } from './helpers/backend.mjs'

test('importing the launcher has no side effects and exposes main', async () => {
  const launcher = await import('../scripts/ourfairy-backend.ts')
  assert.equal(
    typeof launcher.main,
    'function',
    'the launcher must export main(argv) so a caller can run it without the import itself being a CLI run',
  )
  assert.equal(typeof launcher.repoRoot, 'string', 'the launcher must keep exporting the repository root')
})

test('importing a launcher copy with no combo.json resolves and exposes main', async () => {
  // The guard is not merely "no exit": a module-load read of combo.json would
  // reject this import. Deleting the copy's combo.json makes that read fail,
  // so a successful import proves the load itself reads nothing.
  const root = copyProductRepo('ourfairy-launcher-import-')
  try {
    rmSync(join(root, 'combo.json'))
    const launcher = await import(pathToFileURL(join(root, 'scripts', 'ourfairy-backend.ts')).href)
    assert.equal(
      typeof launcher.main,
      'function',
      'the launcher must resolve and export main even when its checkout has no combo.json',
    )
    assert.equal(launcher.repoRoot, root, 'the imported copy must report its own repository root')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
