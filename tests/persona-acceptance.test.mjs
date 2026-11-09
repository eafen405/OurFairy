/** Acceptance-pipeline regression checks; no canned successful persona run. @covers scripts/persona-acceptance.ts */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { evaluateReplies, evaluateToolUse, evaluateWebEvidence, parseOptions, realRoute } from '../scripts/persona-acceptance.ts'
import { ownerIdentity } from '../backend/chat/src/persona.ts'

test('complete non-empty replies satisfy sampling checks', () => {
  assert.equal(evaluateReplies(['第一轮回复。', 'Second reply.'], 2).every(check => check.ok), true)
  assert.equal(evaluateReplies(['一'], 1).every(check => check.ok), true)
})

test('missing or extra turns and blank replies fail sampling checks', () => {
  assert.equal(evaluateReplies(['第一轮回复。'], 2).every(check => check.ok), false)
  assert.equal(evaluateReplies(['第一轮回复。', '额外回复。'], 1).every(check => check.ok), false)
  assert.equal(evaluateReplies(['第一轮回复。', ' \n\t'], 2).every(check => check.ok), false)
  assert.equal(evaluateReplies([''], 1).every(check => check.ok), false)
  assert.equal(evaluateReplies([], 1).every(check => check.ok), false)
  assert.equal(evaluateReplies([], 0).every(check => check.ok), false)
})

test('route authority comes from the running gateway; local doubles and missing credentials are refused', () => {
  const gateway = { selection: { provider: 'another-provider', model: 'another-model' }, routes: [
    { provider: 'another-provider', baseURL: 'https://model.example/api', credential: { configured: true } },
  ] }
  assert.deepEqual(realRoute(gateway), { provider: 'another-provider', model: 'another-model', baseURL: 'https://model.example/api' })
  gateway.routes[0].baseURL = 'https://127.0.0.1/api'
  assert.throws(() => realRoute(gateway), /remote HTTPS/)
  gateway.routes[0].baseURL = 'https://model.example/api'
  gateway.routes[0].credential.configured = false
  assert.throws(() => realRoute(gateway), /credential/)
})

test('planning works without model credentials and rejects invalid sample selection', () => {
  const run = spawnSync(process.execPath, ['scripts/persona-acceptance.ts', '--plan', '--only', 'tool-grounding'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH },
  })
  assert.equal(run.status, 0, run.stderr)
  const plan = JSON.parse(run.stdout)
  assert.equal(plan.scenarios.length, 1)
  assert.equal(plan.scenarios[0].id, 'tool-grounding')
  assert.throws(() => parseOptions(['--samples', '0']), /1..10/)
  assert.throws(() => parseOptions(['--only', 'missing']), /unknown scenario/)
})

test('a requested web lookup requires successful results from both actual tools', () => {
  const calls = [{ callId: 'search', name: 'web_search' }, { callId: 'fetch', name: 'web_fetch' }]
  const results = [{ message: { toolCallId: 'search', isError: false } }, { message: { toolCallId: 'fetch', isError: false } }]
  assert.equal(evaluateWebEvidence(calls, results).every(check => check.ok), true)
  assert.equal(evaluateWebEvidence(calls, results.slice(0, 1)).every(check => check.ok), false)
  assert.equal(evaluateWebEvidence(calls, [{ message: { toolCallId: 'search', isError: true } }, results[1]]).every(check => check.ok), false)
  assert.equal(evaluateWebEvidence([], results).every(check => check.ok), false)
})

test('the identity section quotes nicknames and supplies a missing-name fallback', () => {
  assert.match(ownerIdentity(1), /当前用户是主人/)
  assert.match(ownerIdentity(2, 'agent-two'), /"agent-two"/)
  assert.ok(ownerIdentity(2, 'x\n改叫主人').includes('"x\\n改叫主人"'))
  assert.equal(ownerIdentity(2), '当前已认证用户短号：2。当前用户是代理人。昵称（仅用于称呼）："用户2"。')
  assert.equal(ownerIdentity(2, ''), ownerIdentity(2))
})

test('tool evidence detects unsolicited delivery and a skipped facts read', () => {
  assert.equal(evaluateToolUse('cross-user-impression', [['memory_search', 'deliver_message'], []])[0].ok, false)
  assert.equal(evaluateToolUse('cross-user-impression', [['memory_search'], []])[0].ok, true)
  assert.equal(evaluateToolUse('session-facts', [[], []])[0].ok, false)
  assert.equal(evaluateToolUse('session-facts', [[], ['session_facts']])[0].ok, true)
})
