/**
 * Upload lifecycle only; native session messages own admitted references.
 *
 * @module @ourfairy/dsh-identity/src/schema/uploads
 */

/** The upload lifecycle table. */
export const UPLOADS_SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  upload_id TEXT PRIMARY KEY,
  owner_short_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0, -- 0 uploading, 1 complete, 2 expired
  offset INTEGER NOT NULL DEFAULT 0,
  original_ref TEXT,
  image_ref TEXT,
  expires_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`
