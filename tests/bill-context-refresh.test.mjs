/**
 * #317: refresh a resident session at turn admission, including local midnight.
 * Exercise the public context installer through dsh's hook and prompt APIs,
 * using the real bill service with its injectable clock and session source.
 */
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'
import { closedTurn, event, usage } from './fixtures/bill-logs.mjs'

const { Context } = await import('@deepseek-ai/cordis')
const { agentEvents, assembleContextFor } = await import('@deepseek-ai/dsh-agent')
const { default: SystemPrompt, renderContextSections } = await import('@deepseek-ai/dsh-system-prompt')
const { createBillService } = await import('../backend/bill/dist/aggregate.js')
const { installBillContext, BILL_CONTEXT_NAME } = await import('../backend/bill/dist/context.js')

test('a resident session refreshes after Shanghai midnight and holds the reading through later steps', async () => {
  // February starts at 16:00 UTC: changing the process's own time zone is not
  // needed because createBillService uses the product's Asia/Shanghai boundary.
  const midnight = Date.UTC(2026, 0, 31, 16)
  let now = midnight - 1000
  const events = closedTurn(0, {
    time: midnight - 60_000,
    samples: [usage({ inputTokens: 30_000_000, outputTokens: 0 })],
  })
  const peerEvents = []
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '' })
  const session = { id: 'bill-midnight', header: { owner: 'user:1' } }
  const agent = { ctx, session }
  let boundary = { openTurnStartSeq: null, lastTurn: 1 }
  ctx.agents = { list: () => [agent] }
  ctx.sessionProjections = { stateOf: () => boundary }
  ctx.sessionQuery = { readSession: async () => ({ events: [...events] }) }
  const bill = createBillService({
    list: async () => [{ id: session.id, live: true }, { id: 'peer', live: true }],
    stat: async () => undefined,
    read: async id => [...(id === session.id ? events : peerEvents)],
  }, () => now)
  installBillContext(ctx, bill)

  const signal = new AbortController().signal
  const assemblyContext = assembleContextFor(agent, signal)
  const dispatch = agentEvents(ctx, agent)
  function open(turn) {
    boundary = { openTurnStartSeq: events.length, lastTurn: turn }
    events.push(event(events.length, 'turn/start', { turn }, now))
  }
  function reading(assembly) {
    const refreshed = ctx.systemPrompt.refreshContext(assembly, assemblyContext)
    return renderContextSections(refreshed).find(section => section.name === BILL_CONTEXT_NAME)?.text
  }
  async function preStep(turn, step) {
    // Match the loop: assembly precedes pre-step; admission re-resolves the
    // synchronous provider after the asynchronous hook has completed.
    const assembly = await ctx.systemPrompt.assemble(assemblyContext)
    await dispatch.waterfall('agent/pre-step', { messages: [], turn, step, signal },
      async () => ({ kind: 'enter', messages: [] }))
    return { assembly, text: reading(assembly) }
  }

  try {
    open(2)
    assert.equal((await preStep(2, 1)).text,
      '电费读数：上一次互动 10000 丁尼；本日累计约 1 万丁尼。')
    const finished = closedTurn(boundary.openTurnStartSeq, {
      turn: 2, time: now, samples: [usage({ inputTokens: 3000, outputTokens: 0 })],
    }).slice(1)
    for (const entry of finished) {
      events.push(entry)
      if (entry.type === 'turn/end') boundary = { openTurnStartSeq: null, lastTurn: 2 }
      ctx.emit('session/event', session, entry)
    }
    // Lifecycle listeners finish while the session is still idle before midnight.
    await setImmediate()

    now = midnight
    open(3)
    const admitted = await preStep(3, 1)
    const expected = '电费读数：上一次互动 1 丁尼；本日累计 尚无消耗。'
    assert.equal(admitted.text, expected,
      'the new day has no settled spend, even though the resident session had a nonzero reading yesterday')

    peerEvents.push(...closedTurn(0, {
      time: midnight + 1000,
      samples: [usage({ inputTokens: 60_000_000, outputTokens: 0 })],
    }))
    now = midnight + 2000
    assert.equal((await bill.snapshot()).today.inputTokens, 60_000_000,
      'another session has changed the live daily total during this turn')
    assert.equal(reading(admitted.assembly), expected,
      'synchronous context re-resolution still returns the admitted reading')
    assert.equal((await preStep(3, 2)).text, expected,
      'a later step keeps the reading even after another session settles spend')

    const end = event(events.length, 'turn/end', { turn: 3, reason: { kind: 'completed' } }, now)
    events.push(end)
    boundary = { openTurnStartSeq: null, lastTurn: 3 }
    ctx.emit('session/event', session, end)
    await setImmediate()
    open(4)
    const beforeMidnight = (await preStep(4, 1)).text
    assert.equal(beforeMidnight, '电费读数：上一次互动 1 丁尼；本日累计约 2 万丁尼。',
      'the following turn includes the peer spend that the previous turn kept out of its pin')
    now = midnight + 86_400_000
    assert.equal((await preStep(4, 2)).text, beforeMidnight,
      'crossing another local midnight does not change an already admitted turn')
  } finally {
    await ctx.fiber.dispose()
  }
})
