import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const runner = new URL('../scripts/test.ts', import.meta.url).href

/** Only the compiler is a double; linking, locking and Node's runner are real. */
function fixture(t, { buildFails = false, testFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-test-runner-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const dsh = join(root, 'dsh')
  mkdirSync(join(dsh, 'packages'), { recursive: true })
  mkdirSync(join(dsh, 'vendor'))
  put('combo.json', JSON.stringify({
    repos: { dsh: { localPath: dsh, lock: 'commit' } },
    backend: { profileName: 'test', bundlePackage: '@test/bundle', probePackage: '@test/probe',
      bundlePathInRepo: 'backend/bundle', probePathInRepo: 'backend/probe', pnpmPin: 'test', nodeRange: '*' },
  }))
  put('backend/bundle/package.json', '{"name":"@test/bundle","files":["package.json"],"dependencies":{}}')
  put('backend/probe/package.json', '{"name":"@test/probe"}')
  put('dsh/node_modules/typescript/bin/tsc', `
    const fs = require('node:fs')
    fs.appendFileSync('events', 'build\\n')
    if (${buildFails}) process.exit(2)
    fs.mkdirSync('backend/probe/dist', { recursive: true })
    fs.writeFileSync('backend/probe/dist/value', 'compiled')
  `)
  put('tests/selected.test.mjs', `
    import assert from 'node:assert/strict'
    import { spawnSync } from 'node:child_process'
    import { readFileSync, appendFileSync } from 'node:fs'
    import { test } from 'node:test'
    test('reads the build while another writer is excluded', () => {
      assert.equal(readFileSync('backend/probe/dist/value', 'utf8'), 'compiled')
      assert.equal(spawnSync('flock', ['--nonblock', '.ourfairy-build.lock', 'true']).status, 1)
      appendFileSync('events', 'test\\n')
      assert.equal(${testFails}, false)
    })
  `)
  put('tests/unselected.test.mjs', `throw new Error('must not run an unselected file')`)
  return root
}

function run(t, root) {
  const env = { ...process.env, OURFAIRY_DSH_DIR: '' }
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { runTests } from ${JSON.stringify(runner)}
    process.exitCode = runTests(process.argv[1], ['tests/selected.test.mjs'])
  `, root], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
  })
  t.after(async () => { child.kill('SIGKILL'); await done })
  return done
}

test('two test invocations keep each build and its selected tests together', { timeout: 20_000 }, async t => {
  const root = fixture(t)
  for (const result of await Promise.all([run(t, root), run(t, root)])) assert.equal(result.code, 0, result.output)
  assert.equal(readFileSync(join(root, 'events'), 'utf8'), 'build\ntest\nbuild\ntest\n')
})

test('a failed build stops before tests and returns its exit code', { timeout: 10_000 }, async t => {
  const root = fixture(t, { buildFails: true })
  const result = await run(t, root)
  assert.equal(result.code, 2, result.output)
  assert.equal(readFileSync(join(root, 'events'), 'utf8'), 'build\n')
})

test('a failed test keeps a nonzero exit code', { timeout: 10_000 }, async t => {
  const root = fixture(t, { testFails: true })
  const result = await run(t, root)
  assert.equal(result.code, 1, result.output)
  assert.equal(readFileSync(join(root, 'events'), 'utf8'), 'build\ntest\n')
})
