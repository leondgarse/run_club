-- A rebuilt plan Claude drafted for a runner (lib/rebuild.js), waiting for them to accept or dismiss it.
-- One per runner; it stays until then (or until its dates pass), unlike a daily suggestion's plan_change.
CREATE TABLE IF NOT EXISTS plan_proposals (
  person     TEXT PRIMARY KEY,
  data       TEXT NOT NULL,      -- {rebuild, start, end, why, focus, goal5k, paces, easyCeil, sessions}
  created_at TEXT NOT NULL
);
