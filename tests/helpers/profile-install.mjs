/**
 * Shared observations for the profile-install lifecycle suites (#230/#231).
 *
 * Both suites read the launcher's install through the same surfaces: a named
 * doctor check, the linked bundle manifest inside an installed tree, and the
 * template a successful install publishes. Keeping those reads here means the
 * two suites cannot drift into asserting different template shapes.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The doctor check with this name, refusing a report that does not record it.
 * @param {{checks: Array<{name: string}>}} report - a parsed doctor report.
 * @param {string} name - the check to read.
 */
export function checkNamed(report, name) {
  const check = report.checks.find(entry => entry.name === name)
  assert.ok(check !== undefined, `doctor must record ${name}; it recorded ${JSON.stringify(report.checks.map(entry => entry.name))}`)
  return check
}

/**
 * The linked bundle manifest under one installed tree (a profile or a template).
 * @param {string} dir - the installed tree's root.
 * @param {string} bundlePackage - the product bundle package name.
 */
export function linkedBundleManifestPath(dir, bundlePackage) {
  return join(dir, 'node_modules', ...bundlePackage.split('/'), 'package.json')
}

/**
 * The one template a successful install published, checked against the contract
 * both install suites share: exactly one directory named by the source stamp the
 * install wrote and the pinned pnpm version, carrying the linked bundle manifest
 * that names the product bundle and the lockfile the install produced.
 * @param {{templateRoot: string, stamp: string, pnpmPin: string, bundlePackage: string}} options
 * @returns {{template: string, linkedManifest: string}} the template and the
 *   linked manifest it was checked for.
 */
export function assertPublishedTemplate({ templateRoot, stamp, pnpmPin, bundlePackage }) {
  assert.ok(existsSync(templateRoot), `a successful install must publish its template under ${templateRoot}`)
  const templates = readdirSync(templateRoot)
  assert.equal(templates.length, 1, `one install publishes one template: ${JSON.stringify(templates)}`)
  assert.equal(
    templates[0],
    `${stamp}-${pnpmPin}`,
    'the template directory must be named by the source stamp the install wrote and the pinned pnpm version',
  )
  const template = join(templateRoot, templates[0])
  const linkedManifest = linkedBundleManifestPath(template, bundlePackage)
  assert.ok(existsSync(linkedManifest), `the template must carry the linked bundle manifest: ${linkedManifest}`)
  assert.equal(
    JSON.parse(readFileSync(linkedManifest, 'utf8')).name,
    bundlePackage,
    'the template manifest must name the product bundle',
  )
  assert.ok(
    existsSync(join(template, 'pnpm-lock.yaml')),
    'the template must carry the lockfile the successful install produced',
  )
  return { template, linkedManifest }
}
