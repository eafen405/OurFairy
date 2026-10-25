import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

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
