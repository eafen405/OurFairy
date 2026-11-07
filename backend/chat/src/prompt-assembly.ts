/** Product placement and tool guidance at dsh's native assembly seam (#302). */
import { isUserSession } from '@ourfairy/dsh-identity/session'
import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'

/** Materials and tool guidance precede the voice; the authenticated identity closes it. */
const PRODUCT_ORDER = ['ourfairy:skill-trust', 'ourfairy:impression', 'ourfairy:persona', 'ourfairy:identity']

/** Only cross-call rules belong here; argument contracts stay on each tool. */
const TOOL_GUIDANCE = new Map([
  ['tool:bash', { tools: ['bash'], text: '用 bash 时读每条的 exit code，失败先查明原因再继续。' }],
  ['tool:read', { tools: ['read'], text: '看文本文件用 read，大文件用 offset 和 limit 续读。' }],
  ['tool:write', { tools: ['write'], text: '用 write 覆盖已有文件前先读一遍；小改动优先 edit。' }],
  ['tool:edit', { tools: ['edit'], text: '改文件前先读一遍；本会话里刚创建或刚改过的不必重读。' }],
  ['tool:jobs', { tools: ['job_output', 'job_list', 'job_kill'], text: '记录后台任务 id，等完成通知后用 job_output 收结果；交付前收齐相关结果，取消已无关任务。收到通知前继续独立工作，避免轮询或重复启动。' }],
])

function refuseComplete(assembly: PromptAssembly): void {
  const complete = assembly.sections.find(section => section.complete === true)
  if (complete !== undefined) {
    throw new Error(`chat/prompt-replaced: complete section "${complete.name}" replaces the user-facing Fairy prompt`)
  }
}

/**
 * One deployment pass, over the returned assembly rather than a registry copy.
 * Plugins still contribute directly through systemPrompt.section(). Internal
 * presets retain dsh's complete semantics and their own ordering and wording.
 */
export function installPromptAssembly(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (initial, context, next) => {
    if (!isUserSession(context.agent?.session.header)) return next()
    // dsh restores the originally registered complete section AFTER the
    // waterfall. Checking only the returned value lets a listener hide it.
    refuseComplete(initial)
    const assembly = await next()
    refuseComplete(assembly)
    const tools = new Set(assembly.tools.map(tool => tool.name))
    const sections = assembly.sections.map(section => {
      const guidance = TOOL_GUIDANCE.get(section.name)
      return guidance === undefined ? section : { ...section,
        text: guidance.tools.some(tool => tools.has(tool)) ? guidance.text : '', interpolate: false }
    })
    return { ...assembly, sections: [
      ...sections.filter(section => !PRODUCT_ORDER.includes(section.name)),
      ...PRODUCT_ORDER.flatMap(name => sections.filter(section => section.name === name)),
    ] }
  }, { global: true })
}
