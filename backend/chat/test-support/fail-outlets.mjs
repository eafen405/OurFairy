/** Test-only faults at the native durability and notification boundaries. */
export const name = 'ourfairy-delivery-outlet-faults'
export const inject = ['ourfairyChat', 'sessions']
export function apply(ctx, config) {
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
