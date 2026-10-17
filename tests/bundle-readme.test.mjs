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
 * The README used to restate the absent rows by hand, and it also kept a
 * hand-written overview table of mounted rows. Both copies drifted: the absent
 * list claimed seven rows were missing while the bundle mounted them, and the
 * row table listed a subset of what `cordis.patch.yml` mounts (#47). The
 * assertions below hold the README to the two live authorities, so neither copy
 * can come back and stay green while going stale.
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
 * The README's "Row set" section, as a reader sees it.
 * @returns {string}
 */
function readRowSetSection() {
  return readReadme().split('## Row set')[1]?.split('\n## ')[0] ?? ''
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

test('the bundle README points at cordis.patch.yml instead of restating the row set', () => {
  const section = readRowSetSection()

  // It must say where the inventory lives...
  assert.ok(section.length > 0, 'backend/v1-bundle/README.md must keep a "Row set" section')
  assert.ok(
    section.includes('cordis.patch.yml'),
    'backend/v1-bundle/README.md must name cordis.patch.yml as the row set it describes',
  )

  // ...and must not restate it. A table is the copy that went stale (#47): the
  // README listed 15 rows while the bundle mounted 33, and nothing failed.
  assert.doesNotMatch(
    section,
    /^\s*\|/m,
    'backend/v1-bundle/README.md must not keep a row table: cordis.patch.yml is the row set,'
    + ' so point at it instead of copying a subset that can go stale',
  )

  // Nor a list of mounted row ids in prose: the section states where the
  // inventory lives, not what is in it.
  const quoted = quotedIds(section)
  const restated = [...readMountedRows().keys()].filter(id => quoted.has(id))
  assert.deepEqual(
    restated,
    [],
    `backend/v1-bundle/README.md restates mounted row(s) that cordis.patch.yml already owns:`
    + ` ${restated.join(', ')} — point at the file instead of copying the list`,
  )
})
