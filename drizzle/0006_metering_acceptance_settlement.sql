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
  scheduled_gpu_seconds INTEGER NOT NULL CHECK (scheduled_gpu_seconds > 0),
  available_gpu_seconds INTEGER NOT NULL DEFAULT 0 CHECK (available_gpu_seconds >= 0),
  unavailable_gpu_seconds INTEGER NOT NULL DEFAULT 0 CHECK (unavailable_gpu_seconds >= 0),
  unproven_gpu_seconds INTEGER NOT NULL CHECK (unproven_gpu_seconds >= 0),
  availability_ppm INTEGER CHECK (availability_ppm BETWEEN 0 AND 1000000),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (payment_event_id) REFERENCES exchange_payment_events(id),
  FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id),
  FOREIGN KEY (reservation_id) REFERENCES exchange_reservations(id),
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK (available_gpu_seconds + unavailable_gpu_seconds <= scheduled_gpu_seconds),
  CHECK (unproven_gpu_seconds <= scheduled_gpu_seconds)
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
  available_gpu_seconds INTEGER NOT NULL CHECK (available_gpu_seconds >= 0),
  evidence_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (metering_session_id, fact_type),
  FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_metering_finals (
  id TEXT PRIMARY KEY,
  metering_session_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL UNIQUE,
  scheduled_gpu_seconds INTEGER NOT NULL CHECK (scheduled_gpu_seconds > 0),
  available_gpu_seconds INTEGER NOT NULL CHECK (available_gpu_seconds >= 0),
  unavailable_gpu_seconds INTEGER NOT NULL CHECK (unavailable_gpu_seconds >= 0),
  unproven_gpu_seconds INTEGER NOT NULL CHECK (unproven_gpu_seconds >= 0),
  availability_ppm INTEGER NOT NULL CHECK (availability_ppm BETWEEN 0 AND 1000000),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
  delivered_amount_cents INTEGER NOT NULL CHECK (delivered_amount_cents >= 0),
  base_credit_cents INTEGER NOT NULL CHECK (base_credit_cents >= 0),
  evidence_digest TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  CHECK (available_gpu_seconds + unavailable_gpu_seconds = scheduled_gpu_seconds),
  CHECK (unproven_gpu_seconds <= unavailable_gpu_seconds),
  CHECK (delivered_amount_cents + base_credit_cents = gross_amount_cents)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_acceptances (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  metering_final_id TEXT NOT NULL UNIQUE,
  buyer_actor_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DISPUTED')),
  reason TEXT,
  evidence_digest TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (metering_final_id) REFERENCES exchange_metering_finals(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_settlements (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  metering_final_id TEXT NOT NULL UNIQUE,
  acceptance_id TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment = 'TEST'),
  status TEXT NOT NULL CHECK (status IN ('BLOCKED', 'ELIGIBLE', 'TEST_RECORDED')),
  gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
  base_credit_cents INTEGER NOT NULL CHECK (base_credit_cents >= 0),
  dispute_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (dispute_credit_cents >= 0),
  net_supplier_payable_cents INTEGER NOT NULL CHECK (net_supplier_payable_cents >= 0),
  funds_moved INTEGER NOT NULL DEFAULT 0 CHECK (funds_moved = 0),
  ledger_batch_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (metering_final_id) REFERENCES exchange_metering_finals(id),
  FOREIGN KEY (acceptance_id) REFERENCES exchange_acceptances(id),
  CHECK (gross_amount_cents = base_credit_cents + dispute_credit_cents + net_supplier_payable_cents)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_ledger_batches (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment = 'TEST'),
  entry_count INTEGER NOT NULL CHECK (entry_count > 0),
  debit_total_cents INTEGER NOT NULL CHECK (debit_total_cents >= 0),
  credit_total_cents INTEGER NOT NULL CHECK (credit_total_cents >= 0),
  funds_moved INTEGER NOT NULL DEFAULT 0 CHECK (funds_moved = 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (settlement_id) REFERENCES exchange_settlements(id),
  CHECK (debit_total_cents = credit_total_cents)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS exchange_ledger_entries (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  account_code TEXT NOT NULL CHECK (account_code IN ('TEST_BUYER_SETTLEMENT_CLEARING', 'TEST_SUPPLIER_PAYABLE', 'TEST_BUYER_CREDIT')),
  side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES exchange_ledger_batches(id),
  FOREIGN KEY (settlement_id) REFERENCES exchange_settlements(id)
);
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_metering_sessions (
  id, order_id, payment_event_id, delivery_task_id, reservation_id, environment, status,
  scheduled_start_at, scheduled_end_at, actual_start_at, finalized_at,
  scheduled_gpu_seconds, available_gpu_seconds, unavailable_gpu_seconds, unproven_gpu_seconds,
  availability_ppm, version, created_at, updated_at
)
SELECT 'KAI-MS-BACKFILL-' || o.id, o.id, dt.payment_event_id, dt.id, r.id, 'TEST', 'SCHEDULED',
  o.start_at, o.end_at, NULL, NULL, o.capacity_gpu_seconds, 0, 0, o.capacity_gpu_seconds,
  NULL, 1, pi.updated_at, pi.updated_at
FROM exchange_orders o
JOIN exchange_payment_intents pi ON pi.order_id = o.id AND pi.status = 'CAPTURED' AND pi.environment = 'TEST'
JOIN exchange_delivery_tasks dt ON dt.order_id = o.id
JOIN exchange_reservations r ON r.order_id = o.id
WHERE NOT EXISTS (SELECT 1 FROM exchange_metering_sessions ms WHERE ms.order_id = o.id);
--> statement-breakpoint
INSERT OR IGNORE INTO exchange_schema_migrations (version, applied_at) VALUES (6, '2026-08-05T00:00:00.000Z');
