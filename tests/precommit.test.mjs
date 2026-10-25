/**
 * The commit gate's split must stay what it claims (retro finding 3).
 *
 * The hook used to run the whole suite on every commit, `--amend` included. In
 * the 131–137 wave that was 272 commits × ~110 s, and the gate was bypassed
 * with `--no-verify` 27 times — a gate people cannot afford is a gate people
 * route around. The split is a claim ("Markdown-only changes cannot break the
 * backend suite"), so it gets an executable form here rather than a sentence
 * in the hook that nothing checks.
 *
 * The TypeScript migration widened the split from two modes to four: a change
 * that names a related test runs that test, a source change with no related
 * test runs the type check, and only the authorities that decide what every
 * package installs run the whole suite. The selection is a direct-surface
 * choice, not a coverage claim — a package no test imports on purpose falls to
 * `typecheck`, and the closing ticket runs the full suite.
 *
 * The commands themselves are not run: this file pins the classification, the
 * selection, and the command list, and the hook's own run is what proves the
 * suite still passes.
 */
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DOCS_COMMANDS,
  FULL_COMMANDS,
  TYPECHECK_COMMANDS,
  classify,
  plan,
  testFiles,
} from '../scripts/precommit.ts'
import { repoRoot } from './helpers/backend.mjs'

test('a Markdown-only change gets the docs gate, not the backend suite', () => {
  const paths = [
    'work/implementation/evidence/137-launcher-split/README.md',
    'docs/README.md',
    'AGENTS.md',
    'backend/chat/README.md',
  ]
  assert.equal(classify(paths), 'docs')
  assert.deepEqual(plan(paths).commands, DOCS_COMMANDS)
})

test('an Android Markdown-only change stays on the docs gate without Gradle', () => {
  const decision = plan(['android/README.md', 'android/app/src/main/README.md'])
  assert.equal(decision.mode, 'docs')
  assert.deepEqual(decision.commands, DOCS_COMMANDS)
})

test('a message-only amend has no paths and runs the cheap gate', () => {
  assert.equal(classify([]), 'docs', 'an amend of an already-committed tree cannot break the backend')
  assert.deepEqual(plan([]).commands, DOCS_COMMANDS)
})

test('a product package change runs the tests that mention that package', () => {
  const paths = ['backend/chat/dist/units.js']
  assert.equal(classify(paths), 'related', 'a product package change must run its own tests')
  const decision = plan(paths)
  assert.ok(
    decision.tests.includes('tests/chat-read-window.test.mjs'),
    `the selected tests must cover the changed package; the gate selected ${decision.tests.join(', ')}`,
  )
  const commands = decision.commands.map(step => step.args.join(' '))
  assert.ok(commands.includes('run build'), `the related gate must build first: ${commands.join(' | ')}`)
  assert.ok(commands.includes('run combo:verify'), `the related gate must keep the combination check: ${commands.join(' | ')}`)
  assert.ok(
    commands.some(command => command.startsWith('--test ')),
    `the related gate must run the selected tests: ${commands.join(' | ')}`,
  )
})

test('a staged test file selects itself', () => {
  const paths = ['tests/chat-read-window.test.mjs']
  assert.equal(classify(paths), 'related')
  assert.deepEqual(plan(paths).tests, ['tests/chat-read-window.test.mjs'])
})

test('a source change no test names falls back to the type check', () => {
  // The path is assembled rather than written out: a test file that names a
  // package is selected for that package, so writing it here would make this
  // file select itself and the case could never hold.
  const unreferenced = ['backend', 'delivery', 'src', 'index.mjs'].join('/')
  assert.equal(classify([unreferenced]), 'typecheck', 'no test names this package, so the gate must not claim behaviour coverage')
  const decision = plan([unreferenced])
  assert.deepEqual(decision.tests, [])
  assert.deepEqual(decision.commands, TYPECHECK_COMMANDS)
  assert.ok(
    decision.commands.some(step => step.args.join(' ') === 'run typecheck'),
    'the typecheck gate must actually type check',
  )
})

test('the authorities that decide what every package installs run the full suite', () => {
  const cases = [
    ['combo.json'],
    ['package.json'],
    ['tsconfig.json'],
    ['tsconfig.base.json'],
    ['backend/chat/package.json'],
    ['backend/chat/tsconfig.json'],
    ['tests/helpers/backend.mjs'],
    ['tests/helpers/dsh-peers.mjs'],
    ['scripts/precommit.ts'],
    ['scripts/tsc.ts'],
    ['scripts/link-types.ts'],
    ['scripts/cli-guard.ts'],
    ['scripts/package-manifest.ts'],
    ['scripts/ourfairy-composition.ts'],
    ['scripts/ourfairy-backend.ts'],
    ['.github/workflows/check.yml'],
    ['.githooks/pre-commit'],
    ['android/ourfairy-source.json'],
    ['work/implementation/evidence/137-launcher-split/README.md', 'scripts/ourfairy-backend.ts'],
  ]
  for (const paths of cases) {
    assert.equal(classify(paths), 'full', `${paths.join(', ')} must run the full suite`)
  }
})

