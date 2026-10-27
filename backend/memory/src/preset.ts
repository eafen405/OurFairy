/**
 * The durable preset id every memory maintenance child carries.
 *
 * The id lives in the session header (`agentPreset`), not in process state, so
 * a restart still resolves the same composition. The other product rows use the
 * same literal to skip their own tool and prompt registration for this preset;
 * dsh's tool restriction cannot hide a scope's own registrations, so skipping
 * at each row is the only way a child sees memory tools and nothing else.
 *
 * @module @ourfairy/dsh-memory/src/preset
 */
export const MAINTENANCE_PRESET = 'ourfairy:memory-maintenance'
