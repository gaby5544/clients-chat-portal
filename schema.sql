-- Quantum Secure Transaction Desk - PostgreSQL Schema
-- Run once against your Postgres database before first boot.
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
  custom_name_a             TEXT NOT NULL DEFAULT 'Buyer',
  custom_name_b             TEXT NOT NULL DEFAULT 'Seller',
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

-- ============================================================
-- Seller accounts, KYC, deposits & withdrawals ("the vault").
-- A "seller account" is a groups row with real login credentials —
-- the group IS the seller's dedicated workspace. Chat still uses the
-- existing free-form session_token identity above; this is a separate,
-- password-protected identity layer used only for the finance features.
-- ============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS account_type          TEXT NOT NULL DEFAULT 'seller_type_a';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS registration_status   TEXT NOT NULL DEFAULT 'invited'; -- 'invited' | 'active'
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_token          TEXT UNIQUE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_consumed_at    TIMESTAMPTZ;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_full_name       TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_email           TEXT UNIQUE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS owner_password_hash   TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS currency              CHAR(3);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS currency_locked_at    TIMESTAMPTZ;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS kyc_status            TEXT NOT NULL DEFAULT 'not_submitted'; -- not_submitted | pending | verified | rejected

CREATE TABLE IF NOT EXISTS seller_sessions (
  session_token   TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seller_sessions_group ON seller_sessions(group_id);

CREATE TABLE IF NOT EXISTS password_reset_codes (
  id            SERIAL PRIMARY KEY,
  group_id      TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_group ON password_reset_codes(group_id);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id                      TEXT PRIMARY KEY,
  group_id                TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  doc_type                TEXT NOT NULL, -- national_id | drivers_license | passport
  id_front_url            TEXT NOT NULL,
  id_back_url             TEXT,
  proof_of_address_url    TEXT NOT NULL,
  selfie_url              TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending', -- pending | verified | rejected
  rejection_reason        TEXT,
  reviewed_by             TEXT,
  reviewed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_group ON kyc_submissions(group_id, created_at);

CREATE TABLE IF NOT EXISTS deposits (
  id              TEXT PRIMARY KEY,
  group_id        TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  reference       TEXT NOT NULL,
  method          TEXT NOT NULL, -- crypto | bank
  asset           TEXT,
  network         TEXT,
  amount          NUMERIC(18,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'held_in_vault', -- held_in_vault | verified | rejected
  rejection_reason TEXT,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deposits_group ON deposits(group_id, created_at);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  reference         TEXT NOT NULL,
  method            TEXT NOT NULL, -- crypto | bank
  asset             TEXT,
  network           TEXT,
  destination       JSONB,
  amount            NUMERIC(18,2) NOT NULL, -- always in the group's own account currency (the ledger amount)
  amount_currency   CHAR(3) NOT NULL,        -- = the account currency at time of request
  entered_amount    NUMERIC(18,2),           -- what the seller actually typed, if different (crypto only)
  entered_currency  CHAR(3),                 -- currency the seller chose to enter the amount in (crypto only)
  amount_usd_equiv  NUMERIC(18,2),           -- informational USD reference shown at request time
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | held_in_vault | processing | completed | rejected | failed
  status_reason     TEXT,
  status_history    JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_group ON withdrawal_requests(group_id, created_at);

CREATE TABLE IF NOT EXISTS balances (
  group_id      TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  available     NUMERIC(18,2) NOT NULL DEFAULT 0,
  held          NUMERIC(18,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
