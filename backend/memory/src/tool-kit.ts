/**
 * The plumbing the memory row's two tool surfaces share.
 *
 * The memory tools and the impression tools answer the same native contract:
 * one JSON output envelope, one name-guarded registration on an Agent's scoped
 * tool registry, and one refusal shape whose status, code and detail both the
 * model and the HTTP envelope need. The two surfaces keep their own read gates
 * — a memory change is authorized by the numbers the calling *session* has
 * searched, an impression edit by the *credential or session* that read it —
 * so those gates are different identity keys and are not merged here.
 *
 * @module @ourfairy/dsh-memory/src/tool-kit
 */
import { defineTool, type InferArgs, type InferValue, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** How every memory-row tool renders its value to the model. */
export const TOOL_OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
}

/** The canonical value a memory-row tool returns, as the output schema declares it. */
export type ToolValue = InferValue<typeof TOOL_OUTPUT.schema>

/** One tool a row contributes to an Agent's scoped registry. */
export type ToolDefinition<S extends ParameterSchemaSpec> = {
  readonly description: string
  readonly parameters: S
  readonly execute: (args: InferArgs<S>, exec: ToolRunContext) => Promise<ToolValue>
}

/**
 * The name-guarded registrar both tool surfaces use.
 *
 * Registration can replay on the same Agent (a resumed session runs the same
 * registration flow, and a scope's own registration cannot be hidden by dsh's
 * tool restriction), so each name may be offered exactly once.
 * @param agent - the agent whose scoped tool registry is written.
 * @param registered - the names already registered on this agent.
 * @returns the guarded `add(name, definition)` both surfaces call.
 */
export function toolRegistrar(agent: Agent, registered: Set<string>) {
  return <S extends ParameterSchemaSpec>(name: string, definition: ToolDefinition<S>): void => {
    if (registered.has(name)) return
    agent.ctx.tools.register(defineTool({ name, output: TOOL_OUTPUT, ...definition }))
    registered.add(name)
  }
}

/**
 * One refusal a memory-row surface reports.
 *
 * The fields are the shared authority: a tool message starts with the code so
 * the model reads it in one text block, while an impression HTTP route answers
 * the code as its own field and keeps the detail alone. A subclass chooses only
 * the message form, never a different code or status.
 */
export class ToolError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string

  constructor(status: number, code: string, detail: string, name: string, prefixed: boolean) {
    super(prefixed ? `${code}: ${detail}` : detail)
    this.name = name
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** A memory tool's refusal: its message begins with the product code. */
export class MemoryError extends ToolError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message, 'MemoryError', true)
  }
}

/** An impression route's refusal: its message is the detail alone. */
export class ImpressionError extends ToolError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message, 'ImpressionError', false)
  }
}
