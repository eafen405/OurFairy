/**
 * The lookup indexes the queries use. No unique index: uniqueness is a rule the
 * store enforces inside a transaction, not a database constraint.
 *
 * @module @ourfairy/dsh-identity/src/schema/indexes
 */

/** The ordinary lookup indexes the queries need. */
export const INDEXES_SCHEMA = `
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS users_by_short_id ON users(short_id);
CREATE INDEX IF NOT EXISTS users_by_name ON users(name);
`
