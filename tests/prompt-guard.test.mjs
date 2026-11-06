/**
 * The user-facing prompt guard crosses dsh's real assembly seam. Internal
 * presets retain the native complete-section behaviour.
 *
 * @covers backend/chat
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'

const { Context } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt, renderPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { installPromptAssembly } = await import('../backend/chat/dist/prompt-assembly.js')

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '' })
  installPromptAssembly(ctx)
  return ctx
}

const userAgent = { session: { header: { owner: 'user:2' } } }
const childAgent = { session: { header: { parentSession: 'source', agentPreset: 'ourfairy:skill-learning' } } }

test('an ordinary Fairy assembly keeps all of its sections', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'ourfairy:persona', order: 0, text: 'Fairy' })
    ctx.systemPrompt.section({ name: 'plugin:guidance', order: 1000, text: 'Check exit codes.' })
    const assembly = await ctx.systemPrompt.assemble({ agent: userAgent })
    assert.equal(renderPrompt(assembly), 'Check exit codes.\n\nFairy')
  } finally {
    await ctx.fiber.dispose()
  }
})

test('a complete section cannot silently replace a user-facing Fairy prompt', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'ourfairy:persona', order: 0, text: 'Fairy' })
    ctx.systemPrompt.section({ name: 'rogue:complete', order: 1, text: 'replacement', complete: true })
    await assert.rejects(ctx.systemPrompt.assemble({ agent: userAgent }), /chat\/prompt-replaced.*rogue:complete/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('an internal child may deliberately use its own complete prompt', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'tool:jobs', order: 1600, text: 'irrelevant' })
    ctx.systemPrompt.section({ name: 'ourfairy:skill-learning', order: 0, text: 'Detect signals.', complete: true })
    const assembly = await ctx.systemPrompt.assemble({ agent: childAgent })
    assert.equal(renderPrompt(assembly), 'Detect signals.')
  } finally {
    await ctx.fiber.dispose()
  }
})


test('a downstream listener cannot hide the registered complete override from the guard', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'rogue:complete', order: 0, text: 'replacement', complete: true })
    ctx.on('system-prompt/assemble', async (_initial, _context, next) => {
      const assembly = await next()
      return { ...assembly, sections: [] }
    })
    await assert.rejects(ctx.systemPrompt.assemble({ agent: userAgent }), /chat\/prompt-replaced.*rogue:complete/)
  } finally { await ctx.fiber.dispose() }
})

test('the returned plugin material keeps its text and relative order before the final product voice', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'ourfairy:identity', order: -500, text: 'identity' })
    ctx.systemPrompt.section({ name: 'ourfairy:persona', order: 9000, text: 'persona' })
    ctx.systemPrompt.section({ name: 'plugin:first', order: -900, text: 'first' })
    ctx.on('system-prompt/assemble', async (_initial, _context, next) => {
      const assembly = await next()
      return { ...assembly, sections: [...assembly.sections, { name: 'plugin:late', text: 'late' }] }
    })
    const assembly = await ctx.systemPrompt.assemble({ agent: userAgent })
    assert.equal(renderPrompt(assembly), 'first\n\nlate\n\npersona\n\nidentity')
  } finally { await ctx.fiber.dispose() }
})

test('guidance follows final tool visibility and ownerless agents keep native prompts', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'tool:bash', order: 1000, text: 'native bash guidance' })
    const hidden = await ctx.systemPrompt.assemble({ agent: userAgent })
    assert.equal(renderPrompt(hidden), '')
    const child = await ctx.systemPrompt.assemble({ agent: childAgent })
    assert.equal(renderPrompt(child), 'native bash guidance')
  } finally { await ctx.fiber.dispose() }
})
