/**
 * The Android client's provenance is part of the version combination (#123).
 *
 * `combo.json` records where the imported snapshot came from, and `verify`
 * compares that record with the in-repo declaration under `android/`. These
 * tests drive `verifyCombination` at its public seam, so a missing or drifted
 * declaration must surface as a failure row rather than an uncaught exception.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { repoRoot, verifyCombination } from '../scripts/combo.ts'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const declared = JSON.parse(readFileSync(join(repoRoot, combo.androidSource.declaration), 'utf8'))
const tempRoots = []

/** A temporary repository root holding only the combination's inputs. */
function tempRoot({ declaration } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-android-source-'))
  tempRoots.push(root)
  copyFileSync(join(repoRoot, 'combo.json'), join(root, 'combo.json'))
  if (declaration !== undefined) {
    mkdirSync(join(root, 'android'))
    writeFileSync(join(root, 'android', 'ourfairy-source.json'), `${JSON.stringify({
      repository: 'https://github.com/eafen405/rikkahub',
      branch: 'product/ourfairy-v1',
      commit: declaration,
      note: 'test declaration',
    }, undefined, 2)}\n`)
  }
  return root
}

function androidRow(result) {
  const row = result.rows.find(entry => entry.key === 'android source')
  assert.ok(row, `verify produced no "android source" row: ${JSON.stringify(result.rows.map(entry => entry.key))}`)
  return row
}

after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true })
})

test('the repo cycle covers only the product repository and dsh', () => {
  assert.deepEqual(Object.keys(combo.repos).sort(), ['dsh', 'ourfairy'])
})

test('the checked-in declaration is the source commit the combination records', () => {
  const row = androidRow(verifyCombination())
  assert.equal(row.expected, declared.commit, 'the locked commit must be the commit the declaration records')
  assert.equal(row.actual, declared.commit, 'verify must read the commit from the in-repo declaration')
  assert.equal(row.ok, true, `the checked-in declaration must match combo.json: ${row.failure ?? '(no failure)'}`)
})

test('a declaration that drifts from the combination fails and names the path and both commits', () => {
  const drifted = 'ffffffffffffffffffffffffffffffffffffffff'
  const root = tempRoot({ declaration: drifted })
  const row = androidRow(verifyCombination({ root }))
  const path = resolve(root, combo.androidSource.declaration)
  assert.equal(row.ok, false, 'a declaration commit other than the locked one must fail verification')
  assert.equal(row.actual, drifted, 'the row must report the commit the declaration holds')
  assert.ok(row.failure.includes(path), `the failure must name the declaration path ${path}; it was: ${row.failure}`)
  assert.ok(row.failure.includes(drifted), `the failure must name the declared commit ${drifted}; it was: ${row.failure}`)
  assert.ok(
    row.failure.includes(combo.androidSource.commit),
    `the failure must name the locked commit ${combo.androidSource.commit}; it was: ${row.failure}`,
  )
})

test('a missing declaration fails and names the missing path', () => {
  const root = tempRoot()
  const row = androidRow(verifyCombination({ root }))
  const path = resolve(root, combo.androidSource.declaration)
  assert.equal(row.ok, false, 'a missing declaration must fail verification')
  assert.ok(row.failure.includes(path), `the failure must name the missing path ${path}; it was: ${row.failure}`)
})

test('the client build output and local build inputs stay out of the repository', () => {
  // The README promises these are local files; the rules that make that true sit
  // under android/, and this file's root rules are the backstop. Checking the
  // effect rather than either file means a changed snapshot rule fails here.
  const paths = [
    'android/local.properties',
    'android/app/google-services.json',
    'android/build/x',
    'android/app/build/x',
    'android/.gradle/x',
    'android/.kotlin/x',
    'android/app/build/outputs/apk/release/app-x86_64-release.apk',
  ]
  const unignored = paths.filter((path) => {
    try {
      execFileSync('git', ['check-ignore', '--quiet', path], { cwd: repoRoot })
      return false
    } catch {
      return true
    }
  })
  assert.deepEqual(unignored, [], `these client paths must be ignored, or a build commits them: ${unignored.join(', ')}`)

  const tracked = execFileSync('git', ['ls-files', 'android'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(path => /(^|\/)(local\.properties|google-services\.json)$|\.(apk|aab|jks|keystore)$/u.test(path))
  assert.deepEqual(tracked, [], `build output and credentials must not be tracked: ${tracked.join(', ')}`)
})

test('the root license is the client license the README promises', () => {
  // README says the repository is AGPL-3.0 and that the client keeps the same
  // license; two files carrying one text is exactly the pair that can drift.
  const root = readFileSync(join(repoRoot, 'LICENSE'), 'utf8')
  const client = readFileSync(join(repoRoot, 'android', 'LICENSE'), 'utf8')
  assert.equal(root, client, 'the repository LICENSE and the client LICENSE must be the same text')
  assert.match(root, /GNU AFFERO GENERAL PUBLIC LICENSE/u, 'the repository LICENSE must be AGPL-3.0')
  assert.equal(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).license, 'AGPL-3.0')
})
