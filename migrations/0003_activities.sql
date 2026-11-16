-- Free-form activity log (off-plan or historical sessions) + cached daily suggestions.
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
