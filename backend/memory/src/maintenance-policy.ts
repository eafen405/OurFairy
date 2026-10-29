/**
 * The memory maintenance numbers' one product decision.
 *
 * These four values are the product's decision from `docs/specs/fairy-memory.md`
 * §5/§6: a source session is maintained after 15 closed user turns by default,
 * the threshold may be set from 5 to 50, the decay interval is 6 hours by
 * default and may be set from 3 to 24. The row's own Config, the maintenance
 * engine's read-time validation and the gateway's phone-facing checks all read
 * this module instead of restating a bound, so the three cannot drift apart.
 *
 * The module imports nothing: the gateway reads it without loading the memory
 * row's runtime graph.
 *
 * @module @ourfairy/dsh-memory/src/maintenance-policy
 */

/** Closed-user-turn threshold: default 15, accepted 5–50 inclusive. */
export const MAINTENANCE_TURNS = Object.freeze({ default: 15, min: 5, max: 50 })

/** Decay interval in hours: default 6, accepted 3–24 inclusive. */
export const MAINTENANCE_DECAY_HOURS = Object.freeze({ default: 6, min: 3, max: 24 })
