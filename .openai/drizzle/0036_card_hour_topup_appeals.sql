-- Additive, manual-only payment appeal sidecar. This migration never changes
-- a payment, card-hour wallet, ledger balance, refund, or provider record.
CREATE TABLE IF NOT EXISTS card_hour_topup_appeals (
  id TEXT PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  topup_order_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('PENDING_TIMEOUT','CLOSED_BUT_CHARGED','RECONCILIATION_REQUIRED')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  status TEXT NOT NULL CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','CLOSED')),
  resolution_note TEXT,
  assigned_admin_principal_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  closed_at TEXT,
  UNIQUE (organization_id, topup_order_id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (topup_order_id) REFERENCES card_hour_topup_orders(id),
  CHECK ((status IN ('RESOLVED','CLOSED') AND resolution_note IS NOT NULL) OR (status IN ('OPEN','UNDER_REVIEW') AND resolution_note IS NULL))
);
CREATE INDEX IF NOT EXISTS card_hour_topup_appeals_admin_idx ON card_hour_topup_appeals(status,updated_at DESC);
CREATE INDEX IF NOT EXISTS card_hour_topup_appeals_org_idx ON card_hour_topup_appeals(organization_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS card_hour_topup_appeal_events (
  id TEXT PRIMARY KEY,
  appeal_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATE','START_REVIEW','RESOLVE','CLOSE')),
  actor_principal_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (appeal_id) REFERENCES card_hour_topup_appeals(id)
);
CREATE INDEX IF NOT EXISTS card_hour_topup_appeal_events_case_idx ON card_hour_topup_appeal_events(appeal_id,occurred_at);
CREATE TRIGGER IF NOT EXISTS card_hour_topup_appeal_events_immutable_update BEFORE UPDATE ON card_hour_topup_appeal_events BEGIN SELECT RAISE(ABORT,'topup appeal event immutable'); END;
CREATE TRIGGER IF NOT EXISTS card_hour_topup_appeal_events_immutable_delete BEFORE DELETE ON card_hour_topup_appeal_events BEGIN SELECT RAISE(ABORT,'topup appeal event immutable'); END;
INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(4,datetime('now'));
