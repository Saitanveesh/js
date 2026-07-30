-- The existing listings table is owned by 0001_initial.sql. Do not recreate it.
CREATE TABLE IF NOT EXISTS listing_objects (
  object_key TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listing_objects_listing
  ON listing_objects(listing_id);

CREATE TABLE IF NOT EXISTS storage_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stored_bytes INTEGER NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO storage_usage (id, stored_bytes, reserved_bytes, updated_at)
VALUES (1, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;
