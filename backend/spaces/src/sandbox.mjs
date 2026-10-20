/** The scoped sandbox provider row: every confined execution uses the session's bwrap profile. */
import { SandboxProvider, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { buildBwrapArgv, probeBwrap, BWRAP_DENIAL_SIGNATURES, BWRAP_RUNNER_FAILURE_RULES } from './bwrap.mjs'

/** Mounted by the `scoped-sandbox` row; the scope itself stays in the spaces row. */
export default class ScopedSandbox extends SandboxProvider {
  static inject = ['ourfairySpaces']
  async confine(argv, policy, signal) {
    signal?.throwIfAborted()
    const scope = this.ctx.ourfairySpaces
    const session = scope.session(policy.sessionId)
    scope.validatePolicy(policy, session)
    this.probe ??= probeBwrap('bwrap')
    if (!this.probe.ok) throw new SandboxUnavailableError(policy.mode, this.probe.detail)
    return { argv: buildBwrapArgv('bwrap', { workspaceRoot: scope.privateRoot(session), writable: true, network: true,
      writableRoots: scope.writeRoots(session), readRoots: scope.readonlyFiles(session), envRoot: scope.envRoot }, argv),
      enforcement: 'full', denialSignatures: BWRAP_DENIAL_SIGNATURES, runnerFailureRules: BWRAP_RUNNER_FAILURE_RULES }
  }
}
