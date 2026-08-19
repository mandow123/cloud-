CREATE TABLE IF NOT EXISTS admin_manual_delivery_intakes (
  demand_id TEXT PRIMARY KEY,
  buyer_organization_id TEXT NOT NULL,
  buyer_account_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_title TEXT NOT NULL,
  canonical_ssh_public_key TEXT NOT NULL,
  ssh_public_key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status='PENDING_MANUAL_DELIVERY'),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (buyer_account_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS admin_manual_delivery_intakes_created_idx
  ON admin_manual_delivery_intakes(status,created_at DESC);
