/**
 * The composition module's admission rules, asserted directly (ticket #156).
 *
 * The bundle manifest is the product package inventory: every dependency must
 * be a `file:` specifier, must resolve inside the repository, and must not name
 * the bundle or the probe (which are entries of their own). The launcher used to
 * be the only place those three rules ran, so a violation could only be observed
 * by driving `doctor --json` and reading its report. The composition module now
 * owns them, and these tests assert the thrown message names the rule that
 * rejected the manifest — the message text is the same one the launcher reports.
 *
 * Each test mutates a copied repository, so the worktree the rest of the suite
 * reads is never changed.
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { admitBundleDependencies, productPackages, readCombination } from '../scripts/ourfairy-composition.ts'
import { copyProductRepo, repoRoot } from './helpers/backend.mjs'

const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A throwaway product repository this file may mutate. */
function copiedRepo(label) {
  const root = copyProductRepo(`ourfairy-composition-${label}-`)
  roots.push(root)
  return root
}

/** Edit the copied bundle manifest in place. */
function editBundle(root, edit) {
  const path = join(root, 'backend', 'v1-bundle', 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  edit(manifest)
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
}

/** The message `productPackages` throws for the copied manifest. */
function admissionMessage(root) {
  try {
    productPackages(root)
  } catch (error) {
    return error.message
  }
  assert.fail(`the composition accepted an inadmissible bundle manifest at ${root}`)
}

test('a dependency that is not a file: specifier is refused by name and rule', () => {
  const root = copiedRepo('non-file')
  editBundle(root, (manifest) => {
    manifest.dependencies['@ourfairy/dsh-registry'] = '^1.0.0'
  })

  const message = admissionMessage(root)
  assert.match(message, /declares @ourfairy\/dsh-registry as "\^1\.0\.0"/)
  assert.match(message, /must declare each one as file:<path>/)
})

test('a dependency resolving outside the repository is refused by name and rule', () => {
  const root = copiedRepo('outside')
  editBundle(root, (manifest) => {
    manifest.dependencies['@ourfairy/dsh-outside'] = 'file:../../../outside-product'
  })

  const message = admissionMessage(root)
  assert.match(message, /declares @ourfairy\/dsh-outside at .*outside-product, which is outside this repository/)
  assert.match(message, /product packages live under backend\//)
})

test('the shared rule gives the worktree and installed shapes the same verdict', () => {
  const { bundlePackage, probePackage } = readCombination(repoRoot)
  const root = copiedRepo('shared-verdict')
  // The two shapes differ only in the bundle directory and the containment
  // root: the worktree bundle resolves `file:` paths from backend/v1-bundle
  // inside the repository; the installed bundle resolves the same declarations
  // from its profile copy inside the profile's node_modules.
  const shapes = {
    worktree: {
      bundleDir: join(root, 'backend', 'v1-bundle'),
      containmentRoot: root,
    },
    installed: {
      bundleDir: join(root, 'home', 'dsh-home', 'profiles', 'ourfairy', 'node_modules', '@ourfairy', 'dsh-v1-bundle'),
      containmentRoot: join(root, 'home', 'dsh-home', 'profiles', 'ourfairy', 'node_modules'),
    },
  }
  const cases = [
    {
      label: 'an admitted dependency',
      dependencies: { '@ourfairy/dsh-identity': 'file:../identity' },
      expected: { admitted: ['@ourfairy/dsh-identity'], refused: [] },
    },
    {
      label: 'a non-file: specifier',
      dependencies: { '@ourfairy/dsh-registry': '^1.0.0' },
      expected: { admitted: [], refused: [{ name: '@ourfairy/dsh-registry', rule: 'file' }] },
    },
    {
      label: 'a target outside the containment root',
      dependencies: { '@ourfairy/dsh-outside': 'file:../../../outside-product' },
      expected: { admitted: [], refused: [{ name: '@ourfairy/dsh-outside', rule: 'containment' }] },
    },
    {
      label: 'a dependency duplicating the bundle entry',
      dependencies: { [bundlePackage]: 'file:../v1-bundle' },
      expected: { admitted: [], refused: [{ name: bundlePackage, rule: 'duplicate' }] },
    },
    {
      label: 'a dependency duplicating the probe entry',
      dependencies: { [probePackage]: 'file:../probe' },
      expected: { admitted: [], refused: [{ name: probePackage, rule: 'duplicate' }] },
    },
  ]

  for (const { label, dependencies, expected } of cases) {
    for (const [shape, { bundleDir, containmentRoot }] of Object.entries(shapes)) {
      const { admitted, refused } = admitBundleDependencies({
        dependencies,
        bundleDir,
        containmentRoot,
        entries: [bundlePackage, probePackage],
      })
      const verdict = {
        admitted: admitted.map(entry => entry.name),
        refused: refused.map(entry => ({ name: entry.name, rule: entry.rule })),
      }
      assert.deepEqual(verdict, expected, `the ${shape} shape must judge ${label} the same way; it said ${JSON.stringify(verdict)}`)
    }
  }
})

test('a dependency duplicating the bundle or probe entry is refused by name and rule', () => {
  const { bundlePackage, probePackage } = readCombination(repoRoot)
  const entries = [[bundlePackage, 'file:../v1-bundle'], [probePackage, 'file:../probe']]
  for (const [name, specifier] of entries) {
    const root = copiedRepo('duplicate')
    editBundle(root, (manifest) => {
      manifest.dependencies[name] = specifier
    })

    const message = admissionMessage(root)
    assert.ok(
      message.includes(`declares ${name} twice: once as a bundle/probe entry and once in dependencies`),
      `the refusal must name ${name} and the duplicate rule; it said ${JSON.stringify(message)}`,
    )
  }
})
