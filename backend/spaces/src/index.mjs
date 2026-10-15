/** Product providers over native dsh file, directory and sandbox Interfaces. */
import { installGroups } from './groups.mjs'
import { SpaceScope, pathInside } from './scope.mjs'
import { ScopedFileSystem } from './fs.mjs'
import { SandboxProvider, SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { buildBwrapArgv, probeBwrap, BWRAP_DENIAL_SIGNATURES, BWRAP_RUNNER_FAILURE_RULES } from './bwrap.mjs'

export const name = 'ourfairy-spaces'
export const inject = ['sessions', 'tools']
class ScopedSandbox extends SandboxProvider {
  static inject = ['ourfairySpaces']
  async confine(argv, policy, signal) {
    signal?.throwIfAborted()
    const scope = this.ctx.ourfairySpaces
    const session = scope.session(policy.sessionId)
    scope.validatePolicy(policy, session)
    this.probe ??= probeBwrap('bwrap')
    if (!this.probe.ok) throw new SandboxUnavailableError(policy.mode, this.probe.detail)
    return { argv: buildBwrapArgv('bwrap', { workspaceRoot: scope.privateRoot(session), writable: true,
      writableRoots: scope.writeRoots(session), readRoots: scope.readonlyFiles(session), envRoot: scope.envRoot }, argv),
      enforcement: 'full', denialSignatures: BWRAP_DENIAL_SIGNATURES, runnerFailureRules: BWRAP_RUNNER_FAILURE_RULES }
  }
}
class ScopedBash extends SandboxBashExecutor {
  static inject = [...SandboxBashExecutor.inject, 'ourfairySpaces']
  async execute(spec) {
    const scope = this.ctx.ourfairySpaces
    const session = scope.session(spec.sandboxPolicy?.sessionId)
    scope.validatePolicy(spec.sandboxPolicy, session)
    if (!scope.writeRoots(session).some(root => pathInside(root, spec.workdir))) throw new Error('working directory outside authorized spaces')
    // The native executor spawns with the host cwd; the bwrap command always starts
    // in the caller's requested, already authorized directory inside the namespace.
    const command = `cd -- ${shellQuote(spec.workdir)} && ${spec.command}`
    return scope.run(session, () => super.execute({ ...spec, command }))
  }
}
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
class ScopedDirectory extends WorkingDirectoryService {
  static inject = [...WorkingDirectoryService.inject, 'ourfairySpaces']
  get(session) {
    return this.ctx.sessionProjections.stateOf(session, 'workingDirectory') ?? this.ctx.ourfairySpaces.privateRoot(session)
  }
  ensure(agent, signal) {
    const scope = this.ctx.ourfairySpaces
    return scope.run(agent.session, async () => {
      const current = this.get(agent.session)
      // A former group cwd can outlive membership; restore an authorized base
      // before building the next prompt, rather than stranding that session.
      if (!scope.writeRoots(agent.session).some(root => pathInside(root, current))) {
        return super.set(agent, scope.privateRoot(agent.session), signal)
      }
      const target = await this.ctx.fs.resolve(current, { signal })
      const info = await this.ctx.fs.stat(target, signal)
      // Native fallback is header.cwd/deployment cwd; old chat headers have no
      // private cwd. Recovery must use the same owner-derived private root.
      return info?.type === 'directory'
        ? super.ensure(agent, signal)
        : super.set(agent, scope.privateRoot(agent.session), signal)
    })
  }
  set(agent, path, signal) { return this.ctx.ourfairySpaces.run(agent.session, () => super.set(agent, path, signal)) }
}
export function apply(ctx, config) {
  const scope = new SpaceScope(ctx, config)
  ctx.inject(['identity', 'agents'], context => installGroups(context))
  ctx.on('tools/execute', (exec, next) => scope.calls.run(exec.agent?.session, () => next()), { global: true, prepend: true })
  ctx.plugin(ScopedFileSystem, { cwd: config.root, diffBasisMaxBytes: 10 * 1024 * 1024 })
  ctx.plugin(ScopedSandbox)
  ctx.plugin(ScopedBash, {})
  ctx.plugin(ScopedDirectory, {})
  ctx.inject(['systemPrompt'], context => {
    context.systemPrompt.context({ name: 'ourfairy:spaces', order: 0, text: ({ agent }) => {
      if (!agent) return ''
      return `Authorized file spaces: ${scope.writeRoots(agent.session).map(JSON.stringify).join(', ')}. Private space: ${scope.privateRoot(agent.session)}. Public files are shared. Use the shared env directory for dependencies; network access is available. File rights do not change with cwd or escalation.`
    } })
  })
}
