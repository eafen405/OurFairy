/**
 * Resolve the pinned dsh checkout's modules for tests that import product
 * source directly.
 *
 * Production resolves `@deepseek-ai/*` peers and the product's own `zod`
 * dependency through the profile install the launcher builds; a bare worktree
 * has no `node_modules`. A test that exercises a product module in isolation
 * therefore points Node's resolver at the same pinned commit `combo.json`
 * locks — the `localPath` checkout whose `lib/` artifacts the combination
 * build already produced — the same way the existing suites load the model
 * double from that checkout.
 *
 * Import this module first, then load the product module with a dynamic
 * `import()`: a static import graph is resolved before any module body runs,
 * so a hook registered at evaluation time cannot answer for it.
 */
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dshDir, repoRoot } from './backend.mjs'

/**
 * Each package's own manifest anchors Node's lookup, so a subpath export
 * (`@deepseek-ai/dsh-session/surface`) resolves through that package's
 * `exports` map instead of a hand-written file path.
 */
const anchors = {
  '@deepseek-ai/cordis': join(dshDir, 'vendor', 'cordis', 'package.json'),
  '@deepseek-ai/dsh-app-boot': join(dshDir, 'packages', 'boot', 'app-boot', 'package.json'),
  '@deepseek-ai/dsh-session': join(dshDir, 'packages', 'core', 'session', 'package.json'),
  '@deepseek-ai/dsh-session-projection': join(dshDir, 'packages', 'session', 'session-projection', 'package.json'),
  '@deepseek-ai/dsh-llm': join(dshDir, 'packages', 'llm', 'llm', 'package.json'),
  '@deepseek-ai/dsh-llm-pi-ai': join(dshDir, 'packages', 'llm', 'llm-pi-ai', 'package.json'),
  '@deepseek-ai/dsh-llm-mock-server': join(dshDir, 'packages', 'test-support', 'llm-mock-server', 'package.json'),
  '@deepseek-ai/dsh-agent': join(dshDir, 'packages', 'core', 'agent', 'package.json'),
  '@deepseek-ai/dsh-jobs': join(dshDir, 'packages', 'jobs', 'jobs', 'package.json'),
  '@deepseek-ai/schemastery': join(dshDir, 'vendor', 'schemastery', 'package.json'),
  '@ourfairy/dsh-identity': join(repoRoot, 'backend', 'identity', 'package.json'),
  '@ourfairy/dsh-sessions': join(repoRoot, 'backend', 'sessions', 'package.json'),
  zod: join(dshDir, 'package.json'),
}

/** The first two path segments of a specifier: the package a bare request names. */
function packageOf(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const anchor = anchors[packageOf(specifier)]
    if (anchor === undefined) return nextResolve(specifier, context)
    return nextResolve(specifier, { ...context, parentURL: pathToFileURL(anchor).href })
  },
})

/** Resolve one specifier the way the hook would, for tests that need its path. */
export function resolveDshPeer(specifier) {
  const anchor = anchors[packageOf(specifier)]
  if (anchor === undefined) throw new Error(`no dsh anchor for ${specifier}`)
  return createRequire(anchor).resolve(specifier)
}
