-- M6-A1: generic rate-unit accounting without contaminating GPU aliases.
-- Deployment migrations provide the transaction. Node SQLite wraps this file
-- in BEGIN IMMEDIATE/COMMIT and rolls back on every guard failure.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE exchange_m8_guard (
  label TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_capacity_lots AS
SELECT
  id, supplier_actor_id, idempotency_key, payload_hash, resource_asset_id, verification_run_id,
  start_at, end_at,
  'GPU' AS rate_unit_code,
  parallel_units AS rate_units,
  capacity_gpu_seconds AS capacity_base_units,
  parallel_units,
  capacity_gpu_seconds,
  interruptibility, status,
  1 AS accounting_schema_version,
  version, created_at, updated_at
FROM exchange_capacity_lots;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_listing_versions AS
SELECT
  id, listing_id, version_number, supplier_actor_id, idempotency_key, payload_hash, capacity_lot_id,
  'GPU' AS rate_unit_code,
  unit_price_cents * 10000 AS unit_price_micros,
  unit_price_cents,
  currency, pricing_unit_code,
  min_parallel_units AS min_rate_units,
  max_parallel_units AS max_rate_units,
  min_parallel_units, max_parallel_units, min_duration_minutes,
  tax_included, energy_included, network_included, scope_note, sla_json, delivery_form,
  valid_from, valid_until, status,
  1 AS accounting_schema_version,
  created_at
FROM exchange_listing_versions;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_orders AS
SELECT
  id, buyer_actor_id, supplier_actor_id, idempotency_key, payload_hash, listing_version_id,
  'GPU' AS rate_unit_code,
  parallel_units AS rate_units,
  parallel_units,
  start_at, end_at,
  capacity_gpu_seconds AS capacity_base_units,
  capacity_gpu_seconds,
  unit_price_cents * 10000 AS unit_price_micros,
  unit_price_cents,
  total_amount_cents, currency, status, hold_expires_at,
  1 AS accounting_schema_version,
  version, created_at, updated_at
FROM exchange_orders;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_reservations AS
SELECT
  id, order_id, capacity_lot_id,
  'GPU' AS rate_unit_code,
  parallel_units AS rate_units,
  parallel_units,
  start_at, end_at,
  capacity_gpu_seconds AS capacity_base_units,
  capacity_gpu_seconds,
  state, hold_expires_at,
  1 AS accounting_schema_version,
  version, created_at, updated_at
FROM exchange_reservations;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_capacity_transfers AS
SELECT
  id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
  'GPU' AS rate_unit_code,
  capacity_gpu_seconds AS capacity_base_units,
  capacity_gpu_seconds,
  reason, occurred_at,
  1 AS accounting_schema_version
FROM exchange_capacity_transfers;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_metering_sessions AS
SELECT
  ms.id, ms.order_id, ms.payment_event_id, ms.delivery_task_id, ms.reservation_id, ms.environment, ms.status,
  ms.scheduled_start_at, ms.scheduled_end_at, ms.actual_start_at, ms.finalized_at,
  'GPU' AS rate_unit_code,
  r.parallel_units AS reserved_rate_units,
  ms.scheduled_gpu_seconds AS scheduled_capacity_base_units,
  ms.available_gpu_seconds AS available_capacity_base_units,
  ms.unavailable_gpu_seconds AS unavailable_capacity_base_units,
  ms.unproven_gpu_seconds AS unproven_capacity_base_units,
  ms.scheduled_gpu_seconds, ms.available_gpu_seconds, ms.unavailable_gpu_seconds, ms.unproven_gpu_seconds,
  ms.availability_ppm,
  1 AS accounting_schema_version,
  ms.version, ms.created_at, ms.updated_at
FROM exchange_metering_sessions ms
JOIN exchange_reservations r ON r.id = ms.reservation_id;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_service_facts AS
SELECT
  id, metering_session_id, order_id, fact_type, environment, effective_start_at, effective_end_at,
  'GPU' AS rate_unit_code,
  available_gpu_seconds AS available_capacity_base_units,
  available_gpu_seconds,
  evidence_digest,
  1 AS accounting_schema_version,
  created_at
FROM exchange_service_facts;
--> statement-breakpoint

CREATE TABLE exchange_m8_shadow_metering_finals AS
SELECT
  id, metering_session_id, order_id,
  'GPU' AS rate_unit_code,
  scheduled_gpu_seconds AS scheduled_capacity_base_units,
  available_gpu_seconds AS available_capacity_base_units,
  unavailable_gpu_seconds AS unavailable_capacity_base_units,
  unproven_gpu_seconds AS unproven_capacity_base_units,
  scheduled_gpu_seconds, available_gpu_seconds, unavailable_gpu_seconds, unproven_gpu_seconds,
  availability_ppm, gross_amount_cents, delivered_amount_cents, base_credit_cents,
  evidence_digest, finalized_at,
  1 AS accounting_schema_version
FROM exchange_metering_finals;
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'capacity_lots_backfill', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_m8_shadow_capacity_lots
  WHERE capacity_base_units <> rate_units * (unixepoch(end_at) - unixepoch(start_at))
    OR capacity_gpu_seconds <> capacity_base_units OR parallel_units <> rate_units
) THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'listing_versions_backfill', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_m8_shadow_listing_versions
  WHERE typeof(unit_price_micros) <> 'integer'
    OR unit_price_micros <> unit_price_cents * 10000
    OR pricing_unit_code <> 'GPU_HOUR'
    OR min_parallel_units <> min_rate_units OR max_parallel_units <> max_rate_units
) THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'orders_backfill', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_m8_shadow_orders
  WHERE typeof(unit_price_micros) <> 'integer'
    OR capacity_base_units <> rate_units * (unixepoch(end_at) - unixepoch(start_at))
    OR capacity_gpu_seconds <> capacity_base_units OR parallel_units <> rate_units
) THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'reservations_backfill', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_m8_shadow_reservations
  WHERE capacity_base_units <> rate_units * (unixepoch(end_at) - unixepoch(start_at))
    OR capacity_gpu_seconds <> capacity_base_units OR parallel_units <> rate_units
) THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'metering_sessions_backfill', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_m8_shadow_metering_sessions
  WHERE scheduled_capacity_base_units <> reserved_rate_units * (unixepoch(scheduled_end_at) - unixepoch(scheduled_start_at))
    OR scheduled_gpu_seconds <> scheduled_capacity_base_units
    OR available_gpu_seconds <> available_capacity_base_units
    OR unavailable_gpu_seconds <> unavailable_capacity_base_units
    OR unproven_gpu_seconds <> unproven_capacity_base_units
) THEN 1 ELSE 0 END;
--> statement-breakpoint

