CREATE TABLE IF NOT EXISTS exchange_order_lifecycle (
  order_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL CHECK (phase IN ('AWAITING_SUPPLIER', 'AWAITING_PAYMENT', 'FULFILLING', 'AWAITING_ACCEPTANCE', 'COMPLETED', 'EXCEPTION')),
  state_reason TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_payment_intents (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  merchant_account_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'CAPTURED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED')),
  provider_payment_id TEXT,
  expires_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
  provider_event_id TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  merchant_account_ref TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'CAPTURED'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  funds_moved INTEGER NOT NULL CHECK (funds_moved IN (0, 1)),
  verification_method TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  raw_payload_digest TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('APPLIED', 'IGNORED_DUPLICATE_TRANSACTION', 'LATE_CAPTURE_REVIEW', 'REVIEW_REQUIRED')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (provider, environment, provider_event_id),
  FOREIGN KEY (payment_intent_id) REFERENCES exchange_payment_intents(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS exchange_payment_events_capture_idx
  ON exchange_payment_events(provider, environment, provider_transaction_id)
  WHERE outcome = 'APPLIED';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_delivery_tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  payment_event_id TEXT NOT NULL UNIQUE,
  reservation_id TEXT NOT NULL,
  capacity_lot_id TEXT NOT NULL,
  listing_version_id TEXT NOT NULL,
  resource_asset_id TEXT NOT NULL,
  product_version_id TEXT NOT NULL,
  lock_transfer_id TEXT NOT NULL UNIQUE,
  parallel_units INTEGER NOT NULL CHECK (parallel_units > 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  delivery_form TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('MANUAL', 'CONNECTOR')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROVISIONING', 'VERIFYING', 'DELIVERED', 'IN_SERVICE', 'COMPLETED', 'FAILED')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  evidence_policy_version TEXT NOT NULL,
  provisioning_due_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (payment_event_id) REFERENCES exchange_payment_events(id),
  FOREIGN KEY (reservation_id) REFERENCES exchange_reservations(id),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  FOREIGN KEY (listing_version_id) REFERENCES exchange_listing_versions(id),
  FOREIGN KEY (resource_asset_id) REFERENCES exchange_resource_assets(id),
  FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
  FOREIGN KEY (lock_transfer_id) REFERENCES exchange_capacity_transfers(id),
  CHECK (end_at > start_at)
);
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_schema_migrations (version, applied_at) VALUES (3, '2026-08-05T00:00:00.000Z');
