/**
 * The skill-creation domain's source contract (#330), tested without a backend.
 *
 * `SkillCreation.create` is the one seam every producer hands a draft to: the
 * model's `skill_manage` tool and the background learning child. The five
 * source combinations the ticket names as illegal are refused by the domain
 * itself, before any byte is staged, so a caller's pre-check is not what keeps
 * them out. The assertions read the temporary data root and the skill tables
 * rather than the thrown error alone: a regression that accepts a combination
 * is visible even if a future caller swallows the error.
 *
 * The legal origins are pinned by the `source_type` code and the provenance
 * shape each one records. That is the other half of "one origin, not a
 * priority override": the bytes of an install are recorded as an install, a
 * background claim keeps its claim and benefit, and a revision keeps its
 * parent. Expected codes come from the store's `SOURCE_TYPE` vocabulary and
 * the ticket, not from re-running the resolver.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'

const { SkillStore } = await import('../backend/skill-creator/dist/store.js')
const { SkillService } = await import('../backend/skill-creator/dist/service.js')
const { SkillCreation } = await import('../backend/skill-creator/dist/creation.js')
const { importReviewedPackage } = await import('../backend/skill-creator/dist/seed.js')

const root = mkdtempSync(join(tmpdir(), 'ourfairy-skill-domain-'))
after(() => rmSync(root, { recursive: true, force: true }))

/** The fixed source an install records; the domain never invents one. */
const INSTALL = Object.freeze({
  address: 'https://example.test/owner/repo.git',
  resolvedVersion: 'a'.repeat(40),
  digest: 'b'.repeat(64),
  fetchedAt: 1_700_000_000_000,
})

/** The cross-session claim a background candidate came from. */
const BACKGROUND = Object.freeze({
  taskKey: 'release-checklist',
  signalIds: Object.freeze([11, 12]),
  sourceSessions: Object.freeze(['session-a', 'session-b']),
  creationJobId: 3,
})

/** The minimal durable log a turn focus resolves against. */
const TURN_LOG = Object.freeze([
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'turn/end', data: { turn: 1 } },
])

const SCENARIO = Object.freeze({ name: 'ok', command: 'true' })

let serial = 0

/** One valid SKILL.md text for a package named `name`. */
function skillMarkdown(name, body) {
  return `---\nname: ${name}\ndescription: Use when testing the skill creation source contract.\n---\n\n${body}\n`
}

/** The model-drafted package files for one candidate. */
function packageFiles(name, { body = '# Origin\n\nDo the thing.' } = {}) {
  return [{ path: 'SKILL.md', content: skillMarkdown(name, body) }]
}

/** One package directory on disk, for the install path and the seed import. */
function writePackageDir(name) {
  serial += 1
  const directory = join(root, `src-${serial}-${name}`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), skillMarkdown(name, '# Origin\n\nDo the thing.'))
  return directory
}

/** One fresh data root and the collaborators every domain test needs. */
function domain(name) {
  serial += 1
  const directory = join(root, `${serial}-${name}`)
  const store = new SkillStore({ path: join(directory, 'skill.sqlite') })
  const service = new SkillService(store, {
    root: directory,
    bundledSkillsDir: join(directory, 'bundled-skills'),
  })
  const creation = new SkillCreation(store, service, { root: directory, verifyTimeoutMs: 60_000 })
  /** The rows the skill database holds, read through a second connection. */
  const rows = (sql, ...parameters) => {
    const database = new DatabaseSync(join(directory, 'skill.sqlite'))
    try {
      return database.prepare(sql).all(...parameters).map(row => ({ ...row }))
    } finally {
      database.close()
    }
  }
  return {
    directory,
    creation,
    /** Import one already-approved personal parent through the seed path (no bwrap). */
    seedParent(name = 'origin-parent') {
      const imported = importReviewedPackage({
        root: directory,
        store,
        packageDir: writePackageDir(name),
        scope: 1,
        ownerShortId: 7,
        createdBy: 7,
        sourceType: 0,
      })
      return { ...imported, name }
    },
    version(id) {
      return store.version(id)
    },
    versionCount() {
      return rows('SELECT COUNT(*) AS count FROM skill_version')[0].count
    },
    /** The candidate directories currently staged under `candidates/`. */
    stagedCandidates() {
      const candidates = join(directory, 'candidates')
      return existsSync(candidates) ? readdirSync(candidates) : []
    },
    /** The entries currently staged under `tmp/`. */
    stagedTemporary() {
      const temporary = join(directory, 'tmp')
      return existsSync(temporary) ? readdirSync(temporary) : []
    },
    close() {
      store.close()
    },
  }
}

/**
 * Assert one create is refused by the domain's source contract before staging.
 *
 * A refusal must leave no version row, no `candidates/` directory and no
 * `tmp/` entry: the legal combinations below prove staging works, so an empty
 * tree here is the domain's own doing, not a missing fixture.
 */
