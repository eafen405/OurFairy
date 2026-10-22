/**
 * Group ownership and membership; uniqueness is checked inside the transactions.
 *
 * @module @ourfairy/dsh-identity/src/schema/groups
 */

/** The group tables and the indexes their queries use. */
export const GROUPS_SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_short_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_short_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS groups_by_owner ON groups(owner_short_id);
CREATE INDEX IF NOT EXISTS group_members_by_user ON group_members(user_short_id);
CREATE INDEX IF NOT EXISTS group_members_by_group ON group_members(group_id);
`
