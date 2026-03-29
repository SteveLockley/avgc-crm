-- Social media posts for Facebook and Instagram publishing
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  image_url TEXT,
  fb_post_id TEXT,
  ig_media_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  error_message TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by TEXT
);
