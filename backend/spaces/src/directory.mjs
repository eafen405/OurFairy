/** The scoped working-directory provider row: the cwd is always inside the session's roots. */
import { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { pathInside } from './scope.mjs'

/** Mounted by the `scoped-directory` row; the scope itself stays in the spaces row. */
export default class ScopedDirectory extends WorkingDirectoryService {
  static inject = [...WorkingDirectoryService.inject, 'ourfairySpaces']
  get(session) {
    return this.ctx.sessionProjections.stateOf(session, 'workingDirectory') ?? this.ctx.ourfairySpaces.privateRoot(session)
  }
  ensure(agent, signal) {
    const scope = this.ctx.ourfairySpaces
    return scope.run(agent.session, async () => {
      const current = this.get(agent.session)
      // A former group cwd can outlive membership: restore an authorized base
      // before building the next prompt.
      if (!scope.writeRoots(agent.session).some(root => pathInside(root, current))) {
        return super.set(agent, scope.privateRoot(agent.session), signal)
      }
      const target = await this.ctx.fs.resolve(current, { signal })
      const info = await this.ctx.fs.stat(target, signal)
      // Recovery uses the same owner-derived private root: old chat headers carry
      // no private cwd, and the native fallback is the deployment cwd.
      return info?.type === 'directory'
        ? super.ensure(agent, signal)
        : super.set(agent, scope.privateRoot(agent.session), signal)
    })
  }
  set(agent, path, signal) { return this.ctx.ourfairySpaces.run(agent.session, () => super.set(agent, path, signal)) }
}
