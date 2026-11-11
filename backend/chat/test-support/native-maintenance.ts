/** Hold a real native maintenance lease until the authenticated product stop. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'ourfairy-native-maintenance-fixture'
export const inject = ['agents']
export interface NativeMaintenanceConfig { readonly sessionId: string }
export function apply(ctx: Context, config: NativeMaintenanceConfig): void {
  ctx.on('agent/created', ({ agent }) => {
    if (agent.id !== config.sessionId) return
    const timer = setTimeout(() => {
      void agent.runMaintenance(signal => new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })).catch(error => { ctx.logger.warn(String(error)) })
    }, 20)
    ctx.effect(() => () => clearTimeout(timer))
  }, { global: true })
}
