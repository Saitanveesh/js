CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('BOOK', 'NOTES')),
  isbn TEXT,
  title TEXT NOT NULL,
  author_subject TEXT NOT NULL,
  description TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('Excellent', 'Good', 'Fair')),
  location TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  image_keys_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status_created
  ON listings(status, created_at DESC);
