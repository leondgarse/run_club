-- Upgrade a DB created with the first schema.sql (run once).
ALTER TABLE progress ADD COLUMN km REAL;
ALTER TABLE progress ADD COLUMN duration TEXT;
ALTER TABLE progress ADD COLUMN pace TEXT;
ALTER TABLE progress ADD COLUMN hr INTEGER;
ALTER TABLE progress ADD COLUMN note TEXT;
ALTER TABLE progress ADD COLUMN has_photo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE progress ADD COLUMN updated_at TEXT;
CREATE TABLE IF NOT EXISTS photos (
  person TEXT NOT NULL, week TEXT NOT NULL, item TEXT NOT NULL,
  mime TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (person, week, item)
);
CREATE TABLE IF NOT EXISTS coach (
  person TEXT NOT NULL, week TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (person, week)
);
