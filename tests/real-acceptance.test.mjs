import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { launchEnv, makeHome, removeHome, repoRoot } from './helpers/backend.mjs'

function acceptancePlan(args = []) {
  const run = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'real-acceptance.ts'), '--plan', ...args], {
    cwd: repoRoot,
    env: { ...process.env, VOICE_API_KEY: undefined },
    encoding: 'utf8',
    timeout: 10_000,
  })
  assert.equal(run.status, 0, run.stderr || run.stdout)
  return JSON.parse(run.stdout)
}

test('the real acceptance CLI previews all service checks by default', () => {
  assert.deepEqual(acceptancePlan(), {
    steps: ['text', 'scanPage', 'asr'],
    unexecuted: [],
  })
})

test('--skip-pdf --skip-asr selects text-only acceptance without a voice credential', () => {
  assert.deepEqual(acceptancePlan(['--skip-pdf', '--skip-asr']), {
    steps: ['text'],
    unexecuted: [
      'PDF scan page smoke (--skip-pdf)',
      'ASR transcription (--skip-asr)',
    ],
  })
})

test('text-only acceptance reaches the model boundary without voice credentials or ASR', () => {
  const home = makeHome('ourfairy-real-text-only-')
  try {
    const run = spawnSync(process.execPath, [
      join(repoRoot, 'scripts', 'real-acceptance.ts'), '--home', home, '--skip-pdf', '--skip-asr',
    ], {
      cwd: repoRoot,
      env: launchEnv({
        VOICE_API_KEY: undefined,
        MINIMAX_CN_API_KEY: undefined,
        OURFAIRY_CREDENTIALS_FILE: undefined,
        DSH_HOME: join(home, 'operator-dsh-home'),
      }),
      encoding: 'utf8',
      timeout: 90_000,
    })
    assert.equal(run.status, 1, `the keyless text step should report its existing failure: ${run.stderr}${run.stdout}`)
    const report = JSON.parse(readFileSync(join(home, 'real-acceptance.json'), 'utf8'))
    assert.deepEqual(report.unexecuted, [
      'PDF scan page smoke (--skip-pdf)',
      'ASR transcription (--skip-asr)',
    ])
    assert.equal(report.steps.scanPage, undefined)
    assert.equal(report.steps.asr, undefined)
    assert.ok(report.steps.text, `the selected text step must be attempted: ${JSON.stringify(report)}`)
    const failures = report.failures.join('\n')
    assert.match(failures, /MINIMAX_CN_API_KEY/u)
    assert.doesNotMatch(failures, /VOICE_API_KEY/u)
  } finally {
    removeHome(home)
  }
})
