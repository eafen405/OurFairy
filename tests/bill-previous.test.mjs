/**
 * Ticket #320: which completed interaction the context reading reports.
 *
 * "The previous interaction" is the last turn that closed before the open one.
 * The turn is located from the log's own open turn boundary and priced with the
 * bill's existing fold, so this case pins the three answers it can give — a
 * settled total, "there is none yet", and "a turn closed but its usage is not
 * provable" — plus the one that would silently be wrong: reporting the open
 * turn's own partial total.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'
import { closedTurn, event, hangingTurn, silentTurn, usage } from './fixtures/bill-logs.mjs'

const { foldDailyTokens } = await import('../backend/bill/dist/fold.js')
const { previousInteraction } = await import('../backend/bill/dist/previous.js')

function noModelTurn(startSeq, turn) {
  return [
    event(startSeq, 'turn/start', { turn }),
    event(startSeq + 1, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}
/** The seq a log's first open turn starts at, given the turns that precede it. */
function openAt(startSeq, turn) {
  return event(startSeq, 'turn/start', { turn })
}

test('the reading reports the last turn that closed, not the one that is running', () => {
  const first = closedTurn(0, { turn: 1, samples: [usage({ inputTokens: 300_000 })] })
  const second = closedTurn(first.length, { turn: 2, samples: [usage({ inputTokens: 600_000 })] })
  const open = openAt(first.length + second.length, 3)
  const log = [...first, ...second, open]

  const previous = previousInteraction(log, open.seq)
  assert.equal(previous.kind, 'settled')
  assert.deepEqual(previous.tokens, { inputTokens: 600_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 },
    'the previous interaction is turn 2\'s settlement; the open turn 3 has not settled anything')
})

test('a silent turn is stepped over for the last total that can be proven', () => {
  const first = closedTurn(0, { turn: 1, samples: [usage({ inputTokens: 3_000 })] })
  const silent = noModelTurn(first.length, 2)
  const open = openAt(first.length + silent.length, 3)

  const previous = previousInteraction([...first, ...silent, open], open.seq)
  assert.equal(previous.kind, 'settled')
  assert.equal(previous.tokens.inputTokens, 3_000,
    'a silent turn is stepped over: turn 1 is still the last interaction that has a provable total')
})

test('a session whose only completed turn reported nothing is unavailable, not zero', () => {
  const silent = silentTurn(0, { turn: 1 })
  const open = openAt(silent.length, 2)

  const previous = previousInteraction([...silent, open], open.seq)
  assert.equal(previous.kind, 'unavailable',
    'there was a completed interaction but its usage cannot be priced; reporting 0 would invent a measurement')
})

test('the latest model call without usage is unavailable, not an older turn\'s spend', () => {
  const first = closedTurn(0, { turn: 1, samples: [usage({ inputTokens: 3_000 })] })
  // This turn contains a real assistant call, but the provider reported no usage.
  const unreported = silentTurn(first.length, { turn: 2 })
  const open = openAt(first.length + unreported.length, 3)

  const previous = previousInteraction([...first, ...unreported, open], open.seq)
  assert.deepEqual(previous, { kind: 'unavailable' },
    'an older measured turn must not stand in for the latest interaction whose usage is unknown')
})

test('a first turn has no previous interaction at all', () => {
  const open = openAt(0, 1)
  assert.deepEqual(previousInteraction([open], open.seq), { kind: 'none' },
    'no turn has closed, which is a different fact from "the provider reported nothing"')
})

test('an unfinished turn is never the previous interaction', () => {
  const closed = closedTurn(0, { turn: 1, samples: [usage({ inputTokens: 30_000 })] })
  // The process died inside turn 2: it has usage but no `turn/end`, so nothing
  // proves its total. It is the open turn here, which is exactly the shape a
  // resumed session re-enters.
  const hanging = hangingTurn(closed.length, { turn: 2, sample: usage({ inputTokens: 900_000 }) })

  assert.deepEqual(previousInteraction([...closed, ...hanging], hanging[0].seq),
    { kind: 'settled', tokens: { inputTokens: 30_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 } },
    'the closed turn is reported; the unfinished one is not, however much it spent')
  assert.equal(foldDailyTokens([...closed, ...hanging]).length, 1,
    'the same log folds to the one closed day, which is the bill\'s own conservative reading')
})
