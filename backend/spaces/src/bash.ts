/**
 * The scoped shell provider row: commands run only from roots the session is
 * authorized to write.
 *
 * @module @ourfairy/dsh-spaces/src/bash
 */
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { ShellExecSpec, ShellExecution } from '@deepseek-ai/dsh-shell'
import { pathInside } from './scope.js'

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

/** Mounted by the `scoped-bash` row; the scope itself stays in the spaces row. */
export default class ScopedBash extends SandboxBashExecutor {
  static override inject = [...SandboxBashExecutor.inject, 'ourfairySpaces']

  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
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
