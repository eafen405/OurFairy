/**
 * The deployment's voice pass over dsh's own prompt sections (#302).
 *
 * dsh's tool packages each register a short English instruction in the same
 * system prompt the Fairy speaks through: `Check the [exit code: N] marker…`,
 * `Use the read tool — not shell commands like cat…`, and four more. Upstream
 * writes them as prohibitions in a second language, so the Fairy's voice ends
 * with a list of "do not"s in English, and two of them (`tool:bash`,
 * `tool:jobs`) are registered unconditionally — the maintenance child, whose
 * tools are restricted to nothing, still pays 474 characters of shell and job
 * discipline it cannot act on.
 *
 * The product cannot change what dsh registers, but the `system-prompt/assemble`
 * waterfall returns the authoritative assembly. This pass rewrites those
 * sections into the deployment's own voice: same facts, stated positively, in
 * Chinese, and only when the tool is actually visible to this agent. A section
 * whose tool is absent contributes nothing, which is the shape upstream already
 * uses for `tool:read`.
 *
 * @module @ourfairy/dsh-chat/src/prompt-voice
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/**
 * The dsh-registered sections this deployment restates in its own voice.
 *
 * Keyed by the section name dsh registers. A tool's own schema remains the
 * authority for how to call it; these lines only carry the cross-call habit
 * dsh wanted stated once, so each replacement keeps the habit and drops the
 * rest.
 */
const VOICE: Record<string, { readonly tools: readonly string[]; readonly text: string }> = {
  'tool:bash': {
    tools: ['bash'],
    text: '用 bash 时读每条的 exit code，失败先查明原因再继续。',
  },
  'tool:read': {
    tools: ['read'],
    text: '看文本文件用 read，不要用 cat 之类的 shell 命令；大文件用 offset 和 limit 续读。',
  },
  'tool:write': {
    tools: ['write'],
    text: '用 write 覆盖已有文件前先读一遍；小改动优先 edit。',
  },
  'tool:edit': {
    tools: ['edit'],
    text: '改文件前先读一遍；本会话里刚创建或刚改过的不必重读。',
  },
  'tool:jobs': {
    tools: ['job_output', 'job_list', 'job_kill'],
    text: '后台任务用 job_output 收结果；被通知完成前不要轮询，也不要重复启动同一个任务。',
  },
}

/** The visible tool names of one assembly, so a section can follow its tool. */
function visibleTools(assembly: PromptAssembly): Set<string> {
  return new Set(assembly.tools.map(tool => tool.name))
}

/**
 * Restate the deployment's tool-usage sections in its own voice.
 *
 * Runs before `next()` so downstream listeners (and the guard) see the
 * rewritten text. A section whose tool is not visible becomes empty, which
 * `renderPrompt` drops — the maintenance child therefore stops carrying shell
 * and job instructions it has no tools for.
 * @param assembly - the assembly to restate in place.
 * @returns the same assembly, with the rewritten sections.
 */
export function restateToolSections(assembly: PromptAssembly): PromptAssembly {
  const tools = visibleTools(assembly)
  for (const section of assembly.sections) {
    const voice = VOICE[section.name]
    if (voice === undefined) continue
    section.text = voice.tools.some(name => tools.has(name)) ? voice.text : ''
  }
  return assembly
}

/**
 * Install the voice pass for every assembly this deployment serves.
 *
 * Global rather than per-agent: the maintenance child and the skill-learning
 * child are different deployments built outside the chat runtime, so a
 * listener installed on one agent's context would leave them speaking the
 * upstream English. An untagged listener receives every scope's assemblies
 * (dsh routes a scoped event up the chain, never down), which is exactly the
 * reach this pass needs.
 * @param ctx - the plugin context whose assemblies are restated.
 */
export function installPromptVoice(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (assembly: PromptAssembly, _context, next) => {
    restateToolSections(assembly)
    return await next()
  }, { global: true })
}
