/**
 * Shared helpers for the OurFairy baseline tests.
 *
 * Every test drives the real product entry (`scripts/ourfairy-backend.mjs`),
 * which in turn boots the shipped dsh CLI profile machinery — no plugin is
 * assembled by hand here.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import http from 'node:http'

/** Absolute path of this ticket worktree (the repository under test). */
export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Path of the product launcher every test drives. */
export const backendScript = join(repoRoot, 'scripts', 'ourfairy-backend.mjs')

/**
 * A durable session-log artifact. The JSONL writer compresses by default, so
 * the file on disk is `session.v4.jsonl.zstd`; an uncompressed `.jsonl` appears
 * when compression is off. Both are durable logs, and matching only `.jsonl`
 * would let a "the log was persisted" assertion pass while seeing nothing.
 */
export const DURABLE_LOG = /\.jsonl(\.zstd)?$/

/**
 * Layer env entries over the process environment. An explicit `undefined`
 * removes a name, which is how a test proves keyless behavior.
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string|undefined>}
 */
export function mergedEnv(env) {
  const merged = { ...process.env }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete merged[name]
    else merged[name] = value
  }
  return merged
}

/**
 * The port a test's composition binds: an ephemeral one, asked for explicitly.
 *
 * The v1 composition mounts the product's web carrier, so it binds a port. Left
 * unset it would take the product default (3080) — which is also the port
 * `dsh web` serves the harness UI on, so on any machine running the harness
 * every booting test would fail with EADDRINUSE instead of testing anything.
 * A test must prove the port is *released* on stop, not which number it was.
 */
export const EPHEMERAL_PORT = '0'

/**
 * Environment for one launcher command: the caller's entries layered over the
 * process environment, with an ephemeral port unless the caller chose one.
 * @param {Record<string, string|undefined>} [env]
 * @returns {Record<string, string|undefined>}
 */
export function launchEnv(env = {}) {
  const merged = mergedEnv(env)
  if (merged.OURFAIRY_PORT === undefined) merged.OURFAIRY_PORT = EPHEMERAL_PORT
  return merged
}

/** Create a unique isolated OURFAIRY_HOME under the OS temp directory. */
export function makeHome(prefix = 'ourfairy-home-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Remove an isolated home created by {@link makeHome}. */
export function removeHome(path) {
  rmSync(path, { recursive: true, force: true })
}

/**
 * Run one launcher command.
 * @param {string[]} args - launcher arguments (`probe`, `start`, `stop`, ...).
 * @param {Record<string, string|undefined>} env - environment entries layered
 *   over the test process environment; an explicit `undefined` removes a name
 *   (used to prove keyless startup).
 * @param {{timeoutMs?: number, cwd?: string}} [options]
 * @returns {{code: number, stdout: string, stderr: string, error?: Error}}
 */
export function runBackend(args, env = {}, options = {}) {
  const result = spawnSync(process.execPath, [backendScript, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: launchEnv(env),
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    code: result.status === null ? -1 : result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

/** Read the probe report written by `probe --report <path>`. */
export function readReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * The launcher arguments for one test `start`.
 *
 * Two pieces of launcher knowledge live here so no test re-derives them: an
 * explicit `OURFAIRY_DSH_DIR` override (a ticket worktree of the harness) is a
 * deliberate experiment, so the launcher is told `--allow-drift`; and each
 * extra overlay is passed as `--patch <path>`, the composition's supported way
 * to mount a test-only row above the product profile.
 * @param {string[]} [overlays] - overlay paths to mount, in order, as written
 *   by {@link writeOverlay}.
 * @returns {string[]}
 */
export function startArgs(overlays = []) {
  const args = ['start', '--json']
  if (process.env.OURFAIRY_DSH_DIR !== undefined && process.env.OURFAIRY_DSH_DIR !== '') args.push('--allow-drift')
  for (const overlay of overlays) args.push('--patch', overlay)
  return args
}

/**
 * The port a `start --json` run bound, refusing a run that failed or reported
 * none. Port discovery lives here so no suite parses `listeningPorts` itself.
 * @param {{code: number, stdout: string, stderr: string}} run - a `start --json` result.
 * @returns {number}
 */
export function startedPort(run) {
  assert.equal(run.code, 0, describeRun('start', run))
  const summary = JSON.parse(run.stdout)
  assert.ok(
    Array.isArray(summary.listeningPorts) && summary.listeningPorts.length > 0,
    `started backend reported no listening port: ${run.stdout}`,
  )
  return summary.listeningPorts[0]
}

/**
 * Write one test-only overlay under `home` and return its path.
 *
 * The overlay is handed to the launcher through `--patch`, so a test never
 * writes the profile's own `cordis.patch.yml` — a path that belongs to the
 * launcher's isolated layout, not to the test suite.
 * @param {string} home - isolated home created by {@link makeHome}.
 * @param {Array<object>} rows - patch rows to mount, e.g. `[{ insert: [...] }]`.
 * @param {string} [name] - file name, unique per test within the same home.
 * @returns {string} the overlay path to pass in {@link startArgs}.
 */
export function writeOverlay(home, rows, name = 'overlay.patch.yml') {
  const path = join(home, name)
  writeFileSync(path, `${JSON.stringify(rows, undefined, 2)}\n`)
  return path
}

/**
 * Run one launcher command without blocking the event loop.
 *
 * `runBackend` uses `spawnSync`, which parks the whole process: anything the
 * test itself serves on loopback (an in-process model double) could never
 * answer the child, and the child would hang until its timeout. Tests that
 * stand up their own loopback server must use this variant instead.
 * @param {string[]} args - launcher arguments (`probe`, `start`, `stop`, ...).
 * @param {Record<string, string|undefined>} env - environment entries layered
 *   over the test process environment; an explicit `undefined` removes a name.
 * @param {{timeoutMs?: number, cwd?: string}} [options]
 * @returns {Promise<{code: number, stdout: string, stderr: string, error?: Error}>}
 */
export function runBackendAsync(args, env = {}, options = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [backendScript, ...args], {
      cwd: options.cwd ?? repoRoot,
      env: launchEnv(env),
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs ?? 300_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr, error })
    })
    child.on('close', code => {
      clearTimeout(timer)
      const error = timedOut
        ? new Error(`timed out after ${options.timeoutMs ?? 300_000}ms`)
        : undefined
      resolve({ code: code === null ? -1 : code, stdout, stderr, ...(error === undefined ? {} : { error }) })
    })
  })
}