DROP TABLE exchange_metering_finals;
--> statement-breakpoint
DROP TABLE exchange_service_facts;
--> statement-breakpoint
DROP TABLE exchange_metering_sessions;
--> statement-breakpoint
DROP TABLE exchange_capacity_transfers;
--> statement-breakpoint
DROP TABLE exchange_reservations;
--> statement-breakpoint
DROP TABLE exchange_orders;
--> statement-breakpoint
DROP TABLE exchange_listing_versions;
--> statement-breakpoint
DROP TABLE exchange_capacity_lots;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_capacity_lots (
  id TEXT PRIMARY KEY,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resource_asset_id TEXT NOT NULL,
  verification_run_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  rate_units INTEGER NOT NULL CHECK (rate_units > 0),
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  parallel_units INTEGER CHECK (parallel_units IS NULL OR parallel_units > 0),
  capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
  interruptibility TEXT NOT NULL CHECK (interruptibility IN ('NON_INTERRUPTIBLE', 'INTERRUPTIBLE')),
  status TEXT NOT NULL CHECK (status IN ('READY', 'LISTED', 'SUSPENDED', 'EXPIRED', 'WITHDRAWN')),
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (supplier_actor_id, idempotency_key),
  FOREIGN KEY (resource_asset_id) REFERENCES exchange_resource_assets(id),
  FOREIGN KEY (verification_run_id) REFERENCES exchange_verification_runs(id),
  CHECK (
    length(start_at) = 24
    AND start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(start_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', start_at) = start_at
  ),
  CHECK (
    length(end_at) = 24
    AND end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(end_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', end_at) = end_at
  ),
  CHECK (unixepoch(end_at) > unixepoch(start_at)),
  CHECK (capacity_base_units = rate_units * (unixepoch(end_at) - unixepoch(start_at))),
  CHECK (
    (rate_unit_code = 'GPU' AND parallel_units = rate_units AND capacity_gpu_seconds = capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_listing_versions (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  capacity_lot_id TEXT NOT NULL,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR')),
  min_rate_units INTEGER NOT NULL CHECK (min_rate_units > 0),
  max_rate_units INTEGER NOT NULL CHECK (max_rate_units >= min_rate_units),
  min_parallel_units INTEGER CHECK (min_parallel_units IS NULL OR min_parallel_units > 0),
  max_parallel_units INTEGER CHECK (max_parallel_units IS NULL OR max_parallel_units > 0),
  min_duration_minutes INTEGER NOT NULL CHECK (min_duration_minutes > 0),
  tax_included INTEGER NOT NULL CHECK (tax_included IN (0, 1)),
  energy_included INTEGER NOT NULL CHECK (energy_included IN (0, 1)),
  network_included INTEGER NOT NULL CHECK (network_included IN (0, 1)),
  scope_note TEXT NOT NULL,
  sla_json TEXT NOT NULL,
  delivery_form TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'EXPIRED')),
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  created_at TEXT NOT NULL,
  UNIQUE (listing_id, version_number),
  UNIQUE (supplier_actor_id, idempotency_key),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  CHECK (valid_until > valid_from),
  CHECK (
    (rate_unit_code = 'GPU' AND pricing_unit_code = 'GPU_HOUR'
      AND unit_price_cents IS NOT NULL AND unit_price_micros = unit_price_cents * 10000
      AND min_parallel_units = min_rate_units AND max_parallel_units = max_rate_units)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND pricing_unit_code = 'MODEL_INSTANCE_HOUR'
      AND unit_price_cents IS NULL AND min_parallel_units IS NULL AND max_parallel_units IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_orders (
  id TEXT PRIMARY KEY,
  buyer_actor_id TEXT NOT NULL,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  listing_version_id TEXT NOT NULL,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  rate_units INTEGER NOT NULL CHECK (rate_units > 0),
  parallel_units INTEGER CHECK (parallel_units IS NULL OR parallel_units > 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
  unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0),
  unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
  total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  status TEXT NOT NULL CHECK (status IN ('PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED')),
  hold_expires_at TEXT NOT NULL,
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (buyer_actor_id, idempotency_key),
  FOREIGN KEY (listing_version_id) REFERENCES exchange_listing_versions(id),
  CHECK (
    length(start_at) = 24
    AND start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(start_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', start_at) = start_at
  ),
  CHECK (
    length(end_at) = 24
    AND end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(end_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', end_at) = end_at
  ),
  CHECK (unixepoch(end_at) > unixepoch(start_at)),
  CHECK (capacity_base_units = rate_units * (unixepoch(end_at) - unixepoch(start_at))),
  CHECK (
    (rate_unit_code = 'GPU' AND parallel_units = rate_units
      AND capacity_gpu_seconds = capacity_base_units
      AND unit_price_cents IS NOT NULL AND unit_price_micros = unit_price_cents * 10000)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND parallel_units IS NULL
      AND capacity_gpu_seconds IS NULL AND unit_price_cents IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  capacity_lot_id TEXT NOT NULL,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  rate_units INTEGER NOT NULL CHECK (rate_units > 0),
  parallel_units INTEGER CHECK (parallel_units IS NULL OR parallel_units > 0),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
  state TEXT NOT NULL CHECK (state IN ('HELD', 'SUPPLIER_CONFIRMED', 'COMMITTED', 'IN_SERVICE', 'FULFILLED', 'EXPIRED', 'RELEASED', 'FAILED')),
  hold_expires_at TEXT NOT NULL,
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  CHECK (
    length(start_at) = 24
    AND start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(start_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', start_at) = start_at
  ),
  CHECK (
    length(end_at) = 24
    AND end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(end_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', end_at) = end_at
  ),
  CHECK (unixepoch(end_at) > unixepoch(start_at)),
  CHECK (capacity_base_units = rate_units * (unixepoch(end_at) - unixepoch(start_at))),
  CHECK (
    (rate_unit_code = 'GPU' AND parallel_units = rate_units AND capacity_gpu_seconds = capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_capacity_transfers (
  id TEXT PRIMARY KEY,
  capacity_lot_id TEXT NOT NULL,
  order_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_bucket TEXT NOT NULL CHECK (from_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN')),
  to_bucket TEXT NOT NULL CHECK (to_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN')),
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  CHECK (from_bucket <> to_bucket),
  CHECK (
    (rate_unit_code = 'GPU' AND capacity_gpu_seconds = capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND capacity_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_metering_sessions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  payment_event_id TEXT NOT NULL UNIQUE,
  delivery_task_id TEXT NOT NULL UNIQUE,
  reservation_id TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment = 'TEST'),
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED', 'ACTIVE', 'FINAL')),
  scheduled_start_at TEXT NOT NULL,
  scheduled_end_at TEXT NOT NULL,
  actual_start_at TEXT,
  finalized_at TEXT,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  reserved_rate_units INTEGER NOT NULL CHECK (reserved_rate_units > 0),
  scheduled_capacity_base_units INTEGER NOT NULL CHECK (scheduled_capacity_base_units > 0),
  available_capacity_base_units INTEGER NOT NULL DEFAULT 0 CHECK (available_capacity_base_units >= 0),
  unavailable_capacity_base_units INTEGER NOT NULL DEFAULT 0 CHECK (unavailable_capacity_base_units >= 0),
  unproven_capacity_base_units INTEGER NOT NULL CHECK (unproven_capacity_base_units >= 0),
  scheduled_gpu_seconds INTEGER CHECK (scheduled_gpu_seconds IS NULL OR scheduled_gpu_seconds > 0),
  available_gpu_seconds INTEGER CHECK (available_gpu_seconds IS NULL OR available_gpu_seconds >= 0),
  unavailable_gpu_seconds INTEGER CHECK (unavailable_gpu_seconds IS NULL OR unavailable_gpu_seconds >= 0),
  unproven_gpu_seconds INTEGER CHECK (unproven_gpu_seconds IS NULL OR unproven_gpu_seconds >= 0),
  availability_ppm INTEGER CHECK (availability_ppm BETWEEN 0 AND 1000000),
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (payment_event_id) REFERENCES exchange_payment_events(id),
  FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id),
  FOREIGN KEY (reservation_id) REFERENCES exchange_reservations(id),
  CHECK (
    length(scheduled_start_at) = 24
    AND scheduled_start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(scheduled_start_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', scheduled_start_at) = scheduled_start_at
  ),
  CHECK (
    length(scheduled_end_at) = 24
    AND scheduled_end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
    AND unixepoch(scheduled_end_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%S.000Z', scheduled_end_at) = scheduled_end_at
  ),
  CHECK (unixepoch(scheduled_end_at) > unixepoch(scheduled_start_at)),
  CHECK (scheduled_capacity_base_units = reserved_rate_units * (unixepoch(scheduled_end_at) - unixepoch(scheduled_start_at))),
  CHECK (available_capacity_base_units + unavailable_capacity_base_units <= scheduled_capacity_base_units),
  CHECK (unproven_capacity_base_units <= scheduled_capacity_base_units),
  CHECK (
    (rate_unit_code = 'GPU'
      AND scheduled_gpu_seconds = scheduled_capacity_base_units
      AND available_gpu_seconds = available_capacity_base_units
      AND unavailable_gpu_seconds = unavailable_capacity_base_units
      AND unproven_gpu_seconds = unproven_capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE'
      AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
      AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_service_facts (
  id TEXT PRIMARY KEY,
  metering_session_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('TEST_SERVICE_STARTED', 'TEST_WINDOW_FINALIZED')),
  environment TEXT NOT NULL CHECK (environment = 'TEST'),
  effective_start_at TEXT NOT NULL,
  effective_end_at TEXT,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  available_capacity_base_units INTEGER NOT NULL CHECK (available_capacity_base_units >= 0),
  available_gpu_seconds INTEGER CHECK (available_gpu_seconds IS NULL OR available_gpu_seconds >= 0),
  evidence_digest TEXT NOT NULL,
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  created_at TEXT NOT NULL,
  UNIQUE (metering_session_id, fact_type),
  FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  CHECK (
    (rate_unit_code = 'GPU' AND available_gpu_seconds = available_capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND available_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS exchange_metering_finals (
  id TEXT PRIMARY KEY,
  metering_session_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE')),
  scheduled_capacity_base_units INTEGER NOT NULL CHECK (scheduled_capacity_base_units > 0),
  available_capacity_base_units INTEGER NOT NULL CHECK (available_capacity_base_units >= 0),
  unavailable_capacity_base_units INTEGER NOT NULL CHECK (unavailable_capacity_base_units >= 0),
  unproven_capacity_base_units INTEGER NOT NULL CHECK (unproven_capacity_base_units >= 0),
  scheduled_gpu_seconds INTEGER CHECK (scheduled_gpu_seconds IS NULL OR scheduled_gpu_seconds > 0),
  available_gpu_seconds INTEGER CHECK (available_gpu_seconds IS NULL OR available_gpu_seconds >= 0),
  unavailable_gpu_seconds INTEGER CHECK (unavailable_gpu_seconds IS NULL OR unavailable_gpu_seconds >= 0),
  unproven_gpu_seconds INTEGER CHECK (unproven_gpu_seconds IS NULL OR unproven_gpu_seconds >= 0),
  availability_ppm INTEGER NOT NULL CHECK (availability_ppm BETWEEN 0 AND 1000000),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
  delivered_amount_cents INTEGER NOT NULL CHECK (delivered_amount_cents >= 0),
  base_credit_cents INTEGER NOT NULL CHECK (base_credit_cents >= 0),
  evidence_digest TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  accounting_schema_version INTEGER NOT NULL DEFAULT 2 CHECK (accounting_schema_version IN (1, 2)),
  FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  CHECK (available_capacity_base_units + unavailable_capacity_base_units = scheduled_capacity_base_units),
  CHECK (unproven_capacity_base_units <= unavailable_capacity_base_units),
  CHECK (delivered_amount_cents + base_credit_cents = gross_amount_cents),
  CHECK (
    (rate_unit_code = 'GPU'
      AND scheduled_gpu_seconds = scheduled_capacity_base_units
      AND available_gpu_seconds = available_capacity_base_units
      AND unavailable_gpu_seconds = unavailable_capacity_base_units
      AND unproven_gpu_seconds = unproven_capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE'
      AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
      AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

INSERT INTO exchange_capacity_lots SELECT * FROM exchange_m8_shadow_capacity_lots;
--> statement-breakpoint
INSERT INTO exchange_listing_versions SELECT * FROM exchange_m8_shadow_listing_versions;
--> statement-breakpoint
INSERT INTO exchange_orders SELECT * FROM exchange_m8_shadow_orders;
--> statement-breakpoint
INSERT INTO exchange_reservations SELECT * FROM exchange_m8_shadow_reservations;
--> statement-breakpoint
INSERT INTO exchange_capacity_transfers SELECT * FROM exchange_m8_shadow_capacity_transfers;
--> statement-breakpoint
INSERT INTO exchange_metering_sessions SELECT * FROM exchange_m8_shadow_metering_sessions;
--> statement-breakpoint
INSERT INTO exchange_service_facts SELECT * FROM exchange_m8_shadow_service_facts;
--> statement-breakpoint
INSERT INTO exchange_metering_finals SELECT * FROM exchange_m8_shadow_metering_finals;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS exchange_capacity_lots_supplier_idx
  ON exchange_capacity_lots(supplier_actor_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_capacity_lots_window_idx
  ON exchange_capacity_lots(resource_asset_id, start_at, end_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_listing_versions_market_idx
  ON exchange_listing_versions(status, valid_until, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_orders_buyer_idx
  ON exchange_orders(buyer_actor_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_orders_supplier_idx
  ON exchange_orders(supplier_actor_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_reservations_window_idx
  ON exchange_reservations(capacity_lot_id, start_at, end_at, state, hold_expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exchange_capacity_transfers_lot_idx
  ON exchange_capacity_transfers(capacity_lot_id, occurred_at ASC);
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'capacity_lots_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_capacity_lots EXCEPT SELECT * FROM exchange_capacity_lots)
  AND NOT EXISTS (SELECT * FROM exchange_capacity_lots EXCEPT SELECT * FROM exchange_m8_shadow_capacity_lots)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'listing_versions_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_listing_versions EXCEPT SELECT * FROM exchange_listing_versions)
  AND NOT EXISTS (SELECT * FROM exchange_listing_versions EXCEPT SELECT * FROM exchange_m8_shadow_listing_versions)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'orders_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_orders EXCEPT SELECT * FROM exchange_orders)
  AND NOT EXISTS (SELECT * FROM exchange_orders EXCEPT SELECT * FROM exchange_m8_shadow_orders)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'reservations_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_reservations EXCEPT SELECT * FROM exchange_reservations)
  AND NOT EXISTS (SELECT * FROM exchange_reservations EXCEPT SELECT * FROM exchange_m8_shadow_reservations)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'capacity_transfers_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_capacity_transfers EXCEPT SELECT * FROM exchange_capacity_transfers)
  AND NOT EXISTS (SELECT * FROM exchange_capacity_transfers EXCEPT SELECT * FROM exchange_m8_shadow_capacity_transfers)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'metering_sessions_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_metering_sessions EXCEPT SELECT * FROM exchange_metering_sessions)
  AND NOT EXISTS (SELECT * FROM exchange_metering_sessions EXCEPT SELECT * FROM exchange_m8_shadow_metering_sessions)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'service_facts_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_service_facts EXCEPT SELECT * FROM exchange_service_facts)
  AND NOT EXISTS (SELECT * FROM exchange_service_facts EXCEPT SELECT * FROM exchange_m8_shadow_service_facts)
THEN 1 ELSE 0 END;
--> statement-breakpoint
INSERT INTO exchange_m8_guard(label, ok)
SELECT 'metering_finals_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m8_shadow_metering_finals EXCEPT SELECT * FROM exchange_metering_finals)
  AND NOT EXISTS (SELECT * FROM exchange_metering_finals EXCEPT SELECT * FROM exchange_m8_shadow_metering_finals)
THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m8_guard(label, ok)
SELECT 'foreign_key_check', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
--> statement-breakpoint

DROP TABLE exchange_m8_shadow_metering_finals;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_service_facts;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_metering_sessions;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_capacity_transfers;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_reservations;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_orders;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_listing_versions;
--> statement-breakpoint
DROP TABLE exchange_m8_shadow_capacity_lots;
--> statement-breakpoint
DROP TABLE exchange_m8_guard;
--> statement-breakpoint

INSERT INTO exchange_schema_migrations(version, applied_at)
VALUES (8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint

PRAGMA defer_foreign_keys = OFF;
--> statement-breakpoint
