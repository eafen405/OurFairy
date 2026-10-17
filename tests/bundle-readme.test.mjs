/**
 * The v1 bundle README must not keep a row list of its own (ticket #47).
 *
 * Three facts exist about the v1 row set, and only two of them may be written
 * down twice:
 *
 * - which rows must be absent: `FORBIDDEN_ROW_IDS` in `baseline-boot.test.mjs`,
 *   the single expectation, asserted against the rows the probe reports;
 * - which rows the bundle mounts: `backend/v1-bundle/cordis.patch.yml`, read by
 *   the loader itself;
 * - what the README says: prose, which nothing executes.
 *
 * The README used to restate the absent rows by hand. That copy drifted into
 * claiming seven rows were absent while the bundle mounted them (#47) — the
 * same failure `backend/probe` avoids by refusing to keep a copy of the list.
 * The assertions below read the README as a document and compare its claims to
 * the two live sources, so the copy cannot come back and a stale row table
 * cannot stay green.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

const readmePath = join(repoRoot, 'backend', 'v1-bundle', 'README.md')
const bundlePath = join(repoRoot, 'backend', 'v1-bundle', 'cordis.patch.yml')
const baselineTestPath = join(repoRoot, 'tests', 'baseline-boot.test.mjs')

/** The bundle README, as a reader sees it. */
function readReadme() {
  return readFileSync(readmePath, 'utf8')
}

/**
 * The absent-row expectation, parsed out of the test that owns it.
 *
 * Parsed rather than imported so the check follows that file's list instead of
 * becoming a second copy of it: this test has no opinion of its own about which
 * rows are forbidden.
 * @returns {string[]}
 */
function readForbiddenRowIds() {
  const source = readFileSync(baselineTestPath, 'utf8')
  const block = /const FORBIDDEN_ROW_IDS = \[([\s\S]*?)\n\]/.exec(source)
  assert.ok(block, `tests/baseline-boot.test.mjs must declare FORBIDDEN_ROW_IDS; read:\n${source.slice(0, 400)}`)
  return [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1])
}

/**
 * The rows `cordis.patch.yml` actually mounts, as row id → package name.
 * @returns {Map<string, string>}
 */
function readMountedRows() {
  const rows = new Map()
  let current
  for (const line of readFileSync(bundlePath, 'utf8').split('\n')) {
    const id = /^\s*- id: (\S+)\s*$/.exec(line)
    if (id) {
      current = id[1]
      continue
    }
    const name = /^\s*name: '([^']+)'\s*$/.exec(line)
    if (name !== null && current !== undefined) rows.set(current, name[1])
  }
  return rows
}

/**
 * The README's "Row set" table, as the row ids and packages it names.
 * @returns {{id: string, package: string}[]}
 */
function readRowTable() {
  const section = readReadme().split('## Row set')[1]?.split('\n## ')[0] ?? ''
  return section.split('\n')
    .map(line => /^\| `([^`]+)` \| `([^`]+)` \|/.exec(line))
    .filter(match => match !== null)
    .map(match => ({ id: match[1], package: match[2] }))
}

/** The package short name a README table cell uses for a bundle `name:` value. */
function shortPackageName(name) {
  return name.replace(/^@[^/]+\//, '').split('/')[0]
}

/**
 * The README's backticked spans: where a document quotes a row id as an id.
 * Ordinary prose words ("skill", "sandbox") are not claims about rows, so the
 * check below only counts quoted ids.
 * @param {string} text
 * @returns {Set<string>}
 */
function quotedIds(text) {
  return new Set([...text.matchAll(/`([^`\n]+)`/g)].map(match => match[1]))
}

test('the bundle README defers the absent-row list to the test that owns it', () => {
  const readme = readReadme()

  // It must say where the expectation lives...
  assert.ok(
    readme.includes('tests/baseline-boot.test.mjs') && readme.includes('FORBIDDEN_ROW_IDS'),
    'backend/v1-bundle/README.md must name FORBIDDEN_ROW_IDS in tests/baseline-boot.test.mjs'
    + ' as the single absent-row expectation instead of restating the list',
  )

  // ...and must not restate it. No id from the expectation may be quoted as an
  // id, because the moment it is listed the two can disagree again.
  const quoted = quotedIds(readme)
  const restated = readForbiddenRowIds().filter(id => quoted.has(id))
  assert.deepEqual(
    restated,
    [],
    `backend/v1-bundle/README.md restates absent row(s) that FORBIDDEN_ROW_IDS already owns:`
    + ` ${restated.join(', ')} — point at the test instead of copying the list`,
  )
})

test('the bundle README row table names only rows the bundle mounts, with their package', () => {
  const mounted = readMountedRows()
  const table = readRowTable()

  assert.ok(table.length > 0, 'backend/v1-bundle/README.md must keep a "Row set" table of its anchor rows')

  const unmounted = table.filter(entry => !mounted.has(entry.id)).map(entry => entry.id)
  assert.deepEqual(
    unmounted,
    [],
    `backend/v1-bundle/README.md row table names row(s) cordis.patch.yml does not mount: ${unmounted.join(', ')}`,
  )

  const wrongPackage = table
    .filter(entry => shortPackageName(mounted.get(entry.id)) !== entry.package)
    .map(entry => `${entry.id}: README says ${entry.package}, bundle mounts ${mounted.get(entry.id)}`)
  assert.deepEqual(
    wrongPackage,
    [],
    `backend/v1-bundle/README.md row table states the wrong package:\n${wrongPackage.join('\n')}`,
  )
})
