-- Durable claim and cooldown for callback and member-triggered active order queries.
CREATE TABLE IF NOT EXISTS card_hour_topup_reconciliation_claims (
  topup_order_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  claim_token TEXT,
  claimed_at TEXT,
  next_query_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (topup_order_id) REFERENCES card_hour_topup_orders(id),
  CHECK ((claim_token IS NULL AND claimed_at IS NULL) OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS card_hour_topup_reconciliation_due_idx ON card_hour_topup_reconciliation_claims(next_query_at,claimed_at);
CREATE TABLE IF NOT EXISTS card_hour_topup_reconciliation_requests (
  organization_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  topup_order_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id,idempotency_key),
  FOREIGN KEY (topup_order_id) REFERENCES card_hour_topup_orders(id)
);
CREATE INDEX IF NOT EXISTS card_hour_topup_reconciliation_requests_order_idx ON card_hour_topup_reconciliation_requests(topup_order_id,created_at DESC);
INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(6,datetime('now'));
