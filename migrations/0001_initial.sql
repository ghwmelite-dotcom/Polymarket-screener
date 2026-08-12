PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'rejected', 'qualified')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_audited_at TEXT,
  last_alerted_at TEXT,
  policy_version TEXT,
  score REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL COLLATE NOCASE REFERENCES wallets(address),
  policy_version TEXT NOT NULL,
  source_snapshot_key TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  observed_trade_count INTEGER NOT NULL,
  valid_trade_count INTEGER NOT NULL,
  simulation_net_pnl REAL NOT NULL,
  stressed_net_pnl REAL NOT NULL,
  max_drawdown_pct REAL NOT NULL,
  adverse_scaling_score REAL NOT NULL,
  qualification_status TEXT NOT NULL CHECK (qualification_status IN ('qualified', 'rejected', 'inconclusive')),
  reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audits_wallet_created_idx ON audits(wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_outbox (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL COLLATE NOCASE REFERENCES wallets(address),
  audit_id TEXT NOT NULL REFERENCES audits(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_outbox_state_idx ON alert_outbox(state, created_at);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  candidate_count INTEGER NOT NULL DEFAULT 0,
  enqueued_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
