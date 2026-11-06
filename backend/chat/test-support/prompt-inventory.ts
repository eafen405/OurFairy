/** Test/acceptance observer of the final native assembly, never a prompt builder. */
import { writeFileSync, appendFileSync } from 'node:fs'
import { renderPrompt, renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'ourfairy-prompt-inventory'
export const inject = ['systemPrompt', 'ourfairyChat']

/** Package attribution for the shipped composition; unknown plugins stay unknown.
 * This is a diagnostic catalog, not provenance attested by the native registry.
 */
const SOURCES: Record<string, string> = {
  'ourfairy:persona': '@ourfairy/dsh-chat',
  'ourfairy:identity': '@ourfairy/dsh-chat',
  'ourfairy:work-rules': '@ourfairy/dsh-chat',
  'tool:web_search': '@deepseek-ai/dsh-tool-web',
  'tool:web_fetch': '@deepseek-ai/dsh-tool-web',
  'ourfairy:impression': '@ourfairy/dsh-memory',
  'ourfairy:skill-trust': '@ourfairy/dsh-skill-creator',
  'ourfairy:spaces': '@ourfairy/dsh-spaces',
  'deployment:persona-prefix': '@deepseek-ai/dsh-system-prompt',
  'deployment:persona-suffix': '@deepseek-ai/dsh-system-prompt',
  'tool:bash': '@deepseek-ai/dsh-tool-bash',
  'tool:read': '@deepseek-ai/dsh-tool-fs',
  'tool:write': '@deepseek-ai/dsh-tool-fs',
  'tool:edit': '@deepseek-ai/dsh-tool-fs',
  'tool:jobs': '@deepseek-ai/dsh-tool-jobs',
}

export function apply(ctx: Context, config: { outPath: string; append?: boolean }): void {
  // Mounted after chat, prepended so post-next observes the deployment pass.
  ctx.on('system-prompt/assemble', async (_initial, context, next) => {
    const assembly = await next()
    const record = {
      sessionId: context.agent?.session.id,
      attribution: 'shipped-package-catalog; unknown entries are null',
      sections: assembly.sections.map((section, order) => ({
        name: section.name, order, sourcePackage: SOURCES[section.name] ?? null,
        // Native render preserves interpolation, empty sections and variables.
        text: renderPrompt({ ...assembly, sections: [section] }),
        characters: [...renderPrompt({ ...assembly, sections: [section] })].length,
      })),
      contexts: renderContextSections(assembly).map((section, order) => ({ ...section,
        order, sourcePackage: SOURCES[section.name] ?? null, characters: [...section.text].length })),
      joinedCharacters: [...renderPrompt(assembly)].length,
      tools: assembly.tools.map(tool => tool.name),
      toolDescriptionCharacters: assembly.tools.reduce((sum, tool) => sum + [...(tool.description ?? '')].length, 0),
    }
    const json = JSON.stringify(record)
    if (config.append) appendFileSync(config.outPath, `${json}\n`)
    else writeFileSync(config.outPath, `${json}\n`)
    return assembly
  }, { global: true, prepend: true })
}
