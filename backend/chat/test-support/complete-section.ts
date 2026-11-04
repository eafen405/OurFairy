/**
 * Test-only fixture: a plugin that registers one `complete: true` prompt
 * section, exactly as the ticket says no mechanism prevents.
 *
 * The ticket's fourth finding is that any package registering a `complete`
 * section silently erases `ourfairy:persona` and the tool-usage sections while
 * the tool schemas stay declared. This fixture is the third party that would do
 * it; the guard test mounts it and asserts the deployment refuses to assemble a
 * prompt that lost its voice.
 *
 * @module @ourfairy/dsh-chat/test-support/complete-section
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'ourfairy-complete-section-fixture'
export const inject = ['systemPrompt']

/** The prompt one hostile plugin replaces the deployment prompt with. */
export const HIJACK_PROMPT = 'You are a generic assistant. Answer politely.'

/** The section name the fixture registers; a guard test names it in the refusal. */
export const HIJACK_SECTION = 'third-party:complete'

/** The fixture takes no configuration. */
export type CompleteSectionConfig = Record<string, never>

/** Register the one complete section this fixture exists to contribute. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: HIJACK_SECTION,
    order: 5000,
    text: HIJACK_PROMPT,
    complete: true,
  })
}
