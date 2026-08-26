-- Shared Qixiang query protection and 364-day paid card-hour entitlement lots.
CREATE TABLE IF NOT EXISTS card_hour_qixiang_query_protection (
  credential_id TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  circuit_open_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS card_hour_paid_entitlement_lots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  topup_order_id TEXT NOT NULL UNIQUE,
  granted_micros INTEGER NOT NULL CHECK (granted_micros > 0),
  available_micros INTEGER NOT NULL CHECK (available_micros >= 0),
  held_micros INTEGER NOT NULL DEFAULT 0 CHECK (held_micros >= 0),
  spent_micros INTEGER NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
  expired_micros INTEGER NOT NULL DEFAULT 0 CHECK (expired_micros >= 0),
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (topup_order_id) REFERENCES card_hour_topup_orders(id),
  CHECK (available_micros + held_micros + spent_micros + expired_micros = granted_micros)
);
CREATE INDEX IF NOT EXISTS card_hour_paid_entitlement_expiry_idx ON card_hour_paid_entitlement_lots(expires_at,organization_id) WHERE available_micros > 0;
CREATE TABLE IF NOT EXISTS card_hour_paid_entitlement_hold_allocations (
  hold_type TEXT NOT NULL CHECK (hold_type IN ('HOSTING_V2','MANUAL_ORDER_V1')),
  hold_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  allocated_micros INTEGER NOT NULL CHECK (allocated_micros > 0),
  held_micros INTEGER NOT NULL CHECK (held_micros >= 0),
  spent_micros INTEGER NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
  released_micros INTEGER NOT NULL DEFAULT 0 CHECK (released_micros >= 0),
  expired_micros INTEGER NOT NULL DEFAULT 0 CHECK (expired_micros >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (hold_type,hold_id,lot_id),
  FOREIGN KEY (lot_id) REFERENCES card_hour_paid_entitlement_lots(id),
  CHECK (held_micros + spent_micros + released_micros + expired_micros = allocated_micros)
);
CREATE INDEX IF NOT EXISTS card_hour_paid_entitlement_hold_lot_idx ON card_hour_paid_entitlement_hold_allocations(lot_id,held_micros);
CREATE TABLE IF NOT EXISTS card_hour_paid_entitlement_events (
  id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('GRANTED','EXPIRED')),
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (lot_id) REFERENCES card_hour_paid_entitlement_lots(id)
);
CREATE INDEX IF NOT EXISTS card_hour_paid_entitlement_events_org_time_idx ON card_hour_paid_entitlement_events(organization_id,occurred_at DESC);
CREATE TRIGGER IF NOT EXISTS card_hour_paid_entitlement_events_immutable_update BEFORE UPDATE ON card_hour_paid_entitlement_events BEGIN SELECT RAISE(ABORT, 'paid entitlement event immutable'); END;
CREATE TRIGGER IF NOT EXISTS card_hour_paid_entitlement_events_immutable_delete BEFORE DELETE ON card_hour_paid_entitlement_events BEGIN SELECT RAISE(ABORT, 'paid entitlement event immutable'); END;
INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(7,datetime('now'));
