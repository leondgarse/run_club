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
  updated_at TEXT NOT NULL,
  week       TEXT,               -- linked plan session (Monday of its week), NULL = not linked
  item       TEXT                -- linked session id, e.g. "tue"
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
-- On-demand refresh of TJH's/SJH's daily suggestion (max 5 per runner per day).
-- The site queues a request; scripts/refresh.sh on the Mac picks it up, runs Claude and marks it done.
CREATE TABLE IF NOT EXISTS refreshes (
  person       TEXT NOT NULL,
  date         TEXT NOT NULL,              -- the suggestion's day
  count        INTEGER NOT NULL DEFAULT 0, -- refreshes used that day (failed ones are given back)
  requested_at TEXT,                       -- newest request (ISO); pending while done_at is NULL
  done_at      TEXT,
  failed       INTEGER NOT NULL DEFAULT 0, -- last request couldn't be served
  PRIMARY KEY (person, date)
);
-- One-line target per runner shown at the top of their tab, e.g. "City Half Marathon" on a race date.
-- Typed in English only (TEXT_RULES.goal); zh is a Mistral translation made on save. Feeds the daily suggestion.
CREATE TABLE IF NOT EXISTS goals (
  person     TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  date       TEXT,               -- race/target day, YYYY-MM-DD (optional)
  zh         TEXT,               -- Chinese copy (null if translation failed; English is shown)
  updated_at TEXT NOT NULL,
  max_hr     INTEGER,            -- optional, from a race/test (TJH/SJH only)
  rest_hr    INTEGER             -- optional, morning resting HR (TJH/SJH only)
);
-- Accepted plan changes (TJH/WGW): Claude proposes one in the daily suggestion, the runner taps Accept.
-- data = {from, sessions:[{day, kind, title, meta}], why}; days from `from` on replace the plan in public/plans.js.
CREATE TABLE IF NOT EXISTS plan_changes (
  person      TEXT NOT NULL,
  week        TEXT NOT NULL,      -- Monday of the changed week
  data        TEXT NOT NULL,
  source_date TEXT,               -- the suggestion's day it came from
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (person, week)
);
CREATE TABLE IF NOT EXISTS activity_photos (
  activity_id INTEGER NOT NULL,
  idx         INTEGER NOT NULL,   -- 0..2
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,      -- base64, resized on the phone
  created_at  TEXT NOT NULL,
  PRIMARY KEY (activity_id, idx)
);
-- WeChat mini program sign-in (functions/api/wxlogin.js): openid -> runner, and session tokens (hash only).
CREATE TABLE IF NOT EXISTS wx_users (
  openid     TEXT PRIMARY KEY,
  person     TEXT NOT NULL,      -- TJH / WGW / SJH: the tab the mini program opens on
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wx_sessions (
  token_hash TEXT PRIMARY KEY,   -- hex SHA-256 of the bearer token
  openid     TEXT NOT NULL,
  expires_at TEXT NOT NULL       -- ISO time; 30 days after sign-in
);
CREATE INDEX IF NOT EXISTS wx_sessions_openid ON wx_sessions (openid);
-- Plan sessions the runner un-ticked by hand: the automatic matching (lib/match.js) never ticks them again.
-- A hand tick removes the row.
CREATE TABLE IF NOT EXISTS auto_skip (
  person TEXT NOT NULL,
  week   TEXT NOT NULL,
  item   TEXT NOT NULL,
  PRIMARY KEY (person, week, item)
);
-- A rebuilt plan Claude drafted for a runner (lib/rebuild.js), waiting for them to accept or dismiss it.
-- One per runner; it stays until then (or until its dates pass), unlike a daily suggestion's plan_change.
CREATE TABLE IF NOT EXISTS plan_proposals (
  person     TEXT PRIMARY KEY,
  data       TEXT NOT NULL,      -- {rebuild, start, end, why, focus, goal5k, paces, easyCeil, sessions}
  created_at TEXT NOT NULL
);
