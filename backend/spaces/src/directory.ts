/**
 * The scoped working-directory provider row: the cwd is always inside the
 * session's roots.
 *
 * @module @ourfairy/dsh-spaces/src/directory
 */
import { MAINTENANCE_PRESET } from '@ourfairy/dsh-memory/preset'
import { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
// The dsh context's own seam: the session projections the cwd is read from.
import type {} from '@deepseek-ai/dsh-session-projection'
import { pathInside } from './scope.js'

/** Mounted by the `scoped-directory` row; the scope itself stays in the spaces row. */
export default class ScopedDirectory extends WorkingDirectoryService {
  static override inject = [...WorkingDirectoryService.inject, 'ourfairySpaces']

  override get(session: Session): string {
    // A maintenance child has no owner and no file tools. The working-directory
    // row still asks this provider for prompt context, so answer from the shared
    // root instead of deriving an owner-bound private directory that cannot exist.
    if (session.header?.agentPreset === MAINTENANCE_PRESET) return this.ctx.ourfairySpaces.root
    return this.ctx.sessionProjections.stateOf(session, 'workingDirectory') ?? this.ctx.ourfairySpaces.privateRoot(session)
  }

  override async ensure(agent: Agent, signal?: AbortSignal): Promise<string> {
    if (agent.session.header?.agentPreset === MAINTENANCE_PRESET) return this.get(agent.session)
    const scope = this.ctx.ourfairySpaces
    return scope.run(agent.session, async () => {
      const current = this.get(agent.session)
      // A former group cwd can outlive membership: restore an authorized base
      // before building the next prompt.
      if (!scope.writeRoots(agent.session).some(root => pathInside(root, current))) {
        return super.set(agent, scope.privateRoot(agent.session), signal)
      }
      const target = await this.ctx.fs.resolve(current, { ...(signal !== undefined ? { signal } : {}) })
      const info = await this.ctx.fs.stat(target, signal)
      // Recovery uses the same owner-derived private root: old chat headers carry
      // no private cwd, and the native fallback is the deployment cwd.
      return info?.type === 'directory'
        ? super.ensure(agent, signal)
        : super.set(agent, scope.privateRoot(agent.session), signal)
    })
  }

  override set(agent: Agent, path: string, signal?: AbortSignal): Promise<string> {
    return this.ctx.ourfairySpaces.run(agent.session, () => super.set(agent, path, signal))
  }
}
