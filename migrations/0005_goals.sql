-- One-line target per runner shown at the top of their tab, e.g. "City Half Marathon" on a race date.
-- Typed in English only (TEXT_RULES.goal); zh is a Mistral translation made on save. Feeds the daily suggestion.
CREATE TABLE IF NOT EXISTS goals (
  person     TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  date       TEXT,               -- race/target day, YYYY-MM-DD (optional)
  zh         TEXT,               -- Chinese copy (null if translation failed; English is shown)
  updated_at TEXT NOT NULL
);
