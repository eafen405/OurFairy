/**
 * Relative links in the repository's Markdown must resolve.
 *
 * The cleanup wave deleted files and rewrote the notes pointing at them; seven
 * links kept pointing at nothing, two of them in the evidence index that exists
 * to be the entry point. Nothing checked file references, so nothing noticed.
 *
 * This asserts that a referenced file exists — not that the prose around it is
 * still true, which stays a review question.
 *
 * The subject is the TRACKED Markdown, read from `git ls-files`. Reading the
 * working tree instead made this gate answer for files no one committed: a
 * scratch note under the gitignored `work/tmp/` turned the whole suite red, and
 * the failure named a file the repository does not contain. `git ls-files`
 * cannot see an untracked file, so that class is gone; a real broken link in a
 * committed document still fails.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

/**
 * Every tracked Markdown file, as a path relative to the repository root.
 *
 * Dot directories are excluded: `android/.agents/` is a vendored upstream skill
 * bundle whose links point at the upstream project, so they are citations in a
 * language this check does not own. `.github/` holds a template whose links are
 * resolved on GitHub, not beside the file.
 * @returns the tracked Markdown paths.
 */
function markdownFiles() {
  return execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(path => path !== '' && !path.split('/').some(segment => segment.startsWith('.')))
}

/**
 * Every link target on one line, with fenced code blocks already removed.
 *
 * A fenced block carries source code, and code is full of `](` sequences that
 * are not links: `param.NewOpt[int64](2000)` in a Go sample reads as a link to
 * `2000`, which exists nowhere. The fence is tracked per file, so a link on a
 * line between two fences is skipped and a link outside them is checked.
 * @param text - the file's content.
 * @returns the link targets.
 */
function linkTargets(text) {
  const targets = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/gu)) targets.push(match[1])
  }
  return targets
}

test('every relative link in the repository Markdown resolves', () => {
  const broken = []
  for (const path of markdownFiles()) {
    const file = join(repoRoot, path)
    for (const target of linkTargets(readFileSync(file, 'utf8'))) {
      // Absolute paths and URLs name sources outside this repository — the
      // companion checkouts under ~/projects — so they are citations, not links.
      if (/^(?:[a-z]+:|#|<|\/|~)/iu.test(target)) continue
      if (!existsSync(resolve(dirname(file), target.split('#')[0]))) broken.push(`${path} -> ${target}`)
    }
  }
  assert.deepEqual(broken, [], `Markdown links must resolve; broken:${'\n'}${broken.join('\n')}`)
})
