/**
 * One bwrap argv constructor, two network profiles.
 *
 * End-to-end tests cannot observe whether a PDF parser had the network: the
 * namespace is gone before any assertion could read it. The constructor is the
 * seam that decides it, so this asserts the two profiles the product builds —
 * spaces scripts share the host network, the PDF worker does not — and that a
 * profile cannot stay silent about the choice.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildBwrapArgv } from '../backend/spaces/dist/bwrap.js'

const profile = network => ({ workspaceRoot: '/tmp/workspace', writable: true, readRoots: [], network })

test('the spaces script profile shares the host network and the PDF worker profile does not', () => {
  const scripts = buildBwrapArgv('bwrap', profile(true), ['bash', '-c', 'true'])
  assert.ok(scripts.includes('--share-net'), 'scripts keep the product decision to allow networking')
  const pdf = buildBwrapArgv('bwrap', profile(false), ['/usr/bin/python3', 'worker.py'])
  assert.ok(!pdf.includes('--share-net'), 'the PDF worker must not receive the host network')
  assert.throws(() => buildBwrapArgv('bwrap', { workspaceRoot: '/tmp/workspace' }, ['true']), /network/u,
    'a bwrap profile must state whether it shares the host network')
})
