/**
 * Delivery coordination only; the native log is the delivered-content authority.
 *
 * @module @ourfairy/dsh-identity/src/schema/deliveries
 */

/** The delivery coordination table. */
export const DELIVERIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT PRIMARY KEY,
  sender_short_id INTEGER NOT NULL,
  sender_session_id TEXT NOT NULL,
  recipient_short_id INTEGER NOT NULL,
  recipient_session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status INTEGER NOT NULL DEFAULT 0, -- 0 ready coordination, 1 durably delivered, 2 preparing files
  message_id TEXT,
  accepted_seq INTEGER,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`