async function refuses(domain, create) {
  const versions = domain.versionCount()
  await assert.rejects(create(), error => {
    assert.equal(error.code, 'skills/invalid-source')
    assert.equal(error.status, 400)
    return true
  })
  assert.equal(domain.versionCount(), versions, 'a refused source adds no version row')
  assert.deepEqual(domain.stagedCandidates(), [], 'a refused source stages no candidate')
  assert.deepEqual(domain.stagedTemporary(), [], 'a refused source leaves tmp/ empty')
}

/** One field of a stored `source_location`, parsed from the row. */
function locationOf(domain, versionId) {
  return JSON.parse(domain.version(versionId).source_location)
}

describe('an illegal source combination is refused by the domain', () => {
  test('a revision cannot also carry an install source', async () => {
    const domainUnderTest = domain('revision-install')
    try {
      const parent = domainUnderTest.seedParent()
      await refuses(domainUnderTest, () => domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: TURN_LOG,
        scope: 1,
        parentVersionId: parent.versionId,
        targetBenefit: 'make the steps explicit',
        evidence: [{ kind: 'test', ref: 'the origin scenario' }],
        files: packageFiles(parent.name),
        scenarios: [SCENARIO],
        install: INSTALL,
      }))
    } finally {
      domainUnderTest.close()
    }
  })

  test('model-authored files cannot also claim an install source', async () => {
    const domainUnderTest = domain('files-install')
    try {
      await refuses(domainUnderTest, () => domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: TURN_LOG,
        scope: 1,
        focus: { kind: 'turn' },
        files: packageFiles('files-install-skill'),
        scenarios: [SCENARIO],
        install: INSTALL,
      }))
    } finally {
      domainUnderTest.close()
    }
  })

  test('a background candidate cannot also record an install source', async () => {
    const domainUnderTest = domain('background-install')
    try {
      await refuses(domainUnderTest, () => domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: [],
        scope: 1,
        files: packageFiles('background-install-skill'),
        scenarios: [SCENARIO],
        install: INSTALL,
        background: BACKGROUND,
        deferVerification: true,
      }))
    } finally {
      domainUnderTest.close()
    }
  })

  test('a background candidate cannot name a calling turn as focus', async () => {
    const domainUnderTest = domain('background-focus')
    try {
      await refuses(domainUnderTest, () => domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: TURN_LOG,
        scope: 1,
        focus: { kind: 'turn' },
        files: packageFiles('background-focus-skill'),
        scenarios: [SCENARIO],
        background: BACKGROUND,
        deferVerification: true,
      }))
    } finally {
      domainUnderTest.close()
    }
  })

  test('only a background claim may defer verification', async () => {
    const domainUnderTest = domain('install-defer')
    try {
      await refuses(domainUnderTest, () => domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: [],
        scope: 1,
        packageDir: writePackageDir('install-defer-skill'),
        install: INSTALL,
        scenarios: [SCENARIO],
        deferVerification: true,
      }))
    } finally {
      domainUnderTest.close()
    }
  })
})

