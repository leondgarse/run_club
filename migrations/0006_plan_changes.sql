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
