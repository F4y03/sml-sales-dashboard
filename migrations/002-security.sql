-- Additive only: no existing table is altered. Every child row is removed with its user (ON DELETE CASCADE).
-- Not recorded in schema_migrations on purpose: every statement is idempotent and runs at each start like 001.
CREATE TABLE IF NOT EXISTS login_lockouts (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
-- secret_enc is AES-256-GCM ciphertext (see totpService.js); last_step blocks replay of an already used OTP.
CREATE TABLE IF NOT EXISTS user_totp (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret_enc TEXT NOT NULL, last_step INTEGER NOT NULL DEFAULT 0, confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS recovery_codes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at TEXT);
CREATE INDEX IF NOT EXISTS recovery_codes_user ON recovery_codes(user_id);
-- Only the SHA-256 of the random device token is stored.
CREATE TABLE IF NOT EXISTS trusted_devices (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS trusted_devices_user ON trusted_devices(user_id);
-- Short-lived state between "password accepted" and "OTP accepted". kind: verify (already enrolled) or setup (pending_secret_enc set).
CREATE TABLE IF NOT EXISTS login_challenges (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('verify','setup')), pending_secret_enc TEXT, expires INTEGER NOT NULL);
-- Only sessions completed through OTP/recovery or a trusted device have this proof.
CREATE TABLE IF NOT EXISTS session_two_factor (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE);
-- Per-account 2FA switch set by a Super Admin. Super Admin accounts are always required regardless of this table.
CREATE TABLE IF NOT EXISTS user_two_factor_policy (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, required INTEGER NOT NULL DEFAULT 1);
