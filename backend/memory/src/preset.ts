/**
 * The durable preset id every memory maintenance child carries.
 *
 * The id lives in the session header (`agentPreset`), not in process state, so
 * a restart still resolves the same composition. It is memory's private fact:
 * `maintenance.ts` writes it when it creates the child and reads it back to
 * recognize the same child. Product tool rows do not compare this id; they
 * register only for a user's own session (`@ourfairy/dsh-identity/session`).
 * dsh's tool restriction cannot hide a scope's own registrations, so the
 * product rows' default is enforced at each row, and memory grants its child
 * the memory tools itself.
 *
 * @module @ourfairy/dsh-memory/src/preset
 */
export const MAINTENANCE_PRESET = 'ourfairy:memory-maintenance'
