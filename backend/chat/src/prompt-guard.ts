/**
 * The deployment prompt's guard: refuse a turn whose prompt is not the Fairy's.
 *
 * `renderPrompt` flattens the sections into one string, so nothing in the
 * product decided what the assembled prompt must contain. Any package
 * registering one `complete: true` section replaced the whole deployment prompt
 * while the tool schemas stayed declared — 2 494 characters became 45, the
 * persona and every tool-usage note vanished, and 27 tools were still offered.
 * The model then had tools with no usage notes and mis-called them instead of
 * erroring (#302).
 *
 * dsh keeps `complete` as a cooperative switch no product can veto, and it
 * applies that switch *after* the assemble waterfall returns. A listener that
 * inspects the waterfall's own result therefore cannot see the loss. What the
 * pre-waterfall assembly does show is the switch's carrier: a section whose
 * name no deployment package owns. The deployment prompt is a closed set
 * (`ourfairy:` product rows, `deployment:`/`tool:` dsh rows), so any other name
 * is what a takeover arrives as.
 *
 * When one appears, assembly throws, no model request is sent, and the turn's
 * projection carries the reason — a loud failure instead of the Fairy silently
 * answering as someone else.
 *
 * @module @ourfairy/dsh-chat/src/prompt-guard
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/** The deployment persona section; without it the Fairy is not deployed. */
export const PERSONA_SECTION = 'ourfairy:persona'

/** Name prefixes this deployment owns. Nothing else may appear in its prompt. */
export const DEPLOYMENT_PREFIXES = ['ourfairy:', 'tool:', 'deployment:'] as const

/** The refusal raised when another plugin has taken the deployment prompt over. */
export class PromptHijackedError extends Error {
  constructor(foreign: readonly string[]) {
    super(`${foreign.map(name => JSON.stringify(name)).join(', ')} contributed an unowned prompt section. `
      + `The deployment prompt accepts only ${DEPLOYMENT_PREFIXES.join(', ')} sections: a foreign section `
      + 'that also carries `complete` replaces the persona and every tool-usage note while leaving all tool '
      + 'schemas declared, and dsh applies that switch after the assemble waterfall, so it cannot be undone '
      + 'here. Remove the foreign section before the deployment can speak again.')
    this.name = 'PromptHijackedError'
  }
}

/**
 * Guard one agent's assemblies, after that agent's own sections are registered.
 *
 * Installed on the Agent's own context rather than globally, so an ownerless
 * maintenance or learning child — a different deployment that legitimately has
 * no Fairy persona — is never subject to this rule.
 *
 * Tool rows can legitimately be absent (a deployment that disables the shell
 * provider still serves chat), so absence is not a failure signal here; only an
 * unknown name is.
 * @param agentCtx - the agent context whose assemblies are guarded.
 */
export function installPromptGuard(agentCtx: Context): void {
  agentCtx.on('system-prompt/assemble', async (assembly: PromptAssembly, _context, next) => {
    const foreign = assembly.sections
      .map(section => section.name)
      .filter(name => !DEPLOYMENT_PREFIXES.some(prefix => name.startsWith(prefix)))
    if (foreign.length > 0) throw new PromptHijackedError(foreign)
    return await next()
  })
}
