/**
 * combo.json is the authority for the companion build commands (#335).
 *
 * The CI workflow used to spell the four `repos.dsh.requiredBuild` commands out
 * a second time in a bash `for step in` loop. Nothing read the recorded list, so
 * adding, changing, or deleting a step left CI running the old commands, and a
 * missing step only showed up at run time as a missing module. The `build`
 * subcommand now executes the recorded list in each checkout. The workflow test
 * runs its build step in a fixture and observes the recorded commands' effects,
 * including after the record changes. A literal scan also flags familiar copies
 * of build commands as a quick hint; it does not prove that no copy can exist.
 *
 * Editing or deleting a recorded step is an authoritative edit: it changes the
 * next build by design.
 *
 * This file imports only `scripts/combo.ts`, so it runs without a product build
 * or a dsh checkout — the plain `node --test tests/combo-build.test.mjs` entry
 * works from a bare clone.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot, requiredBuildSteps, runRequiredBuild } from '../scripts/combo.ts'

/**
 * A fixture combination whose repositories record `requiredBuild` chains.
 *
 * Each repository gets a `<localPath>/.git` directory, which is as much of a
 * checkout as the executor asserts: resolving the path and finding something to
 * build in it. The real git work is irrelevant to reading the recorded steps.
 * @param {Record<string, { localPath?: string, requiredBuild?: unknown }>} repos
 * @returns the fixture root holding combo.json.
 */
function buildFixture(repos) {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-combo-build-'))
  const recorded = {}
  for (const [key, entry] of Object.entries(repos)) {
    const localPath = entry.localPath ?? key
    mkdirSync(join(root, localPath, '.git'), { recursive: true })
    recorded[key] = {
      role: 'backend-harness',
      lock: 'commit',
      localPath,
      integrationBranch: 'main',
      productCommit: 'a'.repeat(40),
      ...entry,
    }
  }
  writeFileSync(join(root, 'combo.json'), JSON.stringify({ schemaVersion: 1, product: 'test', repos: recorded }))
  return root
}

/**
 * Run `body` with the dsh path override cleared.
 *
 * `repoPath` reads `OURFAIRY_DSH_DIR` before the recorded `localPath`, so a
 * developer machine that sets it would point these fixtures at its own checkout
 * instead of the temporary one under test.
 * @param {() => unknown} body
 * @returns whatever `body` returns.
 */
function withRecordedPaths(body) {
  const saved = process.env.OURFAIRY_DSH_DIR
  delete process.env.OURFAIRY_DSH_DIR
  try {
    return body()
  } finally {
    if (saved !== undefined) process.env.OURFAIRY_DSH_DIR = saved
  }
}

/** A runner that records the commands instead of spawning a shell. */
function recordingRunner() {
  const calls = []
  const run = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd })
    return { status: 0 }
  }
  return { calls, run }
}