/** Format a failed command for an assertion message without hiding raw output. */
export function describeRun(label, run) {
  return `${label} exited ${run.code}${run.error === undefined ? '' : ` (${run.error.message})`}\n`
    + `--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`
}

/**
 * One JSON request against a running backend, over `node:http`.
 *
 * Global `fetch` can be routed through an ambient proxy (`NODE_USE_ENV_PROXY`),
 * so this helper is the shared way for a test request: it always speaks to the
 * listener the test started. The attachments, PDF, and speech suites keep their
 * own clients because they need binary request bodies, raw response headers, or
 * an abort signal; those are the exceptions, not a second convention. The
 * expected status is asserted and the parsed body returned; pass `expect: false`
 * to inspect the raw response when a test asserts a refusal status itself.
 * @param {number} port - the port `start --json` reported.
 * @param {string} path - request path on that backend.
 * @param {{method?: string, token?: string, body?: unknown, expect?: number|false}} [options]
 * @returns {Promise<any>} the parsed body, or the raw response for `expect: false`.
 */
export function httpJson(port, path, { method = 'POST', token, body, expect = 200 } = {}) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const headers = { host: `127.0.0.1:${port}` }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  if (payload !== undefined) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(payload.byteLength)
  }
  return new Promise((resolve, reject) => {
    // A fresh socket per request: no pooled connection outlives the backend a
    // test stops between requests.
    const call = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try { json = JSON.parse(text) } catch { json = undefined }
        const received = { status: response.statusCode, headers: response.headers, text, json }
        if (expect === false) return resolve(received)
        try {
          assert.equal(received.status, expect, `${method} ${path}: ${text}`)
        } catch (error) {
          return reject(error)
        }
        return resolve(json)
      })
    })
    call.on('error', reject)
    if (payload !== undefined) call.write(payload)
    call.end()
  })
}

/**
 * Invite and register one member through the running backend's identity routes.
 * @param {number} port - the port `start --json` reported.
 * @param {string} adminToken - an administrator's session credential.
 * @param {string} name - the member's name.
 * @param {string} [password] - the member's password.
 * @returns {Promise<{token: string, user: {shortId: number}}>} the registered identity.
 */
export async function registerUser(port, adminToken, name, password = `${name}-password`) {
  const invite = await httpJson(port, '/identity/invite', { token: adminToken })
  return httpJson(port, '/identity/register', { body: { inviteCode: invite.invite.code, name, password } })
}
