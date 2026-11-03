/**
 * Test-only fixture: record the exact section inventory of every system-prompt
 * assembly, so a test can assert what the deployment prompt is made of.
 *
 * The assembled prompt reaches the model as one joined string, which loses the
 * section names, their order and their sizes. This fixture listens on the
 * native `system-prompt/assemble` waterfall and writes the inventory the
 * waterfall sees, before `renderPrompt` flattens it (#302).
 *
 * It is a passive observer: it returns the value it was given and never edits
 * the assembly, so a mounted copy cannot change what the product sends.
 *
 * @module @ourfairy/dsh-chat/test-support/prompt-inventory
 */
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

export const name = 'ourfairy-prompt-inventory'
export const inject = ['systemPrompt']

/** Where the fixture writes what it observed. */
export interface PromptInventoryConfig {
  /** Absolute path of the JSON file the inventory is written to. */
  readonly outPath: string
}

/** One section as the waterfall saw it, with the size the model pays for. */
interface SectionRecord {
  /** The section's registered name. */
  readonly name: string
  /** Characters of resolved text. */
  readonly characters: number
}

/** The inventory one assembly produced. */
export interface PromptInventory {
  /** Sections in render order, as the waterfall accepted them. */
  readonly sections: SectionRecord[]
  /** Characters after the native join, i.e. what the model actually reads. */
  readonly joinedCharacters: number
  /** Declared tool names, so a test can pair the prompt with the tool surface. */
  readonly tools: string[]
}

/**
 * Record each assembly to the configured path.
 * @param ctx - the row's context; `systemPrompt` is injected.
 * @param config - where to write the inventory.
 */
export function apply(ctx: Context, config: PromptInventoryConfig): void {
  ctx.on('system-prompt/assemble', async (_assembly: PromptAssembly, _context, next) => {
    const transformed = await next()
    const record: PromptInventory = {
      sections: transformed.sections.map(section => ({ name: section.name, characters: [...section.text].length })),
      // `renderPrompt` joins with a blank line and drops empty sections; the
      // fixture mirrors that so its total can be compared with the wire text.
      joinedCharacters: [...transformed.sections
        .filter(section => section.text !== '')
        .map(section => section.text)
        .join('\n\n')].length,
      tools: transformed.tools.map(tool => tool.name),
    }
    writeFileSync(config.outPath, `${JSON.stringify(record, undefined, 2)}\n`)
    return transformed
  })
}
