/**
 * Ticket #332: the one authority for the stored skill package path vocabulary.
 *
 * A version's `package_path` is a POSIX path relative to the skill data root;
 * every row this product writes is either `candidates/<uuid>` or
 * `versions/<skillId>/<uuid>` (README, "The data root"). The store's draft
 * validation, the service's read path, the seed import and the boot
 * reconciliation all accept exactly that vocabulary now. These cases pin the
 * safety rules those consumers share, the directory vocabulary itself, and the
 * crash re-home rule that used to exist twice. Expected paths come from the
 * documented layout, not from re-running the implementation.
 *
 * @covers backend/skill-creator — stored package path validation, directory
 *   vocabulary and the candidate crash re-home.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'

import {
  SKILL_DIR,
  candidatePackagePath,
  checkPackagePath,
  insideRoot,
  packageDirectory,
  rehomeCandidatePackage,
  versionPackagePath,
} from '../backend/skill-creator/dist/paths.js'

const cleanup = []
after(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
})

/** One fresh data root under a temporary home. */
function dataRoot(prefix = 'skill-paths-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(root)
  return root
}

describe('the directory vocabulary', () => {
  test('the three stored-path areas are frozen and named once', () => {
    assert.deepEqual({ ...SKILL_DIR }, { candidates: 'candidates', versions: 'versions', tmp: 'tmp' },
      'verify/ is a one-shot verification directory owned by verify.ts, not a stored-path area')
    assert.equal(Object.isFrozen(SKILL_DIR), true, 'the vocabulary is a value, not mutable state')
  })

  test('a candidate row always records candidates/<uuid>', () => {
    assert.equal(candidatePackagePath('9f1c'), 'candidates/9f1c')
    assert.equal(candidatePackagePath('uuid with space'), 'candidates/uuid with space',
      'the id is opaque; the vocabulary only names the area')
  })

  test('a version row always records versions/<skillId>/<packageId>', () => {
    assert.equal(versionPackagePath(7, '9f1c'), 'versions/7/9f1c')
    assert.equal(versionPackagePath(123, 'pkg'), 'versions/123/pkg')
  })

  test('a checked path resolves to the absolute directory under one root', () => {
    const root = dataRoot()
    const checked = checkPackagePath(versionPackagePath(7, '9f1c'))
    assert.deepEqual(checked, { segments: ['versions', '7', '9f1c'] })
    assert.equal(packageDirectory(root, checked.segments), join(root, 'versions', '7', '9f1c'))
    assert.equal(packageDirectory(root, [SKILL_DIR.tmp]), join(root, 'tmp'))
  })
})

describe('checkPackagePath', () => {
  test('accepts a relative path under a named area', () => {
    assert.deepEqual(checkPackagePath('candidates/9f1c'), { segments: ['candidates', '9f1c'] })
    assert.deepEqual(checkPackagePath('versions/1/9f1c'), { segments: ['versions', '1', '9f1c'] })
    assert.deepEqual(checkPackagePath('tmp/install-9f1c'), { segments: ['tmp', 'install-9f1c'] })
    assert.deepEqual(checkPackagePath('a/b/c'), { segments: ['a', 'b', 'c'] },
      'safety is about staying under the root; the area shape belongs to each caller')
  })

  test('refuses anything that is not at least one package directory below the root', () => {
    assert.equal(checkPackagePath(''), undefined)
    assert.equal(checkPackagePath('candidates'), undefined, 'a single segment names no package directory')
    assert.equal(checkPackagePath('candidates/'), undefined, 'a trailing slash leaves an empty segment')
  })

  test('refuses absolute paths and escape segments', () => {
    assert.equal(checkPackagePath('/candidates/9f1c'), undefined)
    assert.equal(checkPackagePath('//candidates/9f1c'), undefined)
    assert.equal(checkPackagePath('candidates//9f1c'), undefined)
    assert.equal(checkPackagePath('candidates/./9f1c'), undefined)
    assert.equal(checkPackagePath('candidates/../9f1c'), undefined)
    assert.equal(checkPackagePath('candidates/..'), undefined)
    assert.equal(checkPackagePath('./candidates/9f1c'), undefined)
    assert.equal(checkPackagePath('..'), undefined)
    assert.equal(checkPackagePath('.'), undefined)
  })

  test('refuses bytes whose meaning differs between platforms', () => {
    assert.equal(checkPackagePath('candidates\\9f1c'), undefined, 'a backslash is a separator on Windows')
    assert.equal(checkPackagePath('C:/candidates/9f1c'), undefined, 'a drive letter is not a data-root area')
    assert.equal(checkPackagePath('candidates/9f1c\u0000'), undefined, 'a NUL truncates the path at the OS boundary')
    assert.equal(checkPackagePath('candidates/9f1\u0007c'), undefined, 'a control character is not a legal filename byte')
    assert.equal(checkPackagePath('candidates/9f1\nc'), undefined)
  })
})

