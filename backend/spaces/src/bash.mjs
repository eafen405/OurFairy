/** The scoped shell provider row: commands run only from roots the session is authorized to write. */
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { pathInside } from './scope.mjs'

const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"

/** Mounted by the `scoped-bash` row; the scope itself stays in the spaces row. */
export default class ScopedBash extends SandboxBashExecutor {
  static inject = [...SandboxBashExecutor.inject, 'ourfairySpaces']
  async execute(spec) {
    const scope = this.ctx.ourfairySpaces
    const session = scope.session(spec.sandboxPolicy?.sessionId)
    scope.validatePolicy(spec.sandboxPolicy, session)
    if (!scope.writeRoots(session).some(root => pathInside(root, spec.workdir))) throw new Error('working directory outside authorized spaces')
    // The native executor spawns with the host cwd; bwrap starts in the caller's
    // requested, already authorized directory inside the namespace.
    const command = `cd -- ${shellQuote(spec.workdir)} && ${spec.command}`
    return scope.run(session, () => super.execute({ ...spec, command }))
  }
}
