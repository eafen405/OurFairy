/**
 * The executing session's own native spill directory, as one read-only root.
 *
 * Spilled tool results live outside the spaces roots, so without this the
 * model's follow-up `read` on a locator is refused. Chat owns the turn and tool
 * execution that produce spill files, so it owns the retrieval grant; the
 * attachments contribution is not reused because its authority is admitted
 * message attachments, and a spill file is not one.
 */
import { realpathSync } from 'node:fs'
import { sessionDir } from '@deepseek-ai/dsh-spill-local'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: the dsh context's own seams — the mounted spill store and the
// product's space scope this contribution feeds.
import type {} from '@deepseek-ai/dsh-spill'
import type { OwnedSession } from '@ourfairy/dsh-spaces'

/**
 * `<spill root>/session-<hash of this session>`, or `undefined` when there is
 * nothing to grant.
 *
 * The root comes from the mounted `spillStore`, so the bundle row stays the
 * only declaration of where spill files live, and `sessionDir` is the backend's
 * own session mapping rather than a copied hash. Only an existing directory is
 * returned: contributions are evaluated per file operation, so the directory
 * appears with the session's first spill and a session that never spilled
 * grants nothing.
 *
 * `spillStore` is read dynamically rather than injected. Its absence is a
 * supported degradation: no spill row means no spill files, so the contribution
 * grants nothing. Declaring it would instead gate every chat route on an
 * auxiliary capability. The shipped composition requires the `spill-local` row
 * (row id and package) via `tests/native-capabilities.test.mjs` and doctor; the
 * retrieval behavior is pinned by `tests/spill-read.test.mjs`.
 *
 * @param ctx - the chat plugin context.
 * @param session - the session the operation runs for.
 * @returns the real path of that session's spill directory.
 */
function spillDirectory(ctx: Context, session: OwnedSession): string | undefined {
  // The mounted store is the local implementation, the only one that publishes
  // a root; the abstract spill service does not carry that field.
  const store = ctx.get('spillStore') as { readonly root?: unknown } | undefined
  const root = store?.root
  if (typeof root !== 'string' || typeof session?.id !== 'string') return undefined
  try { return realpathSync(sessionDir(root, session.id)) } catch { return undefined }
}

/**
 * Register the contribution. It grants the session directory only — never the
 * spill root, `DSH_HOME`, or the attachments data directory.
 * @param ctx - a context that provides `ourfairySpaces`.
 */
export function installSpillRead(ctx: Context): void {
  ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(session => {
    const directory = spillDirectory(ctx, session)
    return directory === undefined ? [] : [directory]
  }), 'ourfairy-chat: current session spill directory')
}
