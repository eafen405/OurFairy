// Test-only profile row: seed cold artifacts through the public persistence API.
// No fixture route is mounted, and the test removes this row before restart.
export const name = 'ourfairy-session-fixtures'
export const inject = ['sessions', 'sessionPersistence']

export async function apply(ctx, config) {
  for (const { id, owner } of config.fixtures) {
    const session = ctx.sessions.prepare(id, { meta: owner === undefined ? {} : { owner } })
    const handle = await ctx.sessionPersistence.create(session.header)
    try {
      await handle.flush()
    } finally {
      await handle.close()
    }
  }
}
