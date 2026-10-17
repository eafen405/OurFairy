/**
 * Relative links in the repository's Markdown must resolve.
 *
 * The cleanup wave deleted files and rewrote the notes pointing at them; seven
 * links kept pointing at nothing, two of them in the evidence index that exists
 * to be the entry point. Nothing checked file references, so nothing noticed.
 *
 * This asserts that a referenced file exists — not that the prose around it is
 * still true, which stays a review question.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

/** Every Markdown file in the repository; dot directories hold other checkouts. */
function markdownFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) markdownFiles(full, out)
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

test('every relative link in the repository Markdown resolves', () => {
  const broken = []
  for (const file of markdownFiles(repoRoot)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/gu)) {
      const target = match[1]
      // Absolute paths and URLs name sources outside this repository — the
      // companion checkouts under ~/projects — so they are citations, not links.
      if (/^(?:[a-z]+:|#|<|\/|~)/iu.test(target)) continue
      const path = resolve(dirname(file), target.split('#')[0])
      if (!existsSync(path)) broken.push(`${relative(repoRoot, file)} -> ${target}`)
    }
  }
  assert.deepEqual(broken, [], `Markdown links must resolve; broken:${'\n'}${broken.join('\n')}`)
})
