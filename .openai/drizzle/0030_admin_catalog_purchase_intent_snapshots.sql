CREATE TABLE IF NOT EXISTS admin_catalog_purchase_intent_snapshots (
  demand_id TEXT PRIMARY KEY,
  buyer_organization_id TEXT NOT NULL,
  buyer_account_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_title TEXT NOT NULL,
  resource_snapshot_json TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  duration_hours REAL,
  delivery_date TEXT,
  pricing_unit TEXT NOT NULL,
  unit_price_cny_cents INTEGER NOT NULL CHECK (unit_price_cny_cents > 0),
  unit_card_hour_micros INTEGER NOT NULL CHECK (unit_card_hour_micros > 0),
  estimated_card_hour_micros INTEGER NOT NULL CHECK (estimated_card_hour_micros > 0),
  status TEXT NOT NULL CHECK (status='PENDING_MANUAL_DELIVERY'),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (buyer_account_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS admin_catalog_purchase_intent_snapshots_buyer_idx
  ON admin_catalog_purchase_intent_snapshots(buyer_organization_id,created_at DESC);