test('an Android source change keeps the root gate and adds one Gradle check in android/', () => {
  const decision = plan(['android/app/build.gradle.kts', 'android/gradle.properties', 'android/README.md'])
  assert.equal(decision.mode, 'full')
  assert.deepEqual(decision.commands, [
    ...FULL_COMMANDS,
    { command: './gradlew', args: ['test', 'lintDebug'], cwd: 'android' },
  ])
})

test('a merge and an explicit --full run the full suite whatever changed', () => {
  assert.equal(classify(['docs/README.md'], { merge: true }), 'full', 'a merge must be judged as a whole')
  assert.equal(classify(['docs/README.md'], { forceFull: true }), 'full', '--full must force the full suite')
})

test('a selection wider than the limit falls back to the full suite', () => {
  const staged = count => Array.from({ length: count }, (_, index) => `tests/synthetic-${index}.test.mjs`)
  assert.equal(plan(staged(45)).mode, 'related', 'a selection at the limit still runs its own tests')
  assert.equal(plan(staged(46)).mode, 'full', 'a near-full selection must not become a third gate shape')
})

test('every gate keeps the combination check, so drift is caught either way', () => {
  for (const commands of [DOCS_COMMANDS, FULL_COMMANDS, TYPECHECK_COMMANDS]) {
    assert.ok(
      commands.some(step => step.args.join(' ') === 'run combo:verify'),
      'combo:verify is the check that catches a drifted checkout; every gate keeps it',
    )
  }
  const related = plan(['backend/chat/dist/units.js']).commands
  assert.ok(
    related.some(step => step.args.join(' ') === 'run combo:verify'),
    'the related gate keeps the combination check too',
  )
})

test('the hook runs the shared script instead of its own command list', () => {
  const hook = readFileSync(join(repoRoot, '.githooks', 'pre-commit'), 'utf8')
  assert.match(hook, /exec node scripts\/precommit\.ts/u, 'the hook must delegate, or the split is unreachable')
  assert.doesNotMatch(hook, /^npm test$/mu, 'the hook must not keep its own copy of the command list')
})

test('CI runs the full gate on push and manual dispatch, and builds before it tests', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'check.yml'), 'utf8')
  assert.doesNotMatch(workflow, /^ {2}pull_request:/mu, 'a PR sync must not run the full gate')
  assert.match(workflow, /^ {2}workflow_dispatch:/mu, 'the gate must stay manually runnable')
  assert.match(workflow, /- 'integration\/\*\*'/u, 'an integration push must run the gate')
  assert.ok(
    workflow.indexOf('npm run build') >= 0 && workflow.indexOf('npm run build') < workflow.indexOf('npm test'),
    'the build must run before the suite, so a build failure and a test failure stay separate',
  )
})

test('CI runs Android checks in an independent job with the project JDK and Gradle wrapper', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'check.yml'), 'utf8')
  const marker = '\n  android:\n'
  assert.ok(workflow.includes(marker), 'CI must have an Android job separate from the dsh build job')
  const androidJob = workflow.slice(workflow.indexOf(marker) + marker.length).split(/\n  [a-z][a-z0-9-]*:\n/u)[0]
  assert.match(androidJob, /runs-on: ubuntu-latest/u)
  assert.match(androidJob, /uses: actions\/checkout@v4/u)
  assert.match(androidJob, /uses: actions\/setup-java@v4/u)
  assert.match(androidJob, /java-version: '17'/u, 'the project compiles Java and Kotlin for JDK 17')
  assert.match(androidJob, /working-directory: android/u)
  assert.match(androidJob, /run: \.\/gradlew test lintDebug/u)
})

test('CI materializes a synthetic Google Services config for the Android variants', () => {
  const fixture = JSON.parse(readFileSync(join(repoRoot, 'tests', 'fixtures', 'google-services.json'), 'utf8'))
  assert.equal(fixture.project_info.project_id, 'ourfairy-ci')
  assert.deepEqual(
    fixture.client.map(client => client.client_info.android_client_info.package_name).sort(),
    ['me.rerere.rikkahub', 'me.rerere.rikkahub.debug'],
  )
  for (const client of fixture.client) {
    assert.equal(client.api_key[0].current_key, 'ourfairy-ci-fake-key')
  }
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'check.yml'), 'utf8')
  const androidJob = workflow.slice(workflow.indexOf('\n  android:\n') + '\n  android:\n'.length)
  assert.match(
    androidJob,
    /run: cp tests\/fixtures\/google-services\.json android\/app\/google-services\.json/u,
    'CI must copy the fake fixture to the ignored location before Gradle configures the app',
  )
})

test('the related gate selects exactly the files `npm test` runs', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const command = manifest.scripts.test
  const glob = command.match(/^node --test "([^"]+)"$/u)?.[1]
  assert.ok(glob, `the test script must be one quoted glob; it is ${command}`)
  const live = globSync(glob, { cwd: repoRoot }).sort()
  assert.deepEqual(
    testFiles(repoRoot),
    live,
    'a test file the suite runs must stay selectable by the related gate',
  )
})
