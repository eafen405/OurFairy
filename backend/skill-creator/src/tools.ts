/**
 * The one model-facing skill tool: `skill_manage` (#297).
 *
 * It is a deep interface over the creation module: one action-style call
 * answers the bounded pending/pool view, creates a candidate from the caller's
 * own session, returns the review package with a deterministic display, and
 * records the reviewer's decision. The caller never names an owner, reviewer,
 * landing path, manifest hash or verification result; those are derived from
 * the session header, the package bytes and the recorded run.
 *
 * Registered on user sessions only, the same rule the other product rows use:
 * a maintenance or learning child gets no product tool surface. Registration
 * can replay on one Agent, so each name is offered once.
 *
 * @module @ourfairy/dsh-skill-creator/src/tools
 */
import { defineTool, type InferArgs, type InferValue, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { isUserSession } from '@ourfairy/dsh-identity/session'
import { readSessionEvents } from '@ourfairy/dsh-sessions/events'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCreation, CandidateComparison, CandidateEvidence, CandidateFile, CandidateScenario, ReviewDecision, SkillFocusInput } from './creation.js'
import type { SkillService } from './service.js'
// Type-only: the owned-session service and the narrow chat-runtime seam the
// create/review paths read; they add no runtime dependency of their own.
import type {} from '@ourfairy/dsh-sessions'
import type {} from '@ourfairy/dsh-chat'

/** The tool's name; the native skill loader is `skill` and must not be shadowed. */
export const SKILL_MANAGE_NAME = 'skill_manage'

/**
 * The contract-complete description the model reads.
 *
 * The memory boundary sentence is shared with the Skill Creator body and the
 * memory maintenance policy: a reusable workflow becomes a skill, a stable
 * fact or preference becomes a memory, and the same content is never written
 * to both. `list`/`inspect` are the only way to read candidates; approval is
 * always the user's decision.
 */
export const SKILL_MANAGE_DESCRIPTION = 'Manage reusable Fairy skills. Use it when the user asks to save a reusable workflow as a skill, or to review a skill candidate. '
  + 'A reusable procedure (ordered steps, inputs, outputs, tools, checks) belongs in a skill; a stable fact or preference about the user belongs in memory. Never write the same content to both. '
  + 'Actions: `list` returns the caller\'s bounded pending candidates and the reviewed selection pool with backend-derived states; '
  + '`create` validates a complete package drafted by you and turns it into a pending candidate — the backend derives the owner from the calling session, accepts only scope 1 (personal) for now, and runs the representative scenarios for real, so never claim a verification result you did not receive; '
  + '`inspect` returns one pending candidate\'s read-only review package and a deterministic display (the four blocks: identity/hash and core-character change, applicability and target benefit, package and verification evidence, how to expand the full text), and produces the `skill-review` display row the user reads; use `expand: "skill"` or `expand: "files"` with `path` for the full text instead of asking for everything at once; '
  + '`review` records `approve`, `request_changes` or `reject` for a pending candidate after the user decides. Never claim approval yourself and never approve on the user\'s behalf. The model cannot submit an owner, a reviewer, a current-version pointer, a landing path, a manifest hash or a verification result. '
  + 'A name that already has an approved current version is refused: that needs a revision, which this tool does not offer yet.'

/** How every call renders: one JSON object, so the chat projection can parse the review row. */
export const TOOL_OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }],
}

/** The canonical value the tool returns, as the output schema declares it. */
export type SkillToolValue = InferValue<typeof TOOL_OUTPUT.schema>

/** The literal parameter schema, as the dsh tool contract consumes it. */
export const SKILL_MANAGE_PARAMETERS = {
  action: { type: 'string', required: true, enum: ['list', 'inspect', 'create', 'review'] },
  versionId: { type: 'integer' },
  skillId: { type: 'integer' },
  scope: { type: 'integer', enum: [1, 2] },
  focus: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true, enum: ['turn', 'task'] },
      turn: { type: 'integer' },
      text: { type: 'string' },
    },
  },
  files: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', required: true },
        content: { type: 'string' },
        executable: { type: 'boolean' },
      },
    },
  },
  scenarios: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', required: true },
        command: { type: 'string', required: true },
        description: { type: 'string' },
        uses: { type: 'array', items: { type: 'string' } },
        timeoutMs: { type: 'integer' },
      },
    },
  },
  comparisons: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', required: true },
        withSkill: { type: 'string', required: true },
        withoutSkill: { type: 'string', required: true },
      },
    },
  },
  parentVersionId: { type: 'integer' },
  targetBenefit: { type: 'string' },
  evidence: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, enum: ['session', 'test', 'observation'] },
        ref: { type: 'string', required: true },
        note: { type: 'string' },
      },
    },
  },
  address: { type: 'string' },
  license: { type: 'string' },
  decision: { type: 'string', enum: ['approve', 'request_changes', 'reject'] },
  note: { type: 'string' },
  growthConfirmMessageId: { type: 'string' },
  expand: { type: 'string', enum: ['none', 'skill', 'files'] },
  path: { type: 'string' },
} as const satisfies ParameterSchemaSpec

/** The runtime-validated arguments, narrowed for the handler. */
type SkillManageArgs = InferArgs<typeof SKILL_MANAGE_PARAMETERS> & {
  readonly focus?: SkillFocusInput
  readonly files?: readonly CandidateFile[]
  readonly scenarios?: readonly CandidateScenario[]
  readonly comparisons?: readonly CandidateComparison[]
  readonly evidence?: readonly CandidateEvidence[]
  readonly decision?: ReviewDecision
}