describe('insideRoot', () => {
  test('answers whether one absolute path is the root or below it', () => {
    assert.equal(insideRoot('/srv/skill', '/srv/skill'), true)
    assert.equal(insideRoot('/srv/skill', '/srv/skill/versions/1/x'), true)
    assert.equal(insideRoot('/srv/skill/', '/srv/skill/versions/1/x'), true, 'a trailing separator on the root is normalised')
    assert.equal(insideRoot('/srv/skill', '/srv/skill-other/versions/1/x'), false, 'a sibling whose name shares the prefix is outside')
    assert.equal(insideRoot('/srv/skill', '/srv'), false)
    assert.equal(insideRoot('/srv/skill', '/etc/passwd'), false)
  })
})

describe('rehomeCandidatePackage', () => {
  test('reports a candidate directory that is already in place as present', () => {
    const root = dataRoot()
    mkdirSync(join(root, 'candidates', 'pkg'), { recursive: true })
    assert.equal(rehomeCandidatePackage({ root, packagePath: 'candidates/pkg', skillId: 7 }), 'present')
    assert.ok(existsSync(join(root, 'candidates', 'pkg')))
  })

  test('moves a published candidate directory back and reports rehomed', () => {
    const root = dataRoot()
    const displaced = join(root, 'versions', '7', 'pkg')
    mkdirSync(displaced, { recursive: true })
    writeFileSync(join(displaced, 'SKILL.md'), '---\nname: moved\n---\n')
    mkdirSync(join(root, 'candidates'), { recursive: true })

    assert.equal(rehomeCandidatePackage({ root, packagePath: 'candidates/pkg', skillId: 7 }), 'rehomed')
    assert.ok(existsSync(join(root, 'candidates', 'pkg')), 'the candidate is readable again')
    assert.equal(readFileSync(join(root, 'candidates', 'pkg', 'SKILL.md'), 'utf8'), '---\nname: moved\n---\n',
      'the bytes move with the directory, not just the path')
    assert.equal(existsSync(displaced), false, 'the published area no longer holds a draft')
  })

  test('reports missing when no directory holds the bytes', () => {
    const root = dataRoot()
    mkdirSync(join(root, 'candidates'), { recursive: true })
    assert.equal(rehomeCandidatePackage({ root, packagePath: 'candidates/gone', skillId: 7 }), 'missing')
  })

  test('only looks under the row skill identity for a displaced candidate', () => {
    const root = dataRoot()
    const otherSkill = join(root, 'versions', '8', 'pkg')
    mkdirSync(otherSkill, { recursive: true })
    assert.equal(rehomeCandidatePackage({ root, packagePath: 'candidates/pkg', skillId: 7 }), 'missing',
      'another skill\'s version directory is not this candidate')
    assert.ok(existsSync(otherSkill), 'a non-matching directory is never moved')
  })

  test('refuses an unsafe recorded path instead of joining it, and says so', () => {
    const root = dataRoot()
    mkdirSync(join(root, 'candidates'), { recursive: true })
    for (const unsafe of ['', 'candidates', 'candidates/../pkg', '/candidates/pkg', 'candidates\\pkg']) {
      assert.equal(rehomeCandidatePackage({ root, packagePath: unsafe, skillId: 7 }), 'unsafe', unsafe)
    }
  })

  test('a directory that exists outside the candidate shape is present, not moved', () => {
    const root = dataRoot()
    const version = join(root, 'versions', '7', 'pkg')
    mkdirSync(version, { recursive: true })
    assert.equal(rehomeCandidatePackage({ root, packagePath: 'versions/7/pkg', skillId: 7 }), 'present')
    assert.equal(rehomeCandidatePackage({ root, packagePath: 'versions/7/absent', skillId: 7 }), 'missing',
      'only a candidate row is re-homed; another shape with missing bytes cannot be repaired')
  })
})
