-- Prompt Coach + Response Digest migration.
-- Apply to production D1:
--   wrangler d1 execute english-coach --file=migration-002-prompt-coach.sql --remote
--
-- Run once. Existing messages, words, and usages are preserved.

ALTER TABLE words ADD COLUMN last_reviewed_at TEXT;
ALTER TABLE words ADD COLUMN next_review_at TEXT;
ALTER TABLE words ADD COLUMN review_count INTEGER DEFAULT 0;
ALTER TABLE words ADD COLUMN difficulty INTEGER DEFAULT 3;

CREATE TABLE IF NOT EXISTS prompt_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES messages(id),
  original TEXT NOT NULL,
  corrected TEXT NOT NULL,
  explanation TEXT,
  pattern TEXT,
  error_type TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_prompt_corrections_created
  ON prompt_corrections(created_at);

CREATE INDEX IF NOT EXISTS idx_prompt_corrections_error_type
  ON prompt_corrections(error_type);

CREATE TABLE IF NOT EXISTS response_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER REFERENCES messages(id),
  summary TEXT,
  next_steps_json TEXT,
  key_terms_json TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_response_digests_message
  ON response_digests(message_id);
