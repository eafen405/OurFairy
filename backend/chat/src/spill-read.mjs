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
 * auxiliary capability. The shipped composition still requires the
 * `spill-local` row (`tests/native-capabilities.test.mjs`, and doctor's
 * native-capabilities check), so renaming or dropping that row fails there
 * rather than silently disabling retrieval.
 *
 * @param {object} ctx - the chat plugin context.
 * @param {object} session - the native Session the operation runs for.
 * @returns {string|undefined} the real path of that session's spill directory.
 */
function spillDirectory(ctx, session) {
  const root = ctx.get('spillStore')?.root
  if (typeof root !== 'string' || typeof session?.id !== 'string') return undefined
  try { return realpathSync(sessionDir(root, session.id)) } catch { return undefined }
}

/**
 * Register the contribution. It grants the session directory only — never the
 * spill root, `DSH_HOME`, or the attachments data directory.
 * @param {object} ctx - a context that provides `ourfairySpaces`.
 */
export function installSpillRead(ctx) {
  ctx.effect(() => ctx.ourfairySpaces.contributeReadonlyFiles(session => {
    const directory = spillDirectory(ctx, session)
    return directory === undefined ? [] : [directory]
  }), 'ourfairy-chat: current session spill directory')
}
