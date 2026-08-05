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

-- ============================================================
-- Additions below are appended idempotently (safe to re-run
-- against an already-deployed database without data loss).
-- ============================================================

-- Multi-admin role tiers: 'SUPER_ADMIN', 'ADMIN', 'MODERATOR', or NULL for
-- a regular buyer/seller.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT;

-- Per-group banner image for the Branding Center.
ALTER TABLE groups ADD COLUMN IF NOT EXISTS banner_url TEXT;

-- Announcements: pinned automatically at the top of selected group(s).
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  message_id    TEXT REFERENCES messages(id) ON DELETE SET NULL,
  text          TEXT NOT NULL,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcements_group ON announcements(group_id, created_at);

-- Tasks & Approvals.
CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'Pending', -- Pending | Completed | Rejected
  created_by     TEXT,
  assigned_role  TEXT, -- 'PARTY A' | 'PARTY B' | NULL (both)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id, created_at);

-- Message delivery/read receipts (WhatsApp-style single/double check).
CREATE TABLE IF NOT EXISTS message_reads (
  message_id     TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  session_token  TEXT NOT NULL,
  delivered_at   TIMESTAMPTZ,
  read_at        TIMESTAMPTZ,
  PRIMARY KEY (message_id, session_token)
);

-- Web Push subscriptions (browser/Android push; iOS only works if the
-- user has added the site to their Home Screen — see DEPLOY_RENDER.md).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id             SERIAL PRIMARY KEY,
  session_token  TEXT NOT NULL,
  endpoint       TEXT NOT NULL UNIQUE,
  p256dh         TEXT NOT NULL,
  auth           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_session ON push_subscriptions(session_token);

-- Branding Center — single-row global config (id is always 1).
CREATE TABLE IF NOT EXISTS branding_settings (
  id                 INTEGER PRIMARY KEY DEFAULT 1,
  logo_url           TEXT,
  accent_color       TEXT DEFAULT '#38bdf8',
  accent_color_2     TEXT DEFAULT '#8b5cf6',
  welcome_message    TEXT DEFAULT 'Welcome to Quantum Secure Transaction Desk.',
  background_url     TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT branding_singleton CHECK (id = 1)
);
