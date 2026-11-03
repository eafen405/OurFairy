/**
 * The skill package/manifest algorithm and the skill store, tested without a
 * backend.
 *
 * These are the fast seams: the package reader, the canonical manifest, the
 * schema ladder and the seed import. The launcher suite then proves the same
 * modules through the real product composition. Expected values here come from
 * the design (canonical JSON of the sorted manifest, a hash change when a
 * file's bytes or executable bit changes) rather than from re-running the
 * implementation's own composition.
 */
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'

const cleanup = []
after(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
})

/** A temporary directory removed when the file's tests finish. */
function temp(prefix) {
  const path = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(path)
  return path
}

/**
 * Write one valid package. `files` maps a relative POSIX path to content; the
 * SKILL.md frontmatter defaults to a valid kebab-case name and description.
 */
function writePackage(dir, { name = 'demo-skill', description = 'Use when testing the package reader.', body = '# Demo\n\nDo the thing.', frontmatter = '', files = {} } = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${frontmatter}---\n\n${body}\n`)
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, ...path.split('/'))
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return dir
}

/** The SQLite rows of one skill database, read through a second connection. */
function rows(path, sql, ...parameters) {
  const database = new DatabaseSync(path)
  try {
    // node:sqlite rows have a null prototype; plain objects compare normally.
    return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
  } finally {
    database.close()
  }
}

test('the frontmatter reader accepts the documented subset and extracts the trimmed body', async () => {
  const { parseSkillMarkdown } = await import('../backend/skill-creator/dist/package.js')
  const parsed = parseSkillMarkdown([
    '---',
    'name: quoted-skill',
    'description: "A quoted: description"',
    'user-invocable: false',
    "license: 'MIT'",
    "note: 'it''s fine'",
    '---',
    '',
    '  # Body  ',
    '',
  ].join('\n'))
  assert.equal(parsed.attributes.name, 'quoted-skill')
  assert.equal(parsed.attributes.description, 'A quoted: description')
  assert.equal(parsed.attributes['user-invocable'], false)
  assert.equal(parsed.attributes.license, 'MIT')
  assert.equal(parsed.attributes.note, "it's fine")
  assert.equal(parsed.body, '# Body')
})

test('the frontmatter reader refuses nested/block YAML and a missing closing marker', async () => {
  const { parseSkillMarkdown } = await import('../backend/skill-creator/dist/package.js')
  assert.throws(() => parseSkillMarkdown('---\nname: demo\nmetadata:\n  owner: x\n---\nbody'), /indented|single-line/u)
  assert.throws(() => parseSkillMarkdown('---\nname: demo\ntags: [a, b]\n---\nbody'), /YAML syntax/u)
  assert.throws(() => parseSkillMarkdown('---\nname: demo\n'), /not closed/u)
  assert.throws(() => parseSkillMarkdown('no frontmatter'), /must start/u)
})

test('the canonical manifest is sorted, excludes mtime and records the executable bit', async () => {
  const { readSkillPackage } = await import('../backend/skill-creator/dist/package.js')
  const first = writePackage(join(temp('skill-pkg-'), 'pkg'), { files: { 'z.md': 'z', 'a.md': 'a', 'nested/b.md': 'b' } })
  const parsed = readSkillPackage(first)
  assert.deepEqual(parsed.manifest.map(entry => entry.path), ['SKILL.md', 'a.md', 'nested/b.md', 'z.md'])
  assert.ok(parsed.manifest.every(entry => entry.type === 'file' && /^[0-9a-f]{64}$/u.test(entry.sha256)))

  // Moving every mtime must not change the hash: the manifest has no time.
  const later = new Date(Date.now() + 60_000)
  for (const path of ['SKILL.md', 'a.md', 'z.md']) utimesSync(join(first, path), later, later)
  assert.equal(readSkillPackage(first).manifestHash, parsed.manifestHash, 'mtime must not enter the manifest')

  // The executable bit is content for the manifest: flipping it changes the hash.
  const script = join(first, 'run.sh')
  writeFileSync(script, '#!/bin/sh\necho hi\n', { mode: 0o644 })
  const plain = readSkillPackage(first).manifestHash
  chmodSync(script, 0o755)
  const executable = readSkillPackage(first)
  assert.notEqual(executable.manifestHash, plain, 'the executable bit must change the manifest hash')
  assert.equal(executable.manifest.find(entry => entry.path === 'run.sh')?.executable, true)
})

test('the package reader refuses symlinks, bad names, over-budget bodies and unsafe paths', async () => {
  const { readSkillPackage } = await import('../backend/skill-creator/dist/package.js')
  const linkDir = writePackage(join(temp('skill-pkg-link-'), 'pkg'))
  symlinkSync(join(linkDir, 'SKILL.md'), join(linkDir, 'linked.md'))
  assert.throws(() => readSkillPackage(linkDir), /symlink/u)

  const badName = writePackage(join(temp('skill-pkg-name-'), 'pkg'), { name: 'Bad_Name' })
  assert.throws(() => readSkillPackage(badName), /kebab-case/u)

  const noDescription = writePackage(join(temp('skill-pkg-desc-'), 'pkg'), { description: '' })
  assert.throws(() => readSkillPackage(noDescription), /description/u)

  const longDescription = writePackage(join(temp('skill-pkg-desc2-'), 'pkg'), { description: '海'.repeat(501) })
  assert.throws(() => readSkillPackage(longDescription), /500/u)

  const longBody = writePackage(join(temp('skill-pkg-body-'), 'pkg'), { body: '海'.repeat(7701) })
  assert.throws(() => readSkillPackage(longBody), /7700/u)

  const atBudget = writePackage(join(temp('skill-pkg-body-max-'), 'pkg'), { body: '海'.repeat(7700) })
  assert.equal(readSkillPackage(atBudget).coreCharacters, 7700, 'the budget is inclusive')

  const backslash = writePackage(join(temp('skill-pkg-path-'), 'pkg'), { files: { 'a\\b.md': 'x' } })
  assert.throws(() => readSkillPackage(backslash), /separators/u)

  const hostPaths = [
    ['/root/private/file.txt', /absolute POSIX path/u],
    ['C:\\Users\\alice\\file.txt', /Windows drive path/u],
    ['C:/Users/alice/file.txt', /Windows drive path/u],
    ['Run ~/scripts/build.sh first.', /home-directory prefix/u],
    ['Lives at ~', /home-directory prefix/u],
    ['Copy $HOME/.config/x', /home-directory prefix/u],
    ['Copy ${HOME}/.config/x', /home-directory prefix/u],
    ['\\\\server\\share\\notes.md', /UNC path/u],
    ['//home/alice/private', /UNC path/u],
    ['file:///root/private', /local file URL/u],
    ['／root／private', /absolute POSIX path/u],
  ]
  for (const [content, pattern] of hostPaths) {
    const hostPath = writePackage(join(temp('skill-pkg-host-'), 'pkg'), {
      files: { 'references/notes.md': content },
    })
    assert.throws(() => readSkillPackage(hostPath), pattern,
      `a package must not carry a host path: ${JSON.stringify(content)}`)
  }

  // Relative package paths, shebangs, ordinary URLs and an approximate "~" in
  // prose are not host paths.
  const neutral = writePackage(join(temp('skill-pkg-neutral-'), 'pkg'), {
    files: {
      'references/notes.md': 'See https://example.com/home/alice/docs/workflow and references/guide.md.\n'
        + 'A run takes ~5 seconds. Use either/or and 24/7 wording.',
      'scripts/check.sh': '#!/bin/sh\nexit 0\n',
    },
  })
  assert.equal(readSkillPackage(neutral).name, 'demo-skill')

  const urlPath = writePackage(join(temp('skill-pkg-url-home-'), 'pkg'), {
    files: { 'references/notes.md': 'Reference: https://example.com/home/alice/private/docs' },
  })
  assert.equal(readSkillPackage(urlPath).name, 'demo-skill',
    'a URL path is not an author-machine path')
})

test('the store creates schema v3 in WAL and enforces the active identity rule', async () => {
  const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
  const dbPath = join(temp('skill-store-'), 'skill.sqlite')
  const store = new SkillStore({ path: dbPath })
  try {
    assert.equal(store.schemaVersion(), 3)
    const facts = new DatabaseSync(dbPath)
    try {
      assert.equal(String(facts.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(), 'wal')
      assert.deepEqual(
        facts.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name),
        ['meta', 'skill', 'skill_creation_job', 'skill_learning_state', 'skill_reuse_signal',
          'skill_user_preference', 'skill_version'],
        'schema v3 is the runtime subset plus the three background-learning tables',
      )
      // The partial expression index is the authority for the nullable owner key.
      facts.prepare("INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at) VALUES ('common-one', 2, NULL, 0, 0, 0, 0)").run()
      assert.throws(
        () => facts.prepare("INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at) VALUES ('common-one', 2, NULL, 0, 0, 0, 0)").run(),
        /UNIQUE constraint failed/u,
        'a second active common identity with the same name must be refused by the index',
      )
      // Personal and common may share a name; two personal owners may not.
      facts.prepare("INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at) VALUES ('common-one', 1, 7, 0, 0, 0, 0)").run()
      facts.prepare("INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at) VALUES ('common-one', 1, 8, 0, 0, 0, 0)").run()
      assert.throws(
        () => facts.prepare("INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, created_at, updated_at) VALUES ('common-one', 1, 7, 0, 0, 0, 0)").run(),
        /UNIQUE constraint failed/u,
      )
    } finally {
      facts.close()
    }
  } finally {
    store.close()
  }
})

test('importReviewedPackage stores an approved version through staging and moves the current pointer', async () => {
  const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
  const { importReviewedPackage } = await import('../backend/skill-creator/dist/seed.js')
  const { readSkillPackage } = await import('../backend/skill-creator/dist/package.js')
  const root = temp('skill-seed-')
  const source = writePackage(join(temp('skill-seed-src-'), 'pkg'), {
    name: 'seeded-skill',
    body: '# First version',
    files: { 'references/guide.md': 'guide body' },
  })
  const store = new SkillStore({ path: join(root, 'skill.sqlite') })
  try {
    const first = importReviewedPackage({
      root,
      store,
      packageDir: source,
      scope: 2,
      createdBy: 0,
      sourceType: 5,
      preference: { shortId: 7, enabled: true },
    })
    assert.equal(first.name, 'seeded-skill')
    assert.equal(first.createdSkill, true)
    assert.ok(existsSync(join(root, 'versions', String(first.skillId))), 'the version parent exists')
    const [skill] = rows(join(root, 'skill.sqlite'), 'SELECT * FROM skill')
    assert.equal(skill.scope, 2)
    assert.equal(skill.owner_short_id, null)
    assert.equal(skill.current_version_id, first.versionId)
    const [version] = rows(join(root, 'skill.sqlite'), 'SELECT * FROM skill_version WHERE id = ?', first.versionId)
    assert.equal(version.status, 3)
    assert.equal(version.source_type, 5)
    assert.equal(version.reviewer, 0)
    assert.match(version.package_path, new RegExp(`^versions/${first.skillId}/[0-9a-f-]{36}$`, 'u'))
    const directory = join(root, ...version.package_path.split('/'))
    assert.equal(readFileSync(join(directory, 'references', 'guide.md'), 'utf8'), 'guide body')
    assert.equal(readSkillPackage(directory).manifestHash, version.manifest_hash)
    assert.equal(JSON.parse(version.manifest).length, 2, 'SKILL.md plus one reference file')
    const [preference] = rows(join(root, 'skill.sqlite'), 'SELECT * FROM skill_user_preference')
    assert.equal(preference.short_id, 7)
    assert.equal(preference.enabled, 1)

    // A second import of the same identity is a revision of the same identity.
    const revised = writePackage(join(temp('skill-seed-src2-'), 'pkg'), {
      name: 'seeded-skill',
      body: '# Second, shorter version',
    })
    const second = importReviewedPackage({ root, store, packageDir: revised, scope: 2, createdBy: 0, sourceType: 3 })
    assert.equal(second.skillId, first.skillId, 'same scope/name keeps one identity')
    assert.equal(second.createdSkill, false)
    const versions = rows(join(root, 'skill.sqlite'), 'SELECT id, status FROM skill_version ORDER BY id')
    assert.deepEqual(versions, [{ id: first.versionId, status: 4 }, { id: second.versionId, status: 3 }])
    const [afterRevision] = rows(join(root, 'skill.sqlite'), 'SELECT current_version_id FROM skill WHERE id = ?', first.skillId)
    assert.equal(afterRevision.current_version_id, second.versionId)
  } finally {
    store.close()
  }
})

test('an archived identity refuses an import until it is restored', async () => {
  const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
  const { importReviewedPackage } = await import('../backend/skill-creator/dist/seed.js')
  const root = temp('skill-archived-')
  const source = writePackage(join(temp('skill-archived-src-'), 'pkg'), { name: 'archive-me' })
  const store = new SkillStore({ path: join(root, 'skill.sqlite') })
  try {
    const seeded = importReviewedPackage({ root, store, packageDir: source, scope: 1, ownerShortId: 7, createdBy: 7, sourceType: 0 })
    assert.equal(store.archiveIdentity(seeded.skillId, 7), true)
    assert.throws(
      () => importReviewedPackage({ root, store, packageDir: source, scope: 1, ownerShortId: 7, createdBy: 7, sourceType: 0 }),
      /archived/u,
    )
    assert.equal(store.restoreIdentity(seeded.skillId, 7), true)
    const restored = importReviewedPackage({ root, store, packageDir: source, scope: 1, ownerShortId: 7, createdBy: 7, sourceType: 0 })
    assert.equal(restored.skillId, seeded.skillId)
  } finally {
    store.close()
  }
})

test('the creation writer stages a complete package and refuses unsafe or conflicting paths', async () => {
  const { readSkillPackage, writeSkillPackage } = await import('../backend/skill-creator/dist/package.js')
  const dir = join(temp('skill-write-'), 'pkg')
  writeSkillPackage(dir, [
    { path: 'SKILL.md', content: '---\nname: written-skill\ndescription: Use when writing.\n---\n\n# Workflow\n' },
    { path: 'scripts/run.sh', content: '#!/bin/sh\nexit 0\n', executable: true },
  ])
  const parsed = readSkillPackage(dir)
  assert.equal(parsed.name, 'written-skill')
  assert.deepEqual(parsed.manifest.map(entry => entry.path), ['SKILL.md', 'scripts/run.sh'])
  assert.equal(parsed.manifest.find(entry => entry.path === 'scripts/run.sh')?.executable, true,
    'the executable bit the model asked for is the bit the manifest records')

  assert.throws(() => writeSkillPackage(join(temp('skill-write-bad-'), 'pkg'), [
    { path: 'SKILL.md', content: 'x' }, { path: '../escape', content: 'x' },
  ]), /"\." or "\.\."|relative/u)
  assert.throws(() => writeSkillPackage(join(temp('skill-write-dup-'), 'pkg'), [
    { path: 'SKILL.md', content: 'x' }, { path: 'SKILL.md', content: 'y' },
  ]), /more than once/u)
  assert.throws(() => writeSkillPackage(join(temp('skill-write-prefix-'), 'pkg'), [
    { path: 'scripts', content: 'x' }, { path: 'scripts/run.sh', content: 'y' },
  ]), /both a file and a directory/u)
})

test('the bundled Skill Creator fits the pruner budget and keeps the whole contract', async () => {
  const { readSkillPackage } = await import('../backend/skill-creator/dist/package.js')
  const directory = join(import.meta.dirname, '..', 'backend', 'skill-creator', 'bundled', 'skill-creator')
  const parsed = readSkillPackage(directory)
  assert.equal(parsed.name, 'skill-creator')
  const bodyCharacters = [...parsed.body].length
  assert.ok(bodyCharacters < 7400,
    `the bundled core body is ${bodyCharacters} characters; it must stay under 7400 so the rendered result fits the 8192 pruner threshold`)
  // The native render wrapper is about 302 characters plus the resource-base
  // path; a realistic deployment path is under 80 characters.
  assert.ok(bodyCharacters + 302 + 80 < 8192, 'the rendered bundled skill must stay under the pruner threshold')
  for (const heading of [
    '# Skill Creator', '## When to use it', '## Workflow or fact', '## Package shape',
    '## Create through skill_manage', '## Scenarios and evidence',
    '## Revisions, rollback and growth', '### Growth confirmation', '### Rollback',
    '## Review before use',
  ]) {
    assert.ok(parsed.body.includes(heading), `the bundled contract keeps the heading ${heading}`)
  }
  for (const phrase of ['parentVersionId', 'targetBenefit', 'complete rewrite', '110%', '确认增长', 'skill_manage rollback']) {
    assert.ok(parsed.body.includes(phrase), `the bundled contract keeps ${phrase}`)
  }
})

test('bundledSkillNames is read once at construction and tolerates a missing or broken root', async () => {
  const { SkillService } = await import('../backend/skill-creator/dist/service.js')
  const bundled = temp('skill-bundled-')
  writePackage(join(bundled, 'alpha'), { name: 'alpha', description: 'Use when testing alpha.' })
  writePackage(join(bundled, 'beta'), { name: 'beta', description: 'Use when testing beta.' })
  mkdirSync(join(bundled, 'plain'), { recursive: true })
  writeFileSync(join(bundled, 'plain', 'README.md'), 'not a skill package')
  mkdirSync(join(bundled, 'broken'), { recursive: true })
  writeFileSync(join(bundled, 'broken', 'SKILL.md'), 'not frontmatter')

  const service = new SkillService({}, { root: temp('skill-bundled-root-'), bundledSkillsDir: bundled })
  assert.deepEqual([...service.bundledSkillNames()].sort(), ['alpha', 'beta'],
    'only packages carrying a readable SKILL.md name are listed')

  // The set is cached once: a package added after construction is not picked up.
  writePackage(join(bundled, 'gamma'), { name: 'gamma', description: 'Use when testing gamma.' })
  assert.deepEqual([...service.bundledSkillNames()].sort(), ['alpha', 'beta'], 'the bundled name set is cached')

  const missing = new SkillService({}, {
    root: temp('skill-bundled-root-'), bundledSkillsDir: join(bundled, 'does-not-exist'),
  })
  assert.equal(missing.bundledSkillNames().size, 0, 'a missing bundled root answers an empty set')
})

test('the read-only hot path derives directories without reading descriptions', async () => {
  const { SkillService } = await import('../backend/skill-creator/dist/service.js')
  const root = temp('skill-service-lazy-')
  const skills = []
  const versions = new Map()
  for (const [skillId, name] of [[1, 'alpha'], [2, 'beta']]) {
    writePackage(join(root, 'versions', String(skillId), 'pkg'), {
      name, description: `${name} description`,
    })
    skills.push({
      id: skillId, name, scope: 1, owner_short_id: 7, current_version_id: skillId * 10, archived_at: null,
    })
    versions.set(skillId * 10, {
      id: skillId * 10, skill_id: skillId, status: 3,
      package_path: `versions/${skillId}/pkg`, manifest_hash: 'manifest-hash',
    })
  }
  const store = {
    preferences: () => [],
    openDraftSkillIds: () => new Set(),
    visibleIdentities: () => skills,
    version: id => versions.get(id),
  }
  const service = new SkillService(store, { root, bundledSkillsDir: join(root, 'no-bundled-root') })

  const reads = []
  const original = fs.readFileSync
  fs.readFileSync = function (path, ...args) {
    if (String(path).endsWith('/SKILL.md')) reads.push(String(path))
    return original.call(this, path, ...args)
  }
  syncBuiltinESMExports()
  try {
    const directories = service.readonlyVersionDirs(7)
    assert.equal(directories.length, 2)
    assert.equal(reads.length, 0, 'the read-only contribution must not read any description')

    reads.length = 0
    const catalog = service.catalog(7)
    assert.deepEqual(catalog.map(item => item.description).sort(), ['alpha description', 'beta description'])
    assert.equal(reads.length, 2, 'catalog reads exactly one description per winner')

    reads.length = 0
    const pool = service.pool(7)
    assert.deepEqual(pool.map(item => item.description).sort(), ['alpha description', 'beta description'])
    assert.equal(reads.length, 2, 'pool reads exactly one description per visible item')
  } finally {
    fs.readFileSync = original
    syncBuiltinESMExports()
  }
})
