-- Run with: npx wrangler d1 execute clim1001-246-game --remote --file=schema.sql
-- (use --local instead of --remote for the local dev database)

CREATE TABLE IF NOT EXISTS sessions (
  pid        TEXT PRIMARY KEY,          -- opaque player id (HMAC of course + Moodle user_id)
  ctx        TEXT NOT NULL,             -- Moodle context_id (the course)
  role       TEXT NOT NULL DEFAULT 'learner', -- learner | instructor (instructors never count in the class stats)
  rule       TEXT NOT NULL,             -- which hidden rule this player was assigned
  first_seen INTEGER NOT NULL,          -- unix seconds
  launches   INTEGER NOT NULL DEFAULT 1,
  finished   INTEGER,                   -- unix seconds when the rule was submitted
  rule_text  TEXT,
  confidence TEXT,                      -- unsure | fairly | certain
  verdict    TEXT,                      -- same | different, as graded (NULL = waiting to be checked)
  graded_by  TEXT,                      -- auto:<pattern id> | manual
  graded_at  INTEGER,
  self_verdict TEXT,                    -- what the player thought: same | different | skipped
  n_attempts INTEGER NOT NULL DEFAULT 0,
  n_no       INTEGER NOT NULL DEFAULT 0 -- how many tested sets did not fit
);

-- Added after the first deployment; harmless if the column already exists (the error is
-- "duplicate column name", which wrangler reports but which changes nothing).
-- ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'learner';

CREATE TABLE IF NOT EXISTS attempts (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  pid  TEXT NOT NULL,
  n    INTEGER NOT NULL,
  a    INTEGER NOT NULL,
  b    INTEGER NOT NULL,
  c    INTEGER NOT NULL,
  fits INTEGER NOT NULL,
  ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_pid ON attempts (pid);

-- OAuth nonces seen, to reject replayed launches.
CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  ts    INTEGER NOT NULL
);

-- Running counts per course and rule, so showing class stats reads a few dozen rows
-- rather than scanning every session. Derived from sessions (see src/tally.js); the
-- grading script rebuilds it from scratch, the worker adds to it as players finish.
CREATE TABLE IF NOT EXISTS tally (
  ctx  TEXT NOT NULL,
  rule TEXT NOT NULL,
  key  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ctx, rule, key)
);
