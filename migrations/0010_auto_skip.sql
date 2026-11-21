-- Plan sessions the runner un-ticked by hand: the automatic matching (lib/match.js) never ticks them again.
-- A hand tick removes the row.
CREATE TABLE IF NOT EXISTS auto_skip (
  person TEXT NOT NULL,
  week   TEXT NOT NULL,
  item   TEXT NOT NULL,
  PRIMARY KEY (person, week, item)
);
