-- English Coach — D1 schema
-- Run once: wrangler d1 execute english-coach --file=schema.sql

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  role TEXT,              -- 'user' | 'assistant'
  text_zh TEXT,           -- your original (null for assistant)
  text_en TEXT,           -- translation (null for assistant; Claude replies are already EN)
  text_raw TEXT,          -- assistant raw message
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT UNIQUE,
  meaning_zh TEXT,
  status TEXT DEFAULT 'new',   -- 'new' | 'known' | 'ignored'
  created_at TEXT,
  updated_at TEXT,
  last_reviewed_at TEXT,
  next_review_at TEXT,
  review_count INTEGER DEFAULT 0,
  difficulty INTEGER DEFAULT 3
);

CREATE TABLE IF NOT EXISTS word_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER REFERENCES words(id),
  message_id INTEGER REFERENCES messages(id),
  example TEXT,                -- the sentence it appeared in
  meaning_at_time TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_word_usages_word ON word_usages(word_id);
CREATE INDEX IF NOT EXISTS idx_word_usages_message ON word_usages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

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
