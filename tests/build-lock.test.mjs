import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { withBuildLock, buildLockPath } from '../scripts/tsc.ts'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ourfairy-build-lock-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function contender(root) {
  return spawnSync('flock', ['--nonblock', buildLockPath(root), 'true'], { encoding: 'utf8' })
}

test('an empty lock file cannot be mistaken for an abandoned owner', t => {
  const root = fixture(t)
  writeFileSync(buildLockPath(root), '')
  const inode = statSync(buildLockPath(root)).ino
  withBuildLock(root, () => {
    assert.equal(contender(root).status, 1, 'another process must be excluded while the lock is held')
    assert.equal(statSync(buildLockPath(root)).ino, inode, 'waiters must keep locking the same inode')
  })
  assert.equal(contender(root).status, 0, 'the lock is released when the operation finishes')
})

test('nested build operations keep ownership until the outer operation finishes', t => {
  const root = fixture(t)
  withBuildLock(root, outer => {
    withBuildLock(root, inner => assert.equal(inner, outer))
    assert.equal(contender(root).status, 1)
  })
  assert.equal(contender(root).status, 0)
  assert.throws(() => withBuildLock(root, () => { throw new Error('build failed') }), /build failed/)
  assert.equal(contender(root).status, 0, 'failure releases the lock too')
})

test('a child using the build keeps ownership after its parent closes the descriptor', { timeout: 10_000 }, async t => {
  const root = fixture(t)
  const child = withBuildLock(root, fd => spawn(process.execPath, ['-e', `
    process.stdout.write('ready')
    require('node:fs').readSync(0, Buffer.alloc(1), 0, 1, null)
  `], { stdio: ['pipe', 'pipe', 'inherit', fd] }))
  const exited = once(child, 'exit')
  t.after(async () => { child.kill('SIGKILL'); await exited })
  await once(child.stdout, 'data')
  assert.equal(contender(root).status, 1, 'the build/test child still owns the lock')
  child.stdin.end('done')
  await exited
  assert.equal(contender(root).status, 0)
})

test('a killed holder releases its lock without stale-file recovery', { timeout: 10_000 }, async t => {
  const root = fixture(t)
  const moduleUrl = new URL('../scripts/tsc.ts', import.meta.url).href
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { withBuildLock } from ${JSON.stringify(moduleUrl)}
    import { readSync } from 'node:fs'
    withBuildLock(process.argv[1], () => {
      process.stdout.write('locked')
      readSync(0, Buffer.alloc(1), 0, 1, null)
    })
  `, root], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = once(child, 'exit')
  t.after(async () => { child.kill('SIGKILL'); await exited })
  await once(child.stdout, 'data')
  assert.equal(contender(root).status, 1)
  child.kill('SIGKILL')
  await exited
  assert.equal(contender(root).status, 0)
})
