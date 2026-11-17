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
