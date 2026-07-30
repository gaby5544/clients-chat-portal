-- Quantum Secure Transaction Desk - PostgreSQL Schema
-- Run once against your Render Postgres database before first boot.
-- The server also auto-runs this on startup (see src/db.js), so manual
-- execution is optional but recommended for review.

CREATE TABLE IF NOT EXISTS users (
  session_token   TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'PARTY A',
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  email           TEXT,
  country_code    TEXT,
  avatar_seed     TEXT,
  is_online       BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  custom_name_a             TEXT NOT NULL DEFAULT 'Buyer (Party A)',
  custom_name_b             TEXT NOT NULL DEFAULT 'Seller (Party B)',
  file_uploads_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  highlighted               BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_form_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_token      TEXT,
  sender_name       TEXT NOT NULL,
  sender_role       TEXT,
  text              TEXT NOT NULL,
  file_url          TEXT,
  file_type         TEXT,
  file_name         TEXT,
  reply_to_id       TEXT,
  forwarded_from    TEXT,
  target_lang       TEXT DEFAULT 'en',
  is_edited         BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at);

CREATE TABLE IF NOT EXISTS message_edits (
  id            SERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  old_text      TEXT NOT NULL,
  edited_by     TEXT NOT NULL,
  edited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL,
  emoji         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, session_token, emoji)
);

CREATE TABLE IF NOT EXISTS pinned_messages (
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, message_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  session_token TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload       JSONB,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unread_counts (
  session_token TEXT NOT NULL,
  group_id      TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_token, group_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  TEXT PRIMARY KEY,
  group_id            TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  full_legal_name     TEXT NOT NULL,
  country             TEXT NOT NULL,
  role                TEXT NOT NULL,
  asset_type          TEXT NOT NULL,
  asset_description   TEXT,
  quantity            TEXT,
  unit_price          TEXT,
  total_value         TEXT,
  payment_currency    TEXT,
  payment_method      TEXT,
  payment_terms       TEXT,
  notes               TEXT,
  submitted_by        TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_group ON transactions(group_id);
