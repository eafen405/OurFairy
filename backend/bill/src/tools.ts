/**
 * The bill's one read-only tool.
 *
 * The reading at the end of her context is throttled and limited to the
 * previous interaction plus today, so it cannot answer "how much this month" or
 * "since the beginning". Those questions get a tool instead of a second,
 * differently-computed number: it uses the same bill service and presentation
 * units as the bill page. Each request observes its own aggregate snapshot.
 *
 * It writes nothing — no ownership gate is needed for that reason — but its
 * registration scope is the reading's: a maintenance or learning child gets no
 * bill tool, because the bill is not its account.
 *
 * @module @ourfairy/dsh-bill/tools
 */
import { defineTool, type InferValue } from '@deepseek-ai/dsh-tools'
import { dennyOfTokens, tokensOf } from './denny.js'
import { DENNY_DAY_BUCKET } from './reading.js'
import type { BillService, BillSnapshot } from './aggregate.js'
import type { TokenBuckets } from './fold.js'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** The tool's wire name. */
export const BILL_TOOL_NAME = 'electricity_bill'

/** The JSON envelope every product tool answers with. */
const OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  // One JSON text block, the same shape the memory and search rows use.
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** The snapshot's value, as the output schema declares it. */
type ToolValue = InferValue<typeof OUTPUT.schema>

/** One total as the tool reports it: Denny for the voice, tokens for the check. */
function total(tokens: TokenBuckets): { denny: number, tokens: TokenBuckets } {
  return { denny: dennyOfTokens(tokensOf(tokens)), tokens }
}

/**
 * The tool's value for one snapshot.
 *
 * Both units are given: Denny is what she talks in, and the raw buckets are what
 * makes the number verifiable against the bill page. The day granularity is
 * stated rather than silently applied, because the series is exact even though
 * the context reading is throttled.
 * @param snapshot - the aggregate's one observation.
 * @returns the tool value.
 */
export function billToolValue(snapshot: BillSnapshot): ToolValue {
  return {
    today: total(snapshot.today),
    month: total(snapshot.month),
    allTime: total(snapshot.allTime),
    days: snapshot.days.map(day => ({ day: day.day, denny: dennyOfTokens(tokensOf(day.tokens)), tokens: day.tokens })),
    // The reading's own throttle, stated so a mismatch with the context line is
    // explained by the tool rather than blamed on the aggregate.
    contextReadingGranularityDenny: DENNY_DAY_BUCKET,
  } as unknown as ToolValue
}

/**
 * Register the bill tool on one agent, once.
 *
 * Registration replays on a resumed session, and a name may be offered exactly
 * once to an Agent's scoped registry, so the caller's name set guards it.
 * @param agent - the agent whose scoped registry is written.
 * @param bill - the row's reading face.
 * @param registered - the names already registered on this agent.
 * @returns nothing; the tool is registered as a side effect.
 */
export function registerBillTool(agent: Agent, bill: BillService, registered: Set<string>): void {
  if (registered.has(BILL_TOOL_NAME)) return
  agent.ctx.tools.register(defineTool({
    name: BILL_TOOL_NAME,
    description: 'Read this Fairy\'s electricity bill: today, this month and all time, in Denny (1 Denny = 3000 tokens) and in raw token buckets, plus the last 30 local days oldest first with days of no spend present at zero. Use it when asked about monthly or historical spending; the reading at the end of the context covers only the previous interaction and today. It writes nothing. A failure to aggregate is reported as an error, never as zero.',
    parameters: {},
    output: OUTPUT,
    execute: async () => billToolValue(await bill.snapshot()),
  }))
  registered.add(BILL_TOOL_NAME)
}
