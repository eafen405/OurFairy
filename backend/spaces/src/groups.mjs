/** Chat-owned group membership, sharing the existing business store and file scope. */
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

export function installGroups(ctx) {
  const scope = ctx.ourfairySpaces
  const { users, groups } = ctx.identity
  const userOf = agent => {
    const shortId = scope.owner(agent?.session)
    const user = users.byShortId(shortId)
    if (!user) throw new Error('groups/unknown-user: group operation requires an active session owner')
    return user
  }
  const rootFor = groupId => {
    const path = join(scope.root, 'groups', String(groupId))
    mkdirSync(path, { recursive: true })
    return realpathSync(path)
  }
  const expose = group => ({ ...group, root: rootFor(group.id) })
  ctx.effect(() => scope.contributeExtraRoots(session => {
    const shortId = scope.owner(session)
    if (!users.byShortId(shortId)) throw new Error('groups/unknown-user: file operation requires an active session owner')
    return groups.forMember(shortId).map(group => rootFor(group.id))
  }), 'ourfairy-spaces: group roots')
  const output = { schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
  const registrations = new Map()
  function register(agent) {
    const user = userOf(agent)
    const names = registrations.get(agent) ?? new Set()
    registrations.set(agent, names)
    const add = (name, definition) => {
      if (names.has(name)) return
      agent.ctx.tools.register(defineTool({ name, output, ...definition }))
      names.add(name)
    }
    add('groups', { description: 'List your current shared file groups, members and root directories. Groups are file spaces, not group chats.', parameters: {},
      execute: (_args, exec) => ({ groups: groups.forMember(userOf(exec.agent).shortId).map(expose) }) })
    if (user.shortId === 1 && user.isAdmin) add('group_create', {
      description: 'Create a shared file group and designate an existing owner by short number. Only the designated owner is joined automatically.',
      parameters: { name: { type: 'string', required: true }, ownerShortId: { type: 'integer', required: true } },
      execute: (args, exec) => {
        const group = groups.create(userOf(exec.agent).shortId, args)
        for (const live of ctx.agents.list()) register(live)
        return expose(group)
      },
    })
    if (groups.owns(user.shortId)) add('group_members', {
      description: 'Add (action 1) or remove (action 2) a user from a group you currently own. The designated owner must remain a member.',
      parameters: { groupId: { type: 'integer', required: true }, userShortId: { type: 'integer', required: true }, action: { type: 'integer', required: true, enum: [1, 2] } },
      execute: (args, exec) => expose(groups.changeMember(userOf(exec.agent).shortId, args)),
    })
  }
  ctx.on('agent/created', ({ agent }) => register(agent), { global: true })
  ctx.on('agent/disposed', ({ agent }) => { registrations.delete(agent) }, { global: true })
  for (const agent of ctx.agents.list()) register(agent)
}
