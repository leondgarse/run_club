-- Fresh install. For an existing DB created from the first version, run migrations/0002_logs.sql instead.
CREATE TABLE IF NOT EXISTS progress (
  person     TEXT NOT NULL,      -- TJH | WGW | SJH
  week       TEXT NOT NULL,      -- Monday of the week, YYYY-MM-DD
  item       TEXT NOT NULL,      -- session id within the week, e.g. "tue", "wed2"
  done_at    TEXT NOT NULL,      -- ISO timestamp
  km         REAL,
  duration   TEXT,               -- "32:10" or "1:02:30"
  pace       TEXT,               -- "5:44" (min/km)
  hr         INTEGER,            -- average bpm
  note       TEXT,
  has_photo  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (person, week, item)
);
CREATE TABLE IF NOT EXISTS photos (
  person TEXT NOT NULL, week TEXT NOT NULL, item TEXT NOT NULL,
  mime TEXT NOT NULL, data TEXT NOT NULL,   -- base64, resized on the phone to ~1280px
  created_at TEXT NOT NULL,
  PRIMARY KEY (person, week, item)
);
CREATE TABLE IF NOT EXISTS coach (
  person TEXT NOT NULL, week TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (person, week)
);
CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person     TEXT NOT NULL,
  date       TEXT NOT NULL,      -- YYYY-MM-DD (local date of the session)
  type       TEXT NOT NULL,      -- run | gym | swim | bike | hike | other
  title      TEXT,
  km         REAL,
  duration   TEXT,               -- "32:10" or "1:02:30"
  pace       TEXT,               -- "5:44" min/km
  hr         INTEGER,
  cadence    INTEGER,
  note       TEXT,
  extra      TEXT,               -- JSON: anything else from the watch (max HR, splits, stride, ...)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activities_person_date ON activities(person, date);
CREATE TABLE IF NOT EXISTS suggestions (
  person     TEXT NOT NULL,
  date       TEXT NOT NULL,      -- the day the suggestion is for
  data       TEXT NOT NULL,      -- JSON {call, headline, session, why, next}
  data_at    TEXT,               -- newest log/activity updated_at it was based on
  created_at TEXT NOT NULL,
  PRIMARY KEY (person, date)
);
