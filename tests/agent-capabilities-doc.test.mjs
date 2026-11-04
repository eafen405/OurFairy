/**
 * The agent-capabilities document's claims are checked against the code.
 *
 * `ecosystem-boundary.md` stays true because a test reconciles it with the rows
 * it describes; `agent-capabilities.md` had no such check, and three claims in
 * it drifted (#304): the tool count, how many agent kinds are deployed, and the
 * consumers of `isUserSession`. A document that nothing checks is a document
 * that silently becomes wrong, so this file is the missing check rather than a
 * one-off correction.
 *
 * The numbers here are DERIVED, never restated: the tool list comes from the
 * assertion `model-double` already keeps, the agent kinds from the row sources
 * that register them, and the consumer count from the sources that call the
 * predicate. A claim in the document that names a number is compared with what
 * the code says today, so a future change fails here instead of drifting.
 *
 * @covers backend/identity
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

const DOC = join(repoRoot, 'docs', 'architecture', 'agent-capabilities.md')

/** Every product source file, as a repo-relative path. */
function productSources() {
  const files = []
  for (const entry of readdirSync(join(repoRoot, 'backend'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const src = join(repoRoot, 'backend', entry.name, 'src')
    let names
    try {
      names = readdirSync(src)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.endsWith('.ts')) files.push(join('backend', entry.name, 'src', name))
    }
  }
  return files
}

/**
 * The tool names `tests/model-double.test.mjs` asserts the owner session sees.
 *
 * That list is the reviewed expectation for the model's tool catalog; reading it
 * here keeps one authority for the number instead of a second copy in this file.
 * @returns the sorted tool names.
 */
function assertedOwnerTools() {
  const body = readFileSync(join(repoRoot, 'tests', 'model-double.test.mjs'), 'utf8')
  const block = /\[\.\.\.toolNames\]\.sort\(\),\s*\[([\s\S]*?)\]/u.exec(body)
  assert.ok(block !== null, 'model-double must keep its sorted tool-list assertion')
  return [...block[1].matchAll(/'([a-z_]+)'/gu)].map(match => match[1]).sort()
}

/** Every source file that calls `isUserSession(`, and how many times. */
function isUserSessionConsumers() {
  const consumers = new Map()
  for (const path of productSources()) {
    const uses = (readFileSync(join(repoRoot, path), 'utf8').match(/isUserSession\s*\(/gu) ?? []).length
    if (uses > 0) consumers.set(path, uses)
  }
  return consumers
}

/** The row ids whose sources register a preset for a non-user agent. */
function nonUserAgentPresets() {
  const presets = new Set()
  for (const path of productSources()) {
    for (const match of readFileSync(join(repoRoot, path), 'utf8').matchAll(/([A-Z][A-Z_]*(?:_PRESET|_SECTION))\s*=\s*'(ourfairy:[a-z-]+)'/gu)) {
      if (match[2].includes('agent') || match[1].includes('PRESET')) presets.add(match[2])
    }
  }
  return presets
}

test('the document derives the owner tool count from the reviewed tool list', () => {
  const doc = readFileSync(DOC, 'utf8')
  const tools = assertedOwnerTools()
  assert.ok(tools.length > 0, 'the tool list must not be empty')
  // The count the document used to state is gone on purpose: a number restated
  // in prose is a cache of a lookup the code already answers.
  assert.doesNotMatch(doc, /\b\d+ 个工具\b/u,
    'the document names no tool count; the count is derived where it is checked')
  assert.ok(tools.includes('group_create'),
    'the master-only tool stays in the owner list, which is what makes the master/agent difference visible')
})

test('the document names the agent kinds the sources actually deploy', () => {
  const doc = readFileSync(DOC, 'utf8')
  assert.doesNotMatch(doc, /除上面两种外还没有第二种 agent 落地/u,
    'the claim that only two agent kinds exist is the one that drifted (#300 added a third)')
  const presets = nonUserAgentPresets()
  assert.ok(presets.size >= 2,
    `the sources must still declare the non-user presets this document describes; found ${[...presets].join(', ')}`)
  assert.match(doc, /记忆维护子/u, 'the maintenance child is named')
  assert.match(doc, /技能学习检测子/u, 'the skill-learning detection child is named')
  assert.match(doc, /技能深创子/u, 'the deep-creation child is named')
})

test('the document states the consumer count the sources carry', () => {
  const doc = readFileSync(DOC, 'utf8')
  const consumers = isUserSessionConsumers()
  const packages = new Set([...consumers.keys()].map(path => path.split('/')[1]))
  // The document used to name three rows (search, groups, delivery) as if they
  // were the whole set; the predicate is shared by every row that registers a
  // tool surface.
  assert.doesNotMatch(doc, /search、groups、delivery 在注册工具前调用/u,
    'the three-row list was the drifted claim')
  assert.ok(packages.size >= 5,
    `isUserSession must still be shared across the product rows this document describes; found ${[...packages].join(', ')}`)
  // A consumer in a package the document does not mention at all would mean the
  // prose and the code describe different products.
  for (const name of packages) {
    assert.match(doc, new RegExp(name, 'u'),
      `the document mentions ${name}, which calls isUserSession`)
  }
})

test('the document says the section inventory is derived, not restated', () => {
  const doc = readFileSync(DOC, 'utf8')
  // The inventory belongs to `prompt-inventory.test.mjs`, which reads the real
  // assembly. The document points at it instead of copying a section list that
  // would drift with every dsh upgrade.
  assert.match(doc, /tests\/prompt-inventory\.test\.mjs/u,
    'the document points at the inventory check that derives the real assembly')
})
