-- A runner's free-text note to the coach (a niggle, a question), read by the next daily suggestion.
ALTER TABLE goals ADD COLUMN note TEXT;
ALTER TABLE goals ADD COLUMN note_at TEXT;
