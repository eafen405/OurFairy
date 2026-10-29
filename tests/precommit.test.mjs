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
 * choice, not a coverage claim: the selector reads the changed path's direct
 * references in a test body plus any `@covers backend/<package>` line the file
 * writes for itself; whether a suite that drives a package through the launcher
 * carries that line is the suite's own call, a package no test declares or names
 * falls to `typecheck`, and the closing ticket runs the full suite.
 *
 * The commands themselves are not run: this file pins the classification, the
 * selection, and the command list, and the hook's own run is what proves the
 * suite still passes.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  DOCS_COMMANDS,
  FULL_COMMANDS,
  TYPECHECK_COMMANDS,
  classify,
  plan,
  relatedTests,
  stagedPaths,
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

test('a package a suite drives through the launcher is selected by that suite’s declaration', () => {
  // The delivery suites reach the row through `/chat/send` and the product's own
  // routes; they import no delivery source, so naming the package in the body is
  // the only way the selector could ever see them. The declaration is that name.
  const decision = plan(['backend/delivery/src/index.ts'])
  assert.equal(decision.mode, 'related', 'delivery has behaviour suites, so the gate must run them instead of the type check')
  // The last two call `deliver_message` as one step of another subject: search
  // needs a delivered message to find, and the row suite asserts the tool is
  // gone once its row is disabled. That second assertion also passes when the
  // row never registered the tool, so the three suites above — not this list —
  // carry the behaviour claim.
  for (const file of ['tests/text-delivery.test.mjs', 'tests/file-delivery.test.mjs', 'tests/delivery-row.test.mjs',
    'tests/conversation-search.test.mjs', 'tests/row-addressability.test.mjs']) {
    assert.ok(
      decision.tests.includes(file),
      `a delivery source change must select ${file}; the gate selected ${decision.tests.join(', ') || '(none)'}`,
    )
  }
})

test('a speech source change selects the suites that drive the speech route', () => {
  const tests = plan(['backend/speech/src/service.ts']).tests
  // `speech` owns the subject; the other two call the route from outside it —
  // the gateway suite exercises the configured ASR route, and the host-fence
  // case asserts `/speech` rejects an untrusted authority before its body.
  for (const file of ['tests/speech.test.mjs', 'tests/gateway.test.mjs', 'tests/identity-http.test.mjs']) {
    assert.ok(
      tests.includes(file),
      `speech has a behaviour suite; the gate selected ${tests.join(', ') || '(none)'}`,
    )
  }
})

test('a memory source change selects every memory suite that drives its tools', () => {
  const tests = plan(['backend/memory/src/index.ts']).tests
  // `native-compaction` scripts a `memory_search` tool call through the model
  // double and asserts the compacted session can still make it.
  for (const suite of ['memory-crud', 'memory-impression', 'memory-policy', 'memory-maintenance', 'memory-maintenance-recovery', 'native-compaction']) {
    const file = `tests/${suite}.test.mjs`
    assert.ok(tests.includes(file), `a memory source change must select ${file}; the gate selected ${tests.join(', ') || '(none)'}`)
  }
})

test('a groups or search source change selects the suites that drive those tools', () => {
  const groups = plan(['backend/groups/src/index.ts']).tests
  // `groups` and `groups-row` own the subject. The rest call a group tool for
  // their own scenario: a group root to deliver into, a tool result to carry
  // into the next turn, and the disabled-row catalog.
  for (const file of ['tests/groups.test.mjs', 'tests/groups-row.test.mjs', 'tests/file-delivery.test.mjs',
    'tests/conversation-search.test.mjs', 'tests/text-delivery.test.mjs', 'tests/row-addressability.test.mjs']) {
    assert.ok(groups.includes(file), `a groups source change must select ${file}; the gate selected ${groups.join(', ') || '(none)'}`)
  }
  const search = plan(['backend/search/src/index.ts']).tests
  // `conversation-search` owns the subject; `session-archive` searches across
  // archived sessions, and `memory-maintenance` proves search never reaches the
  // ownerless maintenance child.
  for (const file of ['tests/conversation-search.test.mjs', 'tests/session-archive.test.mjs', 'tests/memory-maintenance.test.mjs']) {
    assert.ok(search.includes(file), `a search source change must select ${file}; the gate selected ${search.join(', ') || '(none)'}`)
  }
})

test('an attachments source change selects the suites that drive its routes', () => {
  const tests = plan(['backend/attachments/src/index.ts']).tests
  // `attachments` and `pdf` own the subject. The others upload through
  // `/attachments/propose`, `/chunk` and `/complete` to get a qualified file:
  // delivery's recipient qualification, the gateway suite's image turn, the
  // image-offload and maintenance-material cases, and the host fence's
  // representative attachments entry point.
  for (const file of ['tests/attachments.test.mjs', 'tests/pdf.test.mjs', 'tests/file-delivery.test.mjs',
    'tests/gateway.test.mjs', 'tests/native-compaction.test.mjs', 'tests/memory-maintenance.test.mjs',
    'tests/identity-http.test.mjs']) {
    assert.ok(tests.includes(file), `an attachments source change must select ${file}; the gate selected ${tests.join(', ') || '(none)'}`)
  }
})