/** The services one call reads. */
export interface SkillToolDeps {
  readonly ctx: Context
  readonly creation: SkillCreation
  readonly service: SkillService
  /** Invalidate one owner's live catalogs after a publish. */
  readonly invalidateOwner: (shortId: number) => void
  /** Invalidate every live catalog after a deployment-wide publish (sharing ticket). */
  readonly invalidateAll: () => void
}

/** Whether a decision became a publish. */
function decisionIsPublish(decision: ReviewDecision | undefined): boolean {
  return decision === 'approve'
}

/** One positive integer argument, or undefined. */
function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`skills/invalid-request: ${field} must be a positive integer`)
  }
  return value
}

/** A required positive integer argument. */
function requiredPositiveInteger(value: unknown, field: string): number {
  const checked = positiveInteger(value, field)
  if (checked === undefined) throw new Error(`skills/invalid-request: ${field} is required`)
  return checked
}

/** Translate one domain refusal into the tool layer's prefixed error text. */
function toolFailure(error: unknown): Error {
  if (error !== null && typeof error === 'object' && 'code' in error && 'message' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string' && code.startsWith('skills/')) return new Error(`${code}: ${String((error as { message: unknown }).message)}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

/** Run one action against the caller's own session and the backend's derived facts. */
async function execute(args: SkillManageArgs, exec: ToolRunContext, deps: SkillToolDeps): Promise<SkillToolValue> {
  // The native tool contract types the agent as optional; a tool registered on
  // an agent scope only executes inside one.
  const agent = exec.agent as Agent
  const owner = shortIdOf(agent.session.header.owner)
  if (owner === undefined) throw new Error('skills/unauthorized: skill_manage needs a user-owned session')
  try {
    switch (args.action) {
      case 'list':
        return { ok: true, pending: deps.creation.pending(owner), pool: deps.service.pool(owner) } as unknown as SkillToolValue
      case 'inspect': {
        const versionId = requiredPositiveInteger(args.versionId, 'versionId')
        return deps.creation.inspect(owner, versionId, {
          ...(args.expand === undefined ? {} : { expand: args.expand }),
          ...(args.path === undefined ? {} : { path: args.path }),
        }) as unknown as SkillToolValue
      }
      case 'create': {
        const parentVersionId = positiveInteger(args.parentVersionId, 'parentVersionId')
        // A revision derives its scope from the parent identity; a new skill
        // must still state the personal scope explicitly.
        if (parentVersionId === undefined && args.scope === undefined) {
          throw new Error('skills/invalid-request: create needs scope 1 (personal)')
        }
        if (args.focus === undefined) throw new Error('skills/invalid-request: create needs focus')
        if (args.files === undefined) throw new Error('skills/invalid-request: create needs the complete package files')
        if (args.scenarios === undefined) throw new Error('skills/invalid-request: create needs at least one scenario')
        if (args.address !== undefined) throw new Error('skills/install-unsupported: installing from an address arrives with the sharing ticket')
        const { events } = await readSessionEvents(deps.ctx, agent.session.id)
        const result = await deps.creation.create({
          ownerShortId: owner,
          sessionId: agent.session.id,
          events,
          scope: args.scope ?? 1,
          focus: args.focus,
          files: args.files,
          scenarios: args.scenarios,
          ...(args.comparisons === undefined ? {} : { comparisons: args.comparisons }),
          ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
          ...(args.license === undefined ? {} : { license: args.license }),
          ...(parentVersionId === undefined ? {} : { parentVersionId }),
          ...(args.targetBenefit === undefined ? {} : { targetBenefit: args.targetBenefit }),
          signal: exec.signal,
        })
        return result as unknown as SkillToolValue
      }
      case 'review': {
        const versionId = requiredPositiveInteger(args.versionId, 'versionId')
        if (args.decision === undefined) throw new Error('skills/invalid-request: review needs decision approve, request_changes or reject')
        const result = deps.creation.review({
          shortId: owner,
          versionId,
          decision: args.decision,
          ...(args.note === undefined ? {} : { note: args.note }),
        })
        if (decisionIsPublish(args.decision)) {
          // The published current version changes this owner's catalog; the
          // next model step must observe it without a restart.
          if (result.scope === 1) deps.invalidateOwner(owner)
          else deps.invalidateAll()
        }
        return result as unknown as SkillToolValue
      }
      default:
        throw new Error(`skills/invalid-request: unknown action ${String(args.action)}`)
    }
  } catch (error) {
    throw toolFailure(error)
  }
}

/**
 * Register `skill_manage` on one user session's scoped tool registry, once.
 *
 * @param agent - the agent whose scoped registry is written.
 * @param deps - the creation module, the pool service and the row context.
 * @param registered - the names already offered to this agent.
 */
export function registerSkillTools(agent: Agent, deps: SkillToolDeps, registered: Set<string>): void {
  if (!isUserSession(agent.session.header)) return
  if (registered.has(SKILL_MANAGE_NAME)) return
  agent.ctx.tools.register(defineTool({
    name: SKILL_MANAGE_NAME,
    description: SKILL_MANAGE_DESCRIPTION,
    parameters: SKILL_MANAGE_PARAMETERS,
    output: TOOL_OUTPUT,
    presentCall: args => ({ card: 'generic', title: `Skill ${String(args.action ?? '')}`, kind: 'read' }),
    execute: (args, exec) => execute(args as SkillManageArgs, exec, deps),
  }))
  registered.add(SKILL_MANAGE_NAME)
}
