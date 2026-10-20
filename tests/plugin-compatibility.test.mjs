/**
 * Product packages declare explicit semver peer ranges (ticket #98).
 *
 * A `workspace:` peer only resolves inside a pnpm workspace, and the generated
 * profile installs these packages through `file:` dependencies. A peer must
 * therefore be an explicit range naming the dsh version line the package was
 * built against.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

test('every product package declares an explicit semver peer range, not the workspace protocol', () => {
  const offenders = []
  for (const entry of readdirSync(join(repoRoot, 'backend'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join('backend', entry.name, 'package.json')
    if (!existsSync(join(repoRoot, path))) continue
    const peers = JSON.parse(readFileSync(join(repoRoot, path), 'utf8')).peerDependencies ?? {}
    for (const [name, range] of Object.entries(peers)) {
      if (typeof range !== 'string' || !/^\^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(range)) {
        offenders.push(`${path}: ${name} -> ${JSON.stringify(range)}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every peer must be an explicit caret range on the version line it was built against; offenders:${'\n'}${offenders.join('\n')}`,
  )
})
