/**
 * The group capability as its own product row.
 *
 * Group membership and its tools belong to identity's business store, and the
 * extra roots are contributed through the spaces row's public contributor
 * seam — this row computes no scope of its own. Unloading it therefore removes
 * the group tools and group roots without touching the private/public spaces
 * or confined scripts, which the spaces row owns.
 */
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool, type InferArgs, type InferValue, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { IdentityService } from '@ourfairy/dsh-identity'
// The dsh context's own seams and the product's own context rows: the agent
// registry, the tool runtime, identity's business faces and the file scope.
// The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@ourfairy/dsh-identity'
import type {} from '@ourfairy/dsh-spaces'

export const name = 'ourfairy-groups'
export const inject = ['ourfairySpaces', 'identity', 'agents']

/** One group as identity's group face exposes it. */
type GroupRow = ReturnType<IdentityService['groups']['forMember']>[number]

/** One user as identity's user face exposes it. */
type UserRow = NonNullable<ReturnType<IdentityService['users']['byShortId']>>

/** One group as this row exposes it: identity's group plus its root directory. */
type ExposedGroup = GroupRow & { readonly root: string }

export function apply(ctx: Context) {
  const scope = ctx.ourfairySpaces
  const { users, groups } = ctx.identity
  const userOf = (agent: Agent | undefined): UserRow => {
    const shortId = scope.owner(agent?.session)
    const user = users.byShortId(shortId)
    if (!user) throw new Error('groups/unknown-user: group operation requires an active session owner')
    return user
  }
  const rootFor = (groupId: number): string => {
    const path = join(scope.root, 'groups', String(groupId))
    mkdirSync(path, { recursive: true })
    return realpathSync(path)
  }
  const expose = (group: GroupRow): ExposedGroup => ({ ...group, root: rootFor(group.id) })
  ctx.effect(() => scope.contributeExtraRoots(session => {
    const shortId = scope.owner(session)
    if (!users.byShortId(shortId)) throw new Error('groups/unknown-user: file operation requires an active session owner')
    return groups.forMember(shortId).map(group => rootFor(group.id))
  }), 'ourfairy-groups: group roots')
  const output = { schema: { type: 'object', additionalProperties: true } as const,
    render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value) }] }
  /** The canonical value one of this row's tools returns, as the output schema declares it. */
  type ToolValue = InferValue<typeof output.schema>
  const registrations = new Map<Agent, Set<string>>()
  function register(agent: Agent): undefined {
    const user = userOf(agent)
    const names = registrations.get(agent) ?? new Set<string>()
    registrations.set(agent, names)
    const add = <S extends ParameterSchemaSpec>(name: string, definition: {
      readonly description: string
      readonly parameters: S
      readonly execute: (args: InferArgs<S>, exec: ToolRunContext) => Promise<ToolValue>
    }) => {
      if (names.has(name)) return
      agent.ctx.tools.register(defineTool({ name, output, ...definition }))
      names.add(name)
    }
    add('groups', { description: 'List your current shared file groups, members and root directories. Groups are file spaces, not group chats.', parameters: {},
      // The native tool contract is asynchronous; the registry awaits what the
      // builder returns, so the value this tool resolves to is the same one the
      // synchronous body produced.
      execute: async (_args, exec) => ({ groups: groups.forMember(userOf(exec.agent).shortId).map(expose) }) })
    if (user.shortId === 1 && user.isAdmin) add('group_create', {
      description: 'Create a shared file group and designate an existing owner by short number. Only the designated owner is joined automatically.',
      parameters: { name: { type: 'string', required: true }, ownerShortId: { type: 'integer', required: true } },
      execute: async (args, exec) => {
        const group = groups.create(userOf(exec.agent).shortId, args)
        for (const live of ctx.agents.list()) register(live)
        return expose(group)
      },
    })
    if (groups.owns(user.shortId)) add('group_members', {
      description: 'Add (action 1) or remove (action 2) a user from a group you currently own. The designated owner must remain a member.',
      parameters: { groupId: { type: 'integer', required: true }, userShortId: { type: 'integer', required: true }, action: { type: 'integer', required: true, enum: [1, 2] } },
      execute: async (args, exec) => expose(groups.changeMember(userOf(exec.agent).shortId, args)),
    })
    return undefined
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  ctx.on('agent/disposed', ({ agent }) => { registrations.delete(agent) }, { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}
