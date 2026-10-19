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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const dshRoot = process.env.OURFAIRY_DSH_DIR ?? combo.repos.dsh.localPath

/**
 * Each package's own manifest anchors Node's lookup, so a subpath export
 * (`@deepseek-ai/dsh-session/surface`) resolves through that package's
 * `exports` map instead of a hand-written file path.
 */
const anchors = {
  '@deepseek-ai/cordis': join(dshRoot, 'vendor', 'cordis', 'package.json'),
  '@deepseek-ai/dsh-session': join(dshRoot, 'packages', 'core', 'session', 'package.json'),
  '@deepseek-ai/dsh-session-projection': join(dshRoot, 'packages', 'session', 'session-projection', 'package.json'),
  '@deepseek-ai/dsh-llm': join(dshRoot, 'packages', 'llm', 'llm', 'package.json'),
  zod: join(dshRoot, 'package.json'),
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
