CREATE TABLE IF NOT EXISTS card_hour_topup_refunds (
  id TEXT PRIMARY KEY,
  topup_order_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ALIPAY','QIXIANG_PAY')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  card_hour_micros INTEGER NOT NULL CHECK (card_hour_micros > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','PROCESSING','MANUAL_REQUIRED','SUCCEEDED','FAILED','REJECTED')),
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  request_reason TEXT NOT NULL,
  decision_reason TEXT,
  provider_refund_request_id TEXT NOT NULL UNIQUE,
  provider_transaction_id TEXT,
  claim_token TEXT,
  claimed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT,
  manual_evidence_digest TEXT,
  payload_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (topup_order_id) REFERENCES card_hour_topup_orders(id),
  CHECK ((status = 'PROCESSING' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL) OR (status <> 'PROCESSING' AND claim_token IS NULL AND claimed_at IS NULL))
);
CREATE INDEX IF NOT EXISTS card_hour_topup_refunds_status_idx ON card_hour_topup_refunds(status,updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS card_hour_topup_refunds_provider_tx_unique_idx ON card_hour_topup_refunds(provider,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
INSERT INTO card_hour_schema_migrations(version,applied_at)
SELECT 7,datetime('now') WHERE (SELECT COALESCE(MAX(version),0) FROM card_hour_schema_migrations)=6;
