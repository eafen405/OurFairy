import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { readCombo, repoPath } from '../scripts/combo.mjs'
import { copyProductRepo, removeHome, repoRoot } from './helpers/backend.mjs'

test('test dependencies resolve from the overridden dsh checkout when the canonical path is absent', () => {
  const root = copyProductRepo('ourfairy-relocated-tests-')
  try {
    mkdirSync(join(root, 'tests'), { recursive: true })
    cpSync(join(repoRoot, 'tests/helpers'), join(root, 'tests/helpers'), { recursive: true })
    const manifest = join(root, 'combo.json')
    const combo = JSON.parse(readFileSync(manifest, 'utf8'))
    combo.repos.dsh.localPath = join(root, 'absent-canonical-dsh')
    writeFileSync(manifest, `${JSON.stringify(combo)}\n`)
    const dsh = repoPath(readCombo().combo, 'dsh')
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict'
      import { createRequire } from 'node:module'
      import { join } from 'node:path'
      import { pathToFileURL } from 'node:url'
      import { dshDir } from './tests/helpers/backend.mjs'
      assert.equal(dshDir, process.env.OURFAIRY_DSH_DIR)
      const { startMockLlmServer } = await import(pathToFileURL(join(dshDir, 'packages/test-support/llm-mock-server/lib/index.js')))
      assert.equal(typeof startMockLlmServer, 'function')
      const sharp = createRequire(join(dshDir, 'packages/attachment/attachment-local/package.json'))('sharp')
      assert.equal(typeof sharp, 'function')
      const requireSubprocess = createRequire(join(dshDir, 'packages/subprocess/subprocess-local/package.json'))
      assert.ok(requireSubprocess.resolve('@deepseek-ai/cordis'))
    `], {
      cwd: root,
      env: { ...process.env, OURFAIRY_DSH_DIR: dsh },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(run.status, 0, `relocated dependency imports failed:\n${run.stdout}\n${run.stderr}`)
  } finally {
    removeHome(root)
  }
})
