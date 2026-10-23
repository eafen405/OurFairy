#!/usr/bin/env node
/**
 * Link the pinned dsh checkout, the product packages, and the shared toolchain
 * into a repository's root `node_modules`.
 *
 * This is not a package install: the links are generated from `combo.json` and
 * the product manifests, so the compiler resolves exactly the packages the
 * installed profile would. TypeScript is not a root devDependency — the
 * combination already pins the dsh checkout, and its build installs the
 * compiler — so the compiler version stays in the same authority as
 * `combo.json`.
 *
 * Only symlinks this script created are replaced: a real directory at the same
 * path was put there by something else and is left alone.
 *
 * Usage:
 *   node scripts/link-types.mjs            # link this repository's root
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readCombo, repoPath } from './combo.mjs'
import { productPackages } from './ourfairy-composition.mjs'

/** The repository this module lives in; the default root of every function. */
export const repoRoot = resolve(import.meta.dirname, '..')

/**
 * The dsh packages the checkout publishes: `packages/<group>/<name>` and
 * `vendor/<name>`.
 * @param {string} root - the dsh checkout.
 * @returns {string[]} absolute package directories.
 */
export function dshPackageDirs(root) {
  const dirs = []
  const packages = join(root, 'packages')
  for (const group of readdirSync(packages, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(packages, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(packages, group.name, entry.name)
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
    }
  }
  const vendor = join(root, 'vendor')
  for (const entry of readdirSync(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(vendor, entry.name)
    if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
  }
  return dirs
}

/**
 * One package's published name, read from its manifest.
 * @param {string} dir - absolute package directory.
 * @returns {string|undefined}
 */
function packageNameOf(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  return typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : undefined
}

/**
 * Put one symlink at `node_modules/<name>`.
 *
 * A link this script created is replaced; a real directory at that path was
 * put there by something else and is kept, so the build never deletes a
 * developer's own install.
 * @param {string} nodeModules - the farm's directory.
 * @param {string} name - the package name to publish.
 * @param {string} target - the absolute directory to link to.
 * @returns {boolean} whether the link was made.
 */
function linkInto(nodeModules, name, target) {
  const link = join(nodeModules, name)
  mkdirSync(dirname(link), { recursive: true })
  const existing = lstatSync(link, { throwIfNoEntry: false })
  if (existing !== undefined && !existing.isSymbolicLink()) {
    console.warn(`link-types: kept ${link}; it is a real directory this script did not create`)
    return false
  }
  if (existing !== undefined) rmSync(link, { force: true })
  symlinkSync(target, link, 'dir')
  return true
}

/**
 * Build the root `node_modules` link farm for one repository.
 *
 * The farm is a generated artifact: it is rebuilt rather than copied, because a
 * copied farm carries the machine paths of the checkout it was made in.
 * @param {string} [root] - repository root.
 * @returns {{linked: number, kept: number, nodeModules: string}} what was made.
 */
export function linkTypes(root = repoRoot) {
  const { combo } = readCombo(root)
  const dshDir = repoPath(combo, 'dsh', root)
  const nodeModules = join(root, 'node_modules')
  mkdirSync(nodeModules, { recursive: true })

  let linked = 0
  let kept = 0
  const link = (name, target) => {
    if (linkInto(nodeModules, name, target)) linked += 1
    else kept += 1
  }

  for (const dir of dshPackageDirs(dshDir)) {
    const name = packageNameOf(dir)
    if (name !== undefined) link(name, dir)
  }
  for (const { name, dir } of productPackages(root)) {
    link(name, join(root, dir))
  }
  for (const name of ['zod', '@types/node', 'typescript']) {
    const dir = join(dshDir, 'node_modules', name)
    if (existsSync(dir)) link(name, dir)
  }
  return { linked, kept, nodeModules }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { linked, kept, nodeModules } = linkTypes(repoRoot)
  console.log(`linked ${linked} package(s) into ${nodeModules}${kept > 0 ? `; kept ${kept} real directory/directories` : ''}`)
}
