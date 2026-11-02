/**
 * Ticket #300: the pure material projection the learning children read.
 *
 * The projection is the seam the spec names ("material projection is a pure
 * function"): given an event log and a frozen interval it must produce bounded
 * text containing the user request, Fairy replies, attachment names, tool calls
 * with bounded arguments, bounded results and a file-change summary, and must
 * never contain the environment, attachment bodies or events outside the
 * interval. Expected strings come from the spec's material list.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

let module

/** Load the built projection module once. */
async function material() {
  module ??= await import('../backend/skill-creator/dist/material.js')
  return module
}

/** One event with the fields the projection reads. */
function event(seq, type, data, extra = {}) {
  return { seq, time: 1_000 + seq, type, data, ...extra }
}

/** An append-origin human message. */
function user(seq, text, attachments = []) {
  return event(seq, 'user/message', {
    id: `user-${seq}`,
    content: [{ type: 'text', text }],
    source: { kind: 'user', attachments: attachments.map(name => ({ name })) },
  }, { surfaceOp: 'append' })
}

/** An append-origin Fairy reply. */
function fairy(seq, text) {
  return event(seq, 'assistant/message', {
    turn: 1,
    step: 1,
    message: { id: `assistant-${seq}`, role: 'assistant', content: [{ type: 'text', text }] },
    stream: [],
  }, { surfaceOp: 'append' })
}

/** One tool call and, optionally, its recorded result. */
function calls(seq, callId, name, args, result, { failed = false } = {}) {
  const list = [event(seq, 'tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })]
  if (result !== undefined) {
    list.push(event(seq + 1, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: `result-${seq}`,
        role: 'user',
        toolCallId: callId,
        content: [{ type: 'text', text: result }],
        isError: failed,
      },
    }, { surfaceOp: 'append' }))
  }
  return list
}

test('the projection carries the workflow facts and excludes the next interval and the environment', async () => {
  const { assembleLearningMaterial } = await material()
  const events = [
    user(1, '帮我把发布清单流程整理一下'),
    fairy(2, '我先检查仓库状态。'),
    ...calls(3, 'call-bash', 'bash', { command: 'npm test' }, 'PASS 12 tests'),
    ...calls(5, 'call-write', 'write', { path: 'notes/release.md', content: 'CHANGELOG-BODY-SECRET' }, 'ok'),
    event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    user(8, 'NEXT-INTERVAL-SECRET'),
    event(9, 'turn/start', { turn: 2 }),
  ]
  const text = assembleLearningMaterial({ events, watermarkSeq: 0, cutSeq: 7, maxCharacters: 12_000 })
  assert.match(text, /\[用户\] 帮我把发布清单流程整理一下/u)
  assert.match(text, /\[Fairy\] 我先检查仓库状态。/u)
  assert.match(text, /\[工具\] bash \{"command":"npm test"\}/u)
  assert.match(text, /\[结果:bash\] PASS 12 tests/u)
  assert.match(text, /\[文件变更\].*notes\/release\.md/u)
  assert.match(text, /\[工具\] write .*notes\/release\.md/u)
  assert.equal(text.includes('NEXT-INTERVAL-SECRET'), false, 'the next interval never enters the frozen material')
  assert.equal(text.includes('CHANGELOG-BODY-SECRET'), false, 'a tool argument is bounded to its path, not its payload')
  assert.equal(text.includes('/home/'), false, 'the environment never enters the material')
  assert.equal(text.includes('system'), false)
})

test('the projection includes attachment names and failed tool output but not bodies', async () => {
  const { assembleLearningMaterial } = await material()
  const events = [
    user(1, '看一下附件然后修复', ['spec.pdf', 'screenshot.png']),
    ...calls(2, 'call-1', 'bash', { command: 'make' }, 'error: missing dependency', { failed: true }),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const text = assembleLearningMaterial({ events, watermarkSeq: -1, cutSeq: 4, maxCharacters: 12_000 })
  assert.match(text, /\[附件\] spec\.pdf/u)
  assert.match(text, /\[附件\] screenshot\.png/u)
  assert.match(text, /\[工具失败:bash\] error: missing dependency/u)
  assert.equal(text.includes('ATTACHMENT-BODY'), false)
})

test('the total is bounded by maxCharacters and the cut is explicit', async () => {
  const { assembleLearningMaterial } = await material()
  const events = []
  let seq = 0
  for (let index = 0; index < 40; index += 1) {
    events.push(user(++seq, `用户消息-${index}-${'长'.repeat(200)}`))
    events.push(fairy(++seq, `回复-${index}-${'文'.repeat(200)}`))
  }
  events.push(event(++seq, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
  const text = assembleLearningMaterial({ events, watermarkSeq: -1, cutSeq: seq, maxCharacters: 1_500 })
  assert.ok(text.length <= 1_500, `material must be bounded, got ${text.length}`)
  assert.match(text, /省略/u, 'a truncated material names the omission')
  assert.match(text, /^学习材料：/u, 'the header stays first')
})

test('only human turns close an interval; a review-entry message is not a user turn', async () => {
  const { closedUserTurns } = await material()
  const events = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'user/message', {
      id: 'review-entry', content: [{ type: 'text', text: '技能候选等待审核' }],
      source: { kind: 'skill-review', form: 'instructions', versionId: 3, manifestHash: 'h' },
    }, { surfaceOp: 'append' }),
    event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(4, 'turn/start', { turn: 2 }),
    user(5, '真实的用户回合'),
    event(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    event(7, 'turn/start', { turn: 3 }),
    user(8, '还没结束的回合'),
  ]
  const turns = closedUserTurns(events)
  assert.deepEqual(turns.map(turn => turn.seq), [6], 'only the closed human turn counts')
  assert.equal(turns[0].time, 1_006)
})
