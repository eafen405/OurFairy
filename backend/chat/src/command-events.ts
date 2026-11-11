/** Product payloads carried by native log-only command events. */
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands/types'

export const COMMAND_NAME = 'ourfairy-session-command'
export const commandInputSchema = z.object({ requestId: z.string().min(1).max(128), command: z.union([z.literal(1), z.literal(2)]) })
export const commandErrorSchema = z.object({ code: z.union([z.literal(1), z.literal(2)]), message: z.string() })
export const commandResultSchema = z.object({ status: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), error: commandErrorSchema.optional() })
export type CommandInput = z.infer<typeof commandInputSchema>
export type CommandResult = z.infer<typeof commandResultSchema>

function decode<T>(schema: z.ZodType<T>, text: string | undefined): T | undefined {
  if (text === undefined) return undefined
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch { return undefined }
}

/** Native command producers outside this product are left alone. */
export function commandInput(event: SessionEvent): CommandInput | undefined {
  return event.type === 'command/run' && event.data.name === COMMAND_NAME ? decode(commandInputSchema, event.data.args) : undefined
}

export function commandResult(event: SessionEvent): CommandResult | undefined {
  return event.type === 'command/done' ? decode(commandResultSchema, event.data.text) : undefined
}

export function commandText(command: number, status: number, error?: { message: string }): string {
  if (status === 2) return '上下文已压缩'
  if (status === 3) return '当前无需压缩'
  if (status === 4) return '上下文已重置'
  if (status === 5) return error?.message ?? '会话命令失败'
  return command === 1 ? '正在压缩上下文…' : '正在重置上下文…'
}
