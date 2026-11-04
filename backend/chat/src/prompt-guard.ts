/** Keep a user-facing Fairy's prompt from being replaced by one complete section. */
import { isUserSession } from '@ourfairy/dsh-identity/session'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * Internal presets may deliberately use a complete prompt. A user's main Fairy
 * may not: replacing her sections also removes the guidance for tools that
 * remain visible in the same request.
 */
export function installPromptGuard(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const complete = assembly.sections.find(section => section.complete === true)
    if (complete !== undefined && isUserSession(context.agent?.session.header)) {
      throw new Error(`chat/prompt-replaced: section "${complete.name}" replaces the user-facing Fairy prompt`)
    }
    return assembly
  }, { global: true })
}
