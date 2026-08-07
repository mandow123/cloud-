CREATE TABLE IF NOT EXISTS exchange_orders (
  id TEXT PRIMARY KEY,
  buyer_actor_id TEXT NOT NULL,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  listing_version_id TEXT NOT NULL,
  parallel_units INTEGER NOT NULL CHECK (parallel_units > 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  capacity_gpu_seconds INTEGER NOT NULL CHECK (capacity_gpu_seconds > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  status TEXT NOT NULL CHECK (status IN ('PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED')),
  hold_expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (buyer_actor_id, idempotency_key),
  FOREIGN KEY (listing_version_id) REFERENCES exchange_listing_versions(id),
  CHECK (end_at > start_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_orders_buyer_idx ON exchange_orders(buyer_actor_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_orders_supplier_idx ON exchange_orders(supplier_actor_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  capacity_lot_id TEXT NOT NULL,
  parallel_units INTEGER NOT NULL CHECK (parallel_units > 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  capacity_gpu_seconds INTEGER NOT NULL CHECK (capacity_gpu_seconds > 0),
  state TEXT NOT NULL CHECK (state IN ('HELD', 'SUPPLIER_CONFIRMED', 'COMMITTED', 'IN_SERVICE', 'FULFILLED', 'EXPIRED', 'RELEASED', 'FAILED')),
  hold_expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  CHECK (end_at > start_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_reservations_window_idx ON exchange_reservations(capacity_lot_id, start_at, end_at, state, hold_expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_capacity_transfers (
  id TEXT PRIMARY KEY,
  capacity_lot_id TEXT NOT NULL,
  order_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_bucket TEXT NOT NULL CHECK (from_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN')),
  to_bucket TEXT NOT NULL CHECK (to_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN')),
  capacity_gpu_seconds INTEGER NOT NULL CHECK (capacity_gpu_seconds > 0),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  CHECK (from_bucket <> to_bucket)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_capacity_transfers_lot_idx ON exchange_capacity_transfers(capacity_lot_id, occurred_at ASC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_command_receipts (
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  command_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, idempotency_key)
);
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_capacity_transfers (
  id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
  capacity_gpu_seconds, reason, occurred_at
)
SELECT 'KAI-CT-MIGRATED-' || id, id, NULL, 'lot:' || id || ':issued',
  'ISSUED', 'AVAILABLE', capacity_gpu_seconds, 'CAPACITY_LOT_CREATED', created_at
FROM exchange_capacity_lots;
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_schema_migrations (version, applied_at) VALUES (2, '2026-08-05T00:00:00.000Z');
