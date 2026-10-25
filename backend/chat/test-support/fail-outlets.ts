/** Test-only faults at the native durability and notification boundaries. */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'ourfairy-delivery-outlet-faults'
export const inject = ['ourfairyChat', 'sessions']

/** The faults this fixture injects. */
export interface FailOutletsConfig {
  /** The session whose flush and notification the fault applies to. */
  readonly sessionId: string
  /** Fail the session's next durability checkpoint. */
  readonly failFlush?: boolean
  /** Fail every delivery notification. */
  readonly failNotification?: boolean
}

export function apply(ctx: Context, config: FailOutletsConfig): void {
  let failFlush = false, usedFlush = false
  ctx.on('session/event', (session, event) => {
    if (!usedFlush && config.failFlush && session.id === config.sessionId && event.type === 'delivery/message') failFlush = true
  }, { global: true })
  ctx.on('session/flush', session => {
    if (session.id === config.sessionId && failFlush) {
      usedFlush = true; failFlush = false
      throw new Error('injected durability checkpoint failure')
    }
  }, { global: true })
  ctx.on('ourfairy/delivery', async () => {
    if (config.failNotification) throw new Error('injected notification outlet failure')
  }, { global: true })
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The product's delivery notification. The delivery row emits it once the
     * durable row has settled; this fixture declares it for the test program
     * only, so the delivery row keeps the authority on its own shape.
     */
    'ourfairy/delivery': (result: { readonly messageId: string; readonly acceptedSeq: number }) => void | Promise<void>
  }
}
