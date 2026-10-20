/** Product providers over native dsh file, directory and sandbox Interfaces. */
import z from '@deepseek-ai/schemastery'
import { SpaceScope } from './scope.mjs'

export const name = 'ourfairy-spaces'
export const inject = ['sessions', 'tools']

/** The loader validates the row config before `apply`; `SpaceScope` receives the checked value. */
export const Config = z.object({
  root: z.string().required(),
})

/**
 * The spaces row owns the scope and the contributor seam: the `ourfairySpaces`
 * service, the tool-call scope wrapper, the system prompt, and the
 * `contributeExtraRoots`/`contributeReadonlyFiles` registrations. The groups row
 * contributes its member roots through `contributeExtraRoots`; the attachments
 * row contributes its qualified files through `contributeReadonlyFiles`. The
 * four scoped providers are rows of their own (`scoped-fs`, `scoped-sandbox`,
 * `scoped-bash`, `scoped-directory`), so one can be disabled or replaced without
 * taking the scope away.
 */
export function apply(ctx, config) {
  const scope = new SpaceScope(ctx, config)
  ctx.on('tools/execute', (exec, next) => scope.calls.run(exec.agent?.session, () => next()), { global: true, prepend: true })
  ctx.inject(['systemPrompt'], context => {
    context.systemPrompt.context({ name: 'ourfairy:spaces', order: 0, text: ({ agent }) => {
      if (!agent) return ''
      return `Authorized file spaces: ${scope.writeRoots(agent.session).map(JSON.stringify).join(', ')}. Private space: ${scope.privateRoot(agent.session)}. Public files are shared. Use the shared env directory for dependencies; network access is available. File rights do not change with cwd or escalation.`
    } })
  })
}