test('the recorded build steps run through the shell in the dsh checkout in order', () => {
  const root = buildFixture({ dsh: { requiredBuild: ['install-step', 'build:lib:host', 'build:native-system'] } })
  const dsh = join(root, 'dsh')
  const { calls, run } = recordingRunner()
  try {
    const executed = withRecordedPaths(() => runRequiredBuild({ root, run }))
    assert.equal(executed, 3, 'the executor must report every step it ran')
    assert.deepEqual(
      calls.map(call => call.command),
      ['bash', 'bash', 'bash'],
      'a recorded step is a shell command line, so it runs through bash',
    )
    assert.deepEqual(
      calls.map(call => call.args),
      [['-c', 'install-step'], ['-c', 'build:lib:host'], ['-c', 'build:native-system']],
      'the recorded order is the execution order',
    )
    assert.deepEqual(calls.map(call => call.cwd), [dsh, dsh, dsh], 'every step runs in the resolved dsh checkout')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every repository that records build steps contributes, not just dsh', () => {
  const root = buildFixture({
    dsh: { requiredBuild: ['dsh-step'] },
    tooling: { requiredBuild: ['tooling-step-a', 'tooling-step-b'] },
  })
  const { calls, run } = recordingRunner()
  try {
    withRecordedPaths(() => runRequiredBuild({ root, run }))
    assert.deepEqual(
      calls.map(call => [call.args[1], call.cwd]),
      [['dsh-step', join(root, 'dsh')], ['tooling-step-a', join(root, 'tooling')], ['tooling-step-b', join(root, 'tooling')]],
      'the executor walks the combination records instead of hardcoding one repository key',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('deleting a recorded step deletes it from the next build', () => {
  const root = buildFixture({ dsh: { requiredBuild: ['install-step', 'build:lib:host', 'build:native-system'] } })
  try {
    const full = recordingRunner()
    withRecordedPaths(() => runRequiredBuild({ root, run: full.run }))
    assert.deepEqual(
      full.calls.map(call => call.args[1]),
      ['install-step', 'build:lib:host', 'build:native-system'],
      'the whole recorded chain runs',
    )
    // Only the record changes: the executor has no command list of its own.
    const combo = JSON.parse(readFileSync(join(root, 'combo.json'), 'utf8'))
    combo.repos.dsh.requiredBuild = ['install-step', 'build:native-system']
    writeFileSync(join(root, 'combo.json'), JSON.stringify(combo))
    const reduced = recordingRunner()
    withRecordedPaths(() => runRequiredBuild({ root, run: reduced.run }))
    assert.deepEqual(
      reduced.calls.map(call => call.args[1]),
      ['install-step', 'build:native-system'],
      'deleting a step from combo.json must mean the next run does not execute it',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed step stops the chain and names the repository, command, and exit code', () => {
  const root = buildFixture({ dsh: { requiredBuild: ['install-step', 'broken-step', 'never-step'] } })
  const ran = []
  const run = (command, args) => {
    ran.push(args[1])
    return { status: args[1] === 'broken-step' ? 7 : 0 }
  }
  try {
    assert.throws(
      () => withRecordedPaths(() => runRequiredBuild({ root, run })),
      error => {
        assert.match(error.message, /repos\.dsh\.requiredBuild/u, 'the failure must name the recorded list')
        assert.match(error.message, /"broken-step"/u, 'the failure must quote the command that failed')
        assert.match(error.message, /exit code 7/u, 'the failure must carry the exit code')
        assert.match(error.message, new RegExp(join(root, 'dsh').replaceAll('\\', '\\\\'), 'u'), 'the failure must name the checkout')
        return true
      },
    )
    assert.deepEqual(ran, ['install-step', 'broken-step'], 'a failed step must stop the chain instead of running the rest')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a build whose checkout is missing names the directory instead of spawning', () => {
  const root = buildFixture({ dsh: { requiredBuild: ['install-step'] } })
  const dsh = join(root, 'dsh')
  rmSync(dsh, { recursive: true, force: true })
  const { calls, run } = recordingRunner()
  try {
    assert.throws(
      () => withRecordedPaths(() => runRequiredBuild({ root, run })),
      error => {
        assert.match(error.message, /repos\.dsh/u, 'the failure must name the repository')
        assert.ok(error.message.includes(dsh), `the failure must name the missing checkout ${dsh}: ${error.message}`)
        assert.match(error.message, /OURFAIRY_DSH_DIR/u, 'the failure must name the override that points at it')
        return true
      },
    )
    assert.deepEqual(calls, [], 'a missing checkout must fail before any command runs')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a combination that records no build steps is a configuration error, not an empty build', () => {
  const root = buildFixture({ dsh: {} })
  try {
    assert.throws(
      () => withRecordedPaths(() => requiredBuildSteps({ root })),
      error => {
        assert.ok(error.message.includes(join(root, 'combo.json')), `the failure must name combo.json: ${error.message}`)
        assert.match(error.message, /requiredBuild/u, 'the failure must name what is missing')
        return true
      },
    )
    assert.throws(
      () => withRecordedPaths(() => runRequiredBuild({ root, run: recordingRunner().run })),
      /requiredBuild/u,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an empty or malformed build record is a configuration error naming the repository', () => {
  for (const recorded of [[], ['install-step', ''], [42]]) {
    const root = buildFixture({ dsh: { requiredBuild: recorded } })
    try {
      assert.throws(
        () => withRecordedPaths(() => requiredBuildSteps({ root })),
        /repos\.dsh\.requiredBuild/u,
        `a recorded ${JSON.stringify(recorded)} must be refused rather than silently skipped`,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

/** Extract only this workflow's named build step and literal run block for Bash. */
function workflowBuildRun(workflow) {
  const lines = workflow.split('\n')
  const start = lines.indexOf('      - name: Build the locked dsh combination')
  assert.ok(start >= 0, 'the workflow must have the named combination build step')
  const run = start + 1
  assert.equal(lines[run], '        run: |', 'the build step must expose its literal run block')
  const body = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() === '') {
      body.push('')
      continue
    }
    if (!line.startsWith('          ')) break
    body.push(line.slice(10))
  }
  assert.ok(body.some(line => line.trim() !== ''), 'the build run block must not be empty')
  return body.join('\n')
}

test('the workflow build step executes the combination record and follows edits and deletions', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'check.yml'), 'utf8')
  const script = workflowBuildRun(workflow)
  const root = buildFixture({ dsh: { requiredBuild: ['node ../witness.cjs first', 'node ../witness.cjs second'] } })
  try {
    mkdirSync(join(root, 'scripts'))
    for (const name of ['combo.ts', 'ourfairy-composition.ts', 'cli-guard.ts']) {
      cpSync(join(repoRoot, 'scripts', name), join(root, 'scripts', name))
    }
    // The workflow may enable corepack, but this fixture never installs packages.
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'corepack'), '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = enable ]\n', { mode: 0o755 })
    writeFileSync(join(root, 'witness.cjs'), `
      const { appendFileSync } = require('node:fs')
      appendFileSync(process.env.BUILD_WITNESS, JSON.stringify({ step: process.argv[2], cwd: process.cwd() }) + '\\n')
    `)
    const witness = join(root, 'build.jsonl')
    const expected = steps => steps.map(step => ({ step, cwd: join(root, 'dsh') }))
    const assertBuild = (buildScript, steps) => {
      writeFileSync(witness, '')
      const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', buildScript], {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OURFAIRY_DSH_DIR: join(root, 'dsh'), BUILD_WITNESS: witness },
        encoding: 'utf8',
        timeout: 30_000,
      })
      assert.equal(run.status, 0, `the workflow build script must succeed:\n${run.stdout}\n${run.stderr}`)
      const records = readFileSync(witness, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      assert.deepEqual(records, expected(steps), 'the workflow must execute the current recorded steps, in order and in their checkout')
    }
    assertBuild(script, ['first', 'second'])

    const combo = JSON.parse(readFileSync(join(root, 'combo.json'), 'utf8'))
    combo.repos.dsh.requiredBuild = ['node ../witness.cjs changed', 'node ../witness.cjs second']
    writeFileSync(join(root, 'combo.json'), JSON.stringify(combo))
    assertBuild(script, ['changed', 'second'])
    combo.repos.dsh.requiredBuild = ['node ../witness.cjs changed']
    writeFileSync(join(root, 'combo.json'), JSON.stringify(combo))
    assertBuild(script, ['changed'])

    // A comment naming the executor cannot stand in for running it. Exercise
    // the same extraction and witness assertion on the previously missed drift.
    const commented = workflow.replace('          node scripts/combo.ts build', '          # node scripts/combo.ts build\n          :')
    assert.notEqual(commented, workflow, 'the negative case must replace the actual executor invocation')
    assert.throws(
      () => assertBuild(workflowBuildRun(commented), ['changed']),
      { code: 'ERR_ASSERTION', message: /the workflow must execute the current recorded steps/u },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the workflow has no familiar build command literals as a drift hint', () => {
  const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'check.yml'), 'utf8')
  // This heuristic catches familiar copies, including ones in comments. It is
  // not a check of shell behavior or a guarantee against other spellings.
  for (const copied of [
    'build:lib:host',
    'build:lib:client',
    'build:native-system',
    'corepack pnpm@11.28.5 run build',
    'for step in',
  ]) {
    assert.ok(
      !workflow.includes(copied),
      `possible copied build command ${JSON.stringify(copied)} in check.yml; keep build commands in combo.json`,
    )
  }
  const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
  for (const [key, entry] of Object.entries(combo.repos)) {
    for (const recorded of entry.requiredBuild ?? []) {
      assert.ok(
        !workflow.includes(recorded),
        `possible copy of repos.${key}.requiredBuild step ${JSON.stringify(recorded)} in check.yml`,
      )
    }
  }
})

test('the real combination record is executed step by step, in order', () => {
  // Not a hand-written fixture record: copy the combo.json this checkout ships,
  // then give each recording repository a placeholder checkout so the executor
  // can resolve it. The injected runner records argv, so no pnpm command runs.
  // Deleting or editing a step in combo.json is an authoritative edit and
  // changes the next build by design; this test only refuses an executor that
  // drops a recorded step, reorders it, or stops calling the record.
  const parent = mkdtempSync(join(tmpdir(), 'ourfairy-combo-real-'))
  const root = join(parent, 'repo')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'combo.json'), readFileSync(join(repoRoot, 'combo.json')))
  try {
    const recorded = withRecordedPaths(() => requiredBuildSteps({ root }))
    assert.ok(recorded.length > 0, 'the real combination must record at least one build chain')
    for (const build of recorded) mkdirSync(join(build.dir, '.git'), { recursive: true })
    const { calls, run } = recordingRunner()
    const executed = withRecordedPaths(() => runRequiredBuild({ root, run }))
    const expected = recorded.flatMap(build => build.steps.map(step => ({ step, cwd: build.dir })))
    assert.equal(executed, expected.length, 'every step in the real record must run')
    assert.deepEqual(
      calls.map(call => ({ step: call.args[1], cwd: call.cwd })),
      expected,
      'the real combo.json record must run verbatim, in the recorded order',
    )
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('build --print resolves the recorded commands without running them', () => {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-combo-print-'))
  const dsh = join(root, 'dsh')
  mkdirSync(join(dsh, '.git'), { recursive: true })
  const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
  const recorded = combo.repos.dsh.requiredBuild
  try {
    const run = spawnSync(process.execPath, ['scripts/combo.ts', 'build', '--print'], {
      cwd: repoRoot,
      env: { ...process.env, OURFAIRY_DSH_DIR: dsh },
      encoding: 'utf8',
    })
    // Executing the real pnpm chain in this empty directory would fail, so a
    // zero exit is what distinguishes the dry run from the executor.
    assert.equal(run.status, 0, `build --print must not execute the recorded commands:\n${run.stdout}\n${run.stderr}`)
    assert.ok(run.stdout.includes(dsh), `the dry run must name the resolved checkout ${dsh}:\n${run.stdout}`)
    for (const step of recorded) {
      assert.ok(run.stdout.includes(step), `the dry run must print the recorded step ${JSON.stringify(step)}:\n${run.stdout}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('build is a named command, not reported as unknown', () => {
  const run = spawnSync(process.execPath, ['scripts/combo.ts', 'bogus-command'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(run.status, 2, 'an unknown command must keep exiting 2')
  assert.match(run.stderr, /'verify', 'show' or 'build'/u, 'the dispatch error must list build among the commands')
})
