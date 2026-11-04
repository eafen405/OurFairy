/**
 * Product providers over native dsh file, directory and sandbox Interfaces.
 *
 * @module @ourfairy/dsh-spaces
 */
import z from '@deepseek-ai/schemastery'
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import type { Context } from '@deepseek-ai/cordis'
import { SpaceScope } from './scope.js'
// The dsh context's own seams: the session store, the tool registry and the
// system prompt. The imports are type-only, so they add no runtime dependency.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'

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
export function apply(ctx: Context, config: { readonly root: string }): void {
  const scope = new SpaceScope(ctx, config)
  ctx.on('tools/execute', (exec, next) => scope.calls.run(exec.agent?.session, () => next()), { global: true, prepend: true })
  ctx.inject(['systemPrompt'], context => {
    context.systemPrompt.context({ name: 'ourfairy:spaces', order: 0, text: ({ agent }) => {
      if (!agent) return ''
      // Only a session with an owner gets deployment file-space context; the
      // memory maintenance child gets only its own narrow material and
      // instruction, and an ownerless context cannot name a private space.
      if (shortIdOf(agent.session.header?.owner) === undefined) return ''
      return `授权文件空间：${scope.writeRoots(agent.session).map(root => JSON.stringify(root)).join('、')}。私有空间：${scope.privateRoot(agent.session)}。公共文件为共享。依赖装在共享 env 目录，网络可用；换目录或提权都不改变文件权限。`
    } })
  })
}

export { SpaceScope, pathInside } from './scope.js'
export type { OwnedSession, ScopeContributor } from './scope.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The product's file scope, as this package provides it. */
    ourfairySpaces: SpaceScope
  }
}
