/**
 * Which dsh session headers are a user's own session: the one rule the product
 * rows share before they register their per-agent tool surface.
 *
 * This is a pure codec subpath, like `./owner`: it reads the three durable
 * header facts and mounts nothing. Calling it never requires the identity
 * plugin.
 *
 * @module @ourfairy/dsh-identity/src/session
 */
import type { SessionHeader } from '@deepseek-ai/dsh-session'

/** The header facts that decide whether a session is the user's own. */
export type UserSessionHeader = Pick<SessionHeader, 'owner' | 'parentSession' | 'agentPreset'>

/**
 * Whether one session header describes a user's own session.
 *
 * A user's own session is owned by a user, not a child of another session, and
 * not composed from an agent preset. A maintenance child has a parent and a
 * preset but no owner; a future scheduled task or subagent is expected to
 * differ in at least one of the same three facts. The product rows use this as
 * their default tool-audience check, so an absent header is not a user session.
 *
 * @param header - the durable session header, or no header at all.
 * @returns true only for an owned, non-child, non-preset session.
 */
export function isUserSession(header: UserSessionHeader | undefined): boolean {
  return header !== undefined
    && header.owner !== undefined
    && header.parentSession === undefined
    && header.agentPreset === undefined
}
