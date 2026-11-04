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
const { installPromptGuard } = await import('../backend/chat/dist/prompt-guard.js')

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '' })
  installPromptGuard(ctx)
  return ctx
}

const userAgent = { session: { header: { owner: 'user:2' } } }
const childAgent = { session: { header: { parentSession: 'source', agentPreset: 'ourfairy:skill-learning' } } }

test('an ordinary Fairy assembly keeps all of its sections', async () => {
  const ctx = await harness()
  try {
    ctx.systemPrompt.section({ name: 'ourfairy:persona', order: 0, text: 'Fairy' })
    ctx.systemPrompt.section({ name: 'tool:bash', order: 1000, text: 'Check exit codes.' })
    const assembly = await ctx.systemPrompt.assemble({ agent: userAgent })
    assert.equal(renderPrompt(assembly), 'Fairy\n\nCheck exit codes.')
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
