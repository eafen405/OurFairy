// Test-only profile row: seed cold artifacts through the public persistence API.
// No fixture route is mounted, and the test removes this row before restart.
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId, SessionOwnerId } from '@deepseek-ai/dsh-session'
// The dsh context's own seams: the session store and the durable store.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'

export const name = 'ourfairy-session-fixtures'
export const inject = ['sessions', 'sessionPersistence']

/**
 * One cold artifact this row seeds.
 *
 * The ids and owner are the ones the test writes into the durable store; the
 * row only carries them into the public persistence API.
 */
export interface Fixture {
  readonly id: SessionId
  readonly owner?: SessionOwnerId
}

export async function apply(ctx: Context, config: { readonly fixtures: readonly Fixture[] }): Promise<void> {
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
