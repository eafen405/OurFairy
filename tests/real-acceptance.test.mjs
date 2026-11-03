import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
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

test('--plan returns before credential, process, and service side effects', () => {
  const home = makeHome('ourfairy-real-plan-guard-')
  try {
    const guard = join(home, 'plan-guard.cjs')
    writeFileSync(guard, String.raw`
const fs = require('node:fs')
const childProcess = require('node:child_process')
const http = require('node:http')
const https = require('node:https')
const fail = operation => {
  process.exitCode = 97
  throw new Error('--plan attempted ' + operation)
}
const originalRead = fs.readFileSync
fs.readFileSync = (path, ...args) => {
  const name = String(path)
  if (/(?:VOICE_API_KEY[.]env|DEEPSEEK_API_KEY[.]env|[.]credentials[.]yaml)$/u.test(name)) fail('credential read ' + name)
  return originalRead(path, ...args)
}
childProcess.spawnSync = () => fail('process spawn')
http.request = () => fail('HTTP request')
https.request = () => fail('HTTPS request')
globalThis.fetch = () => fail('service fetch')
`)
    writeFileSync(join(home, 'VOICE_API_KEY.env'), 'VOICE_API_KEY=fake\n')
    const control = spawnSync(process.execPath, [
      '--require', guard, '--input-type=module', '-e',
      "import { readFileSync } from 'node:fs'; readFileSync('VOICE_API_KEY.env', 'utf8')",
    ], { cwd: home, encoding: 'utf8', timeout: 10_000 })
    assert.notEqual(control.status, 0, 'the guard must reject a deliberate credential read')
    assert.match(control.stderr, /--plan attempted credential read/u)

    const run = spawnSync(process.execPath, [
      '--require', guard, join(repoRoot, 'scripts', 'real-acceptance.ts'), '--plan', '--skip-pdf', '--skip-asr',
    ], {
      cwd: repoRoot,
      env: { ...process.env, VOICE_API_KEY: undefined },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.deepEqual(JSON.parse(run.stdout), {
      steps: ['text'],
      unexecuted: [
        'PDF scan page smoke (--skip-pdf)',
        'ASR transcription (--skip-asr)',
      ],
    })
  } finally {
    removeHome(home)
  }
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