test('a chat source change selects the suites that drive its non-bootstrap routes', () => {
  const tests = plan(['backend/chat/src/service.ts']).tests
  // `/chat/send` and `/chat/read` are the bootstrap every suite walks, so a
  // suite that only does that is not associated. These drive the rest of the
  // row's surface: the live observer, checkpoints, job output and stop, page
  // reads, receipts and explicit turn stops.
  for (const file of ['tests/chat-cold-boundary.test.mjs', 'tests/chat-multi-observer.test.mjs',
    'tests/chat-stream-backpressure.test.mjs', 'tests/jobs.test.mjs', 'tests/remote-chat.test.mjs',
    'tests/native-rows.test.mjs']) {
    assert.ok(tests.includes(file), `a chat source change must select ${file}; the gate selected ${tests.join(', ') || '(none)'}`)
  }
})

test('a gateway source change selects the suites that drive its routes', () => {
  const tests = plan(['backend/gateway/src/service.ts']).tests
  // `gateway` and `gateway-service` own the subject. The settings suites read
  // and write `/gateway/read`, `/gateway/maintenance`, `/gateway/compaction` and
  // `/gateway/selection`; the other two use those routes from their own subject.
  for (const file of ['tests/gateway-maintenance-settings.test.mjs', 'tests/gateway-compaction-settings.test.mjs',
    'tests/memory-maintenance.test.mjs', 'tests/identity-http.test.mjs']) {
    assert.ok(tests.includes(file), `a gateway source change must select ${file}; the gate selected ${tests.join(', ') || '(none)'}`)
  }
})

test('an identity source change selects the suite that drives its credential routes', () => {
  const tests = plan(['backend/identity/src/routes.ts']).tests
  // Every suite signs in, so `/identity/sign-in` alone is not an association.
  // This one asserts identity's own semantics: invitation, registration, the
  // session read, the agent roster, sign-out, and the refusals of each.
  assert.ok(
    tests.includes('tests/identity-http.test.mjs'),
    `identity has a behaviour suite; the gate selected ${tests.join(', ') || '(none)'}`,
  )
})

test('a sessions source change selects the suite that drives archive and restore', () => {
  const tests = plan(['backend/sessions/src/http.ts']).tests
  // `/sessions/create` and `/sessions/read` are bootstrap every suite walks;
  // archive and restore are this suite's own subject.
  assert.ok(
    tests.includes('tests/session-archive.test.mjs'),
    `a sessions source change must select the archive suite; the gate selected ${tests.join(', ') || '(none)'}`,
  )
})

test('a declaration associates only the package it names', () => {
  const tests = relatedTests(['backend/chat/src/units.ts'], { root: repoRoot })
  assert.ok(tests.includes('tests/chat-read-window.test.mjs'), 'the chat package still selects the suites that name it')
  assert.ok(!tests.includes('tests/memory-crud.test.mjs'), 'a memory declaration must not select memory for a chat change')
})

test('a staged test file selects itself', () => {
  const paths = ['tests/chat-read-window.test.mjs']
  assert.equal(classify(paths), 'related')
  assert.deepEqual(plan(paths).tests, ['tests/chat-read-window.test.mjs'])
})

test('a source change no test names falls back to the type check', () => {
  // The path is assembled rather than written out: a test file that names a
  // package is selected for that package, so writing it here would make this
  // file select itself and the case could never hold. It is a real source file:
  // the acceptance script needs the deployment's real credentials, so no suite
  // drives it — the one property this mode needs of its input.
  const unreferenced = ['scripts', 'real-acceptance.ts'].join('/')
  assert.equal(classify([unreferenced]), 'typecheck', 'no test names this script, so the gate must not claim behaviour coverage')
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

test('a staged Android rename keeps both paths in the Gradle gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-precommit-rename-'))
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git(['init', '--quiet', '--initial-branch=main'])
    git(['config', 'user.email', 'fixture@example.invalid'])
    git(['config', 'user.name', 'Fixture'])
    git(['config', 'diff.renames', 'true'])
    mkdirSync(join(root, 'android'), { recursive: true })
    writeFileSync(join(root, 'android', 'A.kt'), 'val renamed = 1\n')
    git(['add', '.'])
    git(['commit', '--quiet', '-m', 'initial'])
    mkdirSync(join(root, 'scripts'), { recursive: true })
    git(['mv', 'android/A.kt', 'scripts/A.ts'])

    const paths = stagedPaths(root)

    assert.deepEqual(paths.sort(), ['android/A.kt', 'scripts/A.ts'])
    assert.ok(plan(paths).commands.some(step => step.command === './gradlew' && step.cwd === 'android'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
