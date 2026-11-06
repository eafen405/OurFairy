/**
 * Ticket #318: the bill is a real mounted row, not a package nobody composed.
 *
 * The reading address (#319) and the context reading (#320) both consume the
 * service this row publishes, so the row has to be part of the composition
 * before either can exist. The composition is read through dsh's own loader —
 * the same `loadOverlayPatches`/`composeEntries` pair a boot uses — so this
 * file never parses the YAML and never keeps a second copy of the row set.
 *
 * The row belongs to the `plugins` group: stopping that segment must still
 * leave a backend that establishes sessions and runs model turns, and a bill
 * reading is not part of that.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'
import { dshDir, repoRoot } from './helpers/backend.mjs'

const boot = createRequire(join(dshDir, 'apps', 'cli', 'package.json'))('@deepseek-ai/dsh-app-boot')
const bundleDir = join(repoRoot, 'backend', 'v1-bundle')
const rows = boot.composeEntries([boot.loadOverlayPatches('dsh', join(bundleDir, 'cordis.patch.yml'))])

/** The group row's nested children, as the loader composes them. */
function childrenOf(groupId) {
  const group = rows.find(row => row.id === groupId)
  assert.ok(group !== undefined, `the composition must still have a "${groupId}" group`)
  return group.config ?? []
}

/** One row with this id, from anywhere in the composed tree. */
function rowById(id) {
  const matches = []
  const collect = entries => entries.forEach(row => {
    if (row.id === id) matches.push(row)
    if (Array.isArray(row.config)) collect(row.config)
  })
  collect(rows)
  return matches
}

test('the bill row is one row inside the plugins group, not a top-level row', () => {
  const matches = rowById('bill')
  assert.equal(matches.length, 1, `the bill row must be composed exactly once; found ${matches.length}`)
  assert.equal(matches[0].name, '@ourfairy/dsh-bill', 'the row mounts the bill package')

  const plugins = childrenOf('plugins')
  assert.ok(
    plugins.some(row => row.id === 'bill'),
    'the bill row must be a child of the plugins group: stopping that segment has to leave the kernel booting',
  )
  assert.equal(
    childrenOf('kernel').some(row => row.id === 'bill'),
    false,
    'the bill must not be in the kernel group: it is not needed to establish a session or run a turn',
  )
  assert.equal(rows.some(row => row.id === 'bill'), false, 'a top-level row would escape the segment decision')
})

test('the bundle declares the bill package it mounts, as a linked product package', () => {
  const manifest = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
  assert.equal(
    manifest.dependencies['@ourfairy/dsh-bill'],
    'file:../bill',
    'the bundle must declare the bill as a file: dependency so the generated profile links it from this checkout',
  )
})

test('the service answers through the context proxy every consumer actually receives', async () => {
  // A boot caught this: Cordis publishes a service through a proxy, and an
  // instance `#private` field is unreadable through it, so the row would have
  // looked mounted and active while every read threw. This mounts the real
  // service in a real context and reads it the way the address and context
  // tickets will — `ctx.get('ourfairyBill').snapshot()`. The numbers themselves
  // are covered by tests/bill-aggregate.test.mjs; what is pinned here is that
  // the published object can answer at all.
  const { Context } = await import('@deepseek-ai/cordis')
  const exported = await import('../backend/bill/dist/index.js')
  const ctx = new Context()
  ctx.sessions = { get: () => undefined }
  ctx.sessionPersistence = { list: async () => [], stat: async () => undefined }
  ctx.sessionQuery = { readSession: async () => ({ events: [] }) }

  const registered = new exported.Bill(ctx)
  assert.equal(typeof registered.snapshot, 'function', 'the instance itself answers')
  const mounted = ctx.get('ourfairyBill')
  assert.ok(mounted !== undefined, 'the service must be registered under the name consumers read')
  const snapshot = await mounted.snapshot()
  assert.equal(snapshot.days.length, 30, 'a consumer gets the full series from the published object')
  assert.deepEqual(snapshot.allTime, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  assert.equal(registered.constructor, exported.Bill, 'the registered service is this package\'s class')
})

test('the package publishes the reading face the later tickets consume', async () => {
  const exported = await import('../backend/bill/dist/index.js')

  assert.equal(exported.name, 'ourfairy-bill')
  for (const service of ['sessions', 'sessionPersistence', 'sessionQuery']) {
    assert.ok(exported.inject.includes(service), `the row must inject "${service}" to read session logs`)
  }
  assert.equal(typeof exported.apply, 'function', 'the row must mount through apply()')
  assert.equal(typeof exported.Bill, 'function', 'the service must be the composed reading face')
  // `snapshot` is an instance field, not a prototype method: it closes over the
  // aggregate so a Cordis proxy can call it (see the case above).
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  ctx.sessions = { get: () => undefined }
  ctx.sessionPersistence = { list: async () => [], stat: async () => undefined }
  ctx.sessionQuery = { readSession: async () => ({ events: [] }) }
  assert.equal(typeof new exported.Bill(ctx).snapshot, 'function',
    'ctx.ourfairyBill.snapshot() is what the reading address and the context reading call')

  const fold = await import('../backend/bill/dist/fold.js')
  assert.equal(fold.TIME_ZONE, 'Asia/Shanghai', 'every boundary in the product cuts in one named zone')
  assert.equal(typeof fold.foldDailyTokens, 'function')

  const aggregate = await import('../backend/bill/dist/aggregate.js')
  assert.equal(aggregate.SERIES_DAYS, 30, 'the series is the product decision, not a caller parameter')
})