describe('a legal source records its own origin and provenance', () => {
  test('an explicit create records the session and the resolved turn', async () => {
    const domainUnderTest = domain('explicit-origin')
    try {
      const result = await domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: TURN_LOG,
        scope: 1,
        focus: { kind: 'turn' },
        files: packageFiles('explicit-origin-skill'),
        scenarios: [SCENARIO],
      })
      const row = domainUnderTest.version(result.versionId)
      assert.equal(row.source_type, 0)
      assert.equal(row.parent_version_id, null)
      const location = locationOf(domainUnderTest, result.versionId)
      assert.equal(location.sessionId, 'session-7')
      assert.deepEqual(location.focus, { kind: 'turn', turn: 1, startSeq: 1, endSeq: 2, toolCalls: [] })
      assert.equal(location.address, undefined)
      assert.equal(location.background, undefined)
      assert.equal(result.verification.complete, true)
      assert.equal(result.verification.executed.length, 1, 'the scenario really ran')
    } finally {
      domainUnderTest.close()
    }
  })

  test('an address install records the fixed source and no claim provenance', async () => {
    const domainUnderTest = domain('install-origin')
    try {
      const result = await domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: [],
        scope: 1,
        packageDir: writePackageDir('installed-origin'),
        install: INSTALL,
        scenarios: [SCENARIO],
      })
      const row = domainUnderTest.version(result.versionId)
      assert.equal(row.source_type, 1)
      const location = locationOf(domainUnderTest, result.versionId)
      assert.equal(location.sessionId, 'session-7')
      assert.equal(location.address, INSTALL.address)
      assert.equal(location.resolvedVersion, INSTALL.resolvedVersion)
      assert.equal(location.digest, INSTALL.digest)
      assert.equal(location.fetchedAt, INSTALL.fetchedAt)
      assert.equal(location.background, undefined)
      assert.equal(result.verification.executed.length, 1, 'the scenario really ran')
    } finally {
      domainUnderTest.close()
    }
  })

  test('a background revision defers verification and keeps its claim and benefit', async () => {
    const domainUnderTest = domain('background-origin')
    try {
      const parent = domainUnderTest.seedParent()
      const result = await domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: [],
        scope: 1,
        parentVersionId: parent.versionId,
        targetBenefit: 'turn the repeated notes into a checklist',
        evidence: [{ kind: 'session', ref: 'session-a' }],
        files: packageFiles(parent.name),
        scenarios: [SCENARIO],
        background: BACKGROUND,
        deferVerification: true,
      })
      assert.equal(result.status, 0)
      assert.equal(result.verification.complete, false, 'a deferred candidate has no report yet')
      const row = domainUnderTest.version(result.versionId)
      assert.equal(row.source_type, 2)
      assert.equal(row.parent_version_id, parent.versionId)
      const location = locationOf(domainUnderTest, result.versionId)
      assert.deepEqual(location.background, {
        taskKey: 'release-checklist',
        signalIds: [11, 12],
        sourceSessions: ['session-a', 'session-b'],
        creationJobId: 3,
      })
      assert.equal(location.benefit, 'turn the repeated notes into a checklist')
      assert.equal(location.address, undefined)
      assert.equal(location.sessionId, undefined, 'a claim has no calling session in its provenance')
      assert.equal(location.focus, undefined)
      assert.equal(location.scenarios.length, 1, 'the deferred scenarios stay readable for run_verification')
    } finally {
      domainUnderTest.close()
    }
  })

  test('a revision records the evolution source, its parent and the benefit', async () => {
    const domainUnderTest = domain('evolution-origin')
    try {
      const parent = domainUnderTest.seedParent()
      const result = await domainUnderTest.creation.create({
        ownerShortId: 7,
        sessionId: 'session-7',
        events: TURN_LOG,
        scope: 1,
        parentVersionId: parent.versionId,
        targetBenefit: 'split the checklist into two phases',
        evidence: [{ kind: 'test', ref: 'the revised scenario' }],
        focus: { kind: 'turn' },
        files: packageFiles(parent.name, { body: '# Origin\n\nDo the thing in two phases.' }),
        scenarios: [SCENARIO],
      })
      const row = domainUnderTest.version(result.versionId)
      assert.equal(row.source_type, 3)
      assert.equal(row.parent_version_id, parent.versionId)
      const location = locationOf(domainUnderTest, result.versionId)
      assert.equal(location.sessionId, 'session-7')
      assert.equal(location.benefit, 'split the checklist into two phases')
      assert.equal(location.address, undefined)
      assert.equal(location.background, undefined)
      assert.equal(result.verification.executed.length, 1, 'the revision scenario really ran')
    } finally {
      domainUnderTest.close()
    }
  })
})

describe('the origin resolver names one source or refuses the conflict', () => {
  let candidateOrigin

  before(async () => {
    ;({ candidateOrigin } = await import('../backend/skill-creator/dist/origin.js'))
  })

  /** The six facts one create hands the resolver, defaulting to explicit. */
  function facts(overrides = {}) {
    return {
      install: undefined,
      background: undefined,
      revision: false,
      deferredVerification: false,
      focusNamed: false,
      packageDir: false,
      ...overrides,
    }
  }

  const refusals = [
    ['an install source on a background claim', { background: BACKGROUND, install: INSTALL }, /background[^.]*install/iu],
    ['an install source on a revision', { revision: true, install: INSTALL }, /revision[^.]*install/iu],
    ['deferred verification without a background claim', { deferredVerification: true }, /background/iu],
    ['a named focus on a background claim', { background: BACKGROUND, focusNamed: true }, /focus/iu],
    ['an install source without the fetched package directory', { install: INSTALL }, /package directory/iu],
  ]
  for (const [label, overrides, message] of refusals) {
    test(`refuses ${label}`, () => {
      assert.throws(
        () => candidateOrigin(facts(overrides)),
        error => {
          assert.equal(error.code, 'skills/invalid-source')
          assert.equal(error.status, 400)
          assert.match(error.message, message)
          return true
        },
      )
    })
  }

  test('names the four legal origins', () => {
    assert.equal(candidateOrigin(facts()), 'explicit')
    assert.equal(candidateOrigin(facts({ install: INSTALL, packageDir: true })), 'install')
    assert.equal(candidateOrigin(facts({ background: BACKGROUND, deferredVerification: true })), 'background')
    assert.equal(candidateOrigin(facts({ revision: true })), 'evolution')
  })
})
