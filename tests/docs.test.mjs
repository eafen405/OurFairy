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
 *
 * The check needs only the checkout's location and its tracked Markdown: this
 * file imports no local module. It used to take `repoRoot` from the backend
 * test helper, whose module load asserts the product build exists, so the
 * Markdown-only commit gate failed on a clean checkout with 15 missing `dist/`
 * directories before checking a single link. The fixture test at the bottom
 * runs this check in a copy that has the product manifests but no build output
 * and no dsh checkout, and fails if a build-asserting import returns.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

/** The checkout this test file lives in. */
const repoRoot = resolve(import.meta.dirname, '..')

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

/**
 * Git location variables a caller can hand us.
 *
 * Git runs a linked worktree's pre-commit hook with absolute `GIT_DIR` and
 * `GIT_INDEX_FILE` paths (and can set the other names here). This repository's
 * hooks unset them before the gate starts, but the fixture does not depend on
 * that: a direct or wrapped invocation can pass them on. Inherited into the
 * fixture they redirect `git init` and `git add` at the caller's index — the
 * commit in progress — and the child's `git ls-files` at the caller's tree
 * instead of the fixture's.
 */
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX']

test('the link check runs in a checkout with no build output and no dsh checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-docs-no-build-'))
  const env = { ...process.env, OURFAIRY_DSH_DIR: join(root, 'no-such-dsh') }
  // NODE_TEST_CONTEXT would make the child report as a nested part of this
  // run; the GIT_* names are the hook path described above.
  for (const name of ['NODE_TEST_CONTEXT', ...GIT_LOCATION_VARS]) delete env[name]
  try {
    mkdirSync(join(root, 'tests'), { recursive: true })
    cpSync(join(repoRoot, 'tests', 'docs.test.mjs'), join(root, 'tests', 'docs.test.mjs'))
    // The link check imports none of these; they complete the backend helper's
    // import chain so a returning build-asserting import fails with the missing
    // build output rather than a module-resolution error.
    cpSync(join(repoRoot, 'tests', 'helpers'), join(root, 'tests', 'helpers'), { recursive: true })
    cpSync(join(repoRoot, 'scripts'), join(root, 'scripts'), { recursive: true })
    cpSync(join(repoRoot, 'combo.json'), join(root, 'combo.json'))
    // Manifests without their dist/: the shape a fresh clone has. They are
    // copied so that same import finds packages to report the build as missing.
    for (const entry of readdirSync(join(repoRoot, 'backend'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = join(repoRoot, 'backend', entry.name, 'package.json')
      if (!existsSync(manifest)) continue
      mkdirSync(join(root, 'backend', entry.name), { recursive: true })
      cpSync(manifest, join(root, 'backend', entry.name, 'package.json'))
    }
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'README.md'), '# fixture\n\n[docs](docs/README.md)\n')
    writeFileSync(join(root, 'docs', 'README.md'), '# docs\n')
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root, env })
    execFileSync('git', ['add', 'README.md', 'docs/README.md'], { cwd: root, env })
    // Name-filtered: the copied file contains this test as well, and running it
    // unfiltered would recurse. An unmatched pattern still exits 0, so the
    // stdout assertion also proves the link test itself ran.
    const run = spawnSync(process.execPath, [
      '--test', '--test-name-pattern', 'every relative link', 'tests/docs.test.mjs',
    ], { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
    assert.equal(run.status, 0,
      `the link check must run without a product build or dsh checkout:\n${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /every relative link/u, 'the child must actually run the link test, not filter it out')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
