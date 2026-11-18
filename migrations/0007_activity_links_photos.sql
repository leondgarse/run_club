-- A plan session's full details live in My log: activities can be linked to a ticked session (week, item),
-- and carry up to 3 screenshots/photos (activity_photos, idx 0-2).
ALTER TABLE activities ADD COLUMN week TEXT;   -- Monday of the linked session's week (NULL = not linked)
ALTER TABLE activities ADD COLUMN item TEXT;   -- linked session id, e.g. "tue"
CREATE TABLE IF NOT EXISTS activity_photos (
  activity_id INTEGER NOT NULL,
  idx         INTEGER NOT NULL,   -- 0..2
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,      -- base64, resized on the phone
  created_at  TEXT NOT NULL,
  PRIMARY KEY (activity_id, idx)
);
