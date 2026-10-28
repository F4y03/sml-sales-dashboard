-- One row per daily buyer-data cleanup run (Shopee DPP 10.6/10.7): when it ran and how many records it changed.
CREATE TABLE IF NOT EXISTS retention_runs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  provinces INTEGER NOT NULL DEFAULT 0,
  logs INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS retention_runs_at ON retention_runs(at);
