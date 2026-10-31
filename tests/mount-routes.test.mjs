/**
 * Ticket #277: a row's published `SURFACE` is the set its mount registers.
 *
 * `mountRoutes` is the seam between the two tables a row keeps — the published
 * addresses and the handlers that serve them — so this file drives it directly
 * with a fake carrier. What it hides: the effect lifetime, the exact-route
 * shape, and the pairing check in both directions. What it does not hide:
 * admission, which stays in each handler (the product rows prove that over real
 * HTTP in their own suites).
 *
 * @covers backend/http — the `mountRoutes` seam: one exact registration per
 * published entry, the effect-owned disposer, and the duplicate-path and
 * handler-pairing refusals.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mountRoutes } from '../backend/http/dist/http.js'

/**
 * A fake context: `effect` runs its body now and keeps the disposer, and
 * `webServer.register` records the route and returns the carrier's disposer.
 */
function fakeContext() {
  const routes = new Map()
  const effects = []
  return {
    ctx: {
      effect(execute, label) {
        const dispose = execute()
        effects.push({ label, dispose })
        return dispose
      },
      webServer: {
        register(route) {
          if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
          routes.set(route.path, route)
          return () => { routes.delete(route.path) }
        },
      },
    },
    routes,
    effects,
  }
}

/** One published address, with exactly the fields `SURFACE` carries. */
const entry = path => ({ path, method: 'POST', auth: 'fence', body: 'json', response: 'json', prefix: 'ticket' })

/** A handler table for the given paths; the handler bodies never run here. */
function handlersFor(...paths) {
  return new Map(paths.map(path => [path, () => undefined]))
}

test('mountRoutes registers exactly the published surface, each path on its own effect', () => {
  const { ctx, routes, effects } = fakeContext()
  const one = () => undefined
  const two = () => undefined
  mountRoutes(ctx, {
    surface: [entry('/ticket/one'), entry('/ticket/two')],
    handlers: new Map([['/ticket/one', one], ['/ticket/two', two]]),
  })

  assert.deepEqual([...routes.keys()], ['/ticket/one', '/ticket/two'],
    'the registered routes are the published surface, in its order')
  for (const [path, handler] of [['/ticket/one', one], ['/ticket/two', two]]) {
    assert.equal(routes.get(path).kind, 'exact', `${path} is registered as an exact route`)
    assert.equal(routes.get(path).handler, handler, `${path} keeps the handler paired with it`)
  }
  // No explicit label: each effect is labelled by its entry's error prefix.
  assert.deepEqual(effects.map(effect => effect.label), ['ticket: /ticket/one', 'ticket: /ticket/two'])
})

test('an explicit label names every effect, and the carrier disposer unregisters that one route', () => {
  const { ctx, routes, effects } = fakeContext()
  mountRoutes(ctx, {
    label: 'ourfairy-ticket',
    surface: [entry('/ticket/one'), entry('/ticket/two')],
    handlers: handlersFor('/ticket/one', '/ticket/two'),
  })
  assert.deepEqual(effects.map(effect => effect.label), ['ourfairy-ticket: /ticket/one', 'ourfairy-ticket: /ticket/two'])

  effects[0].dispose()
  assert.deepEqual([...routes.keys()], ['/ticket/two'], 'disposing one effect releases only its own route')
})

test('a repeated path is refused before anything is registered', () => {
  const { ctx, routes, effects } = fakeContext()
  assert.throws(
    () => mountRoutes(ctx, {
      label: 'ourfairy-ticket',
      surface: [entry('/ticket/one'), entry('/ticket/one')],
      handlers: handlersFor('/ticket/one'),
    }),
    /ourfairy-ticket: duplicate path \/ticket\/one/u,
  )
  assert.equal(routes.size, 0, 'a refused mount must leave the carrier untouched')
  assert.equal(effects.length, 0, 'a refused mount must not leave a half-installed effect')
})

test('a published path without a handler is refused before anything is registered', () => {
  const { ctx, routes, effects } = fakeContext()
  assert.throws(
    () => mountRoutes(ctx, {
      label: 'ourfairy-ticket',
      surface: [entry('/ticket/one'), entry('/ticket/two')],
      handlers: handlersFor('/ticket/one'),
    }),
    /ourfairy-ticket: no handler is registered for \/ticket\/two/u,
  )
  assert.equal(routes.size, 0)
  assert.equal(effects.length, 0)
})

test('a handler outside the surface is refused, so the table cannot mount more than it publishes', () => {
  const { ctx, routes, effects } = fakeContext()
  assert.throws(
    () => mountRoutes(ctx, {
      label: 'ourfairy-ticket',
      surface: [entry('/ticket/one')],
      handlers: handlersFor('/ticket/one', '/ticket/unpublished'),
    }),
    /ourfairy-ticket: \/ticket\/unpublished has a handler but is not in the surface/u,
  )
  assert.equal(routes.size, 0)
  assert.equal(effects.length, 0)
})
