-- M8: terminal whole-lot withdrawal, two-leg swap quotes, and TEST-only direct referral estimates.
-- The migration runner supplies the atomic transaction/batch boundary.
PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE exchange_m11_guard (
  label TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
--> statement-breakpoint

CREATE TABLE exchange_m11_shadow_capacity_transfers AS
SELECT
  id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
  rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at,
  accounting_schema_version
FROM exchange_capacity_transfers;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'capacity_transfers_preflight', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_m11_shadow_capacity_transfers
  WHERE from_bucket = 'WITHDRAWN' OR to_bucket = 'WITHDRAWN'
    OR NOT (
      (rate_unit_code = 'GPU' AND capacity_gpu_seconds = capacity_base_units)
      OR (rate_unit_code <> 'GPU' AND capacity_gpu_seconds IS NULL)
    )
) THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'delivery_lock_transfer_links', CASE WHEN NOT EXISTS (
  SELECT 1 FROM exchange_delivery_tasks delivery
  LEFT JOIN exchange_m11_shadow_capacity_transfers transfer
    ON transfer.id = delivery.lock_transfer_id
  WHERE transfer.id IS NULL
) THEN 1 ELSE 0 END;
--> statement-breakpoint

DROP TABLE exchange_capacity_transfers;
--> statement-breakpoint

CREATE TABLE exchange_capacity_transfers (
  id TEXT PRIMARY KEY,
  capacity_lot_id TEXT NOT NULL,
  order_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  from_bucket TEXT NOT NULL CHECK (from_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN')),
  to_bucket TEXT NOT NULL CHECK (to_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN', 'WITHDRAWN')),
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  CHECK (from_bucket <> to_bucket),
  CHECK (from_bucket <> 'WITHDRAWN'),
  CHECK (to_bucket <> 'WITHDRAWN' OR (from_bucket = 'AVAILABLE' AND order_id IS NULL AND reason = 'CAPACITY_LOT_WITHDRAWN')),
  CHECK (
    (rate_unit_code = 'GPU' AND capacity_gpu_seconds = capacity_base_units)
    OR (rate_unit_code = 'MODEL_INSTANCE' AND capacity_gpu_seconds IS NULL)
    OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR' AND capacity_gpu_seconds IS NULL)
    OR (rate_unit_code = 'GIB_STORAGE' AND capacity_gpu_seconds IS NULL)
    OR (rate_unit_code = 'RACK' AND capacity_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

INSERT INTO exchange_capacity_transfers (
  id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
  rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at,
  accounting_schema_version
)
SELECT
  id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
  rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at,
  accounting_schema_version
FROM exchange_m11_shadow_capacity_transfers;
--> statement-breakpoint

CREATE INDEX exchange_capacity_transfers_lot_idx
  ON exchange_capacity_transfers(capacity_lot_id, occurred_at ASC);
--> statement-breakpoint

CREATE TRIGGER exchange_capacity_transfers_immutable_update
  BEFORE UPDATE ON exchange_capacity_transfers
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_TRANSFER_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TRIGGER exchange_capacity_transfers_immutable_delete
  BEFORE DELETE ON exchange_capacity_transfers
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_TRANSFER_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TRIGGER exchange_listing_versions_immutable_update
  BEFORE UPDATE ON exchange_listing_versions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_LISTING_VERSION_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TRIGGER exchange_listing_versions_immutable_delete
  BEFORE DELETE ON exchange_listing_versions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_LISTING_VERSION_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TABLE exchange_capacity_withdrawals (
  id TEXT PRIMARY KEY,
  capacity_lot_id TEXT NOT NULL UNIQUE,
  supplier_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  expected_lot_version INTEGER NOT NULL CHECK (expected_lot_version > 0),
  transfer_id TEXT NOT NULL UNIQUE,
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
  capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
  accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 4 AND 300),
  occurred_at TEXT NOT NULL,
  UNIQUE (supplier_actor_id, idempotency_key),
  FOREIGN KEY (capacity_lot_id) REFERENCES exchange_capacity_lots(id),
  FOREIGN KEY (transfer_id) REFERENCES exchange_capacity_transfers(id),
  CHECK (
    (rate_unit_code = 'GPU' AND capacity_gpu_seconds = capacity_base_units)
    OR (rate_unit_code <> 'GPU' AND capacity_gpu_seconds IS NULL)
  )
);
--> statement-breakpoint

CREATE TRIGGER exchange_capacity_withdrawals_fact_match
  BEFORE INSERT ON exchange_capacity_withdrawals
  WHEN NOT EXISTS (
    SELECT 1
    FROM exchange_capacity_lots lot
    JOIN exchange_capacity_transfers transfer ON transfer.id = NEW.transfer_id
    WHERE lot.id = NEW.capacity_lot_id
      AND lot.supplier_actor_id = NEW.supplier_actor_id
      AND lot.status = 'WITHDRAWN'
      AND lot.version = NEW.expected_lot_version + 1
      AND lot.rate_unit_code = NEW.rate_unit_code
      AND lot.capacity_base_units = NEW.capacity_base_units
      AND lot.accounting_schema_version = NEW.accounting_schema_version
      AND lot.capacity_gpu_seconds IS NEW.capacity_gpu_seconds
      AND transfer.capacity_lot_id = NEW.capacity_lot_id
      AND transfer.order_id IS NULL
      AND transfer.from_bucket = 'AVAILABLE'
      AND transfer.to_bucket = 'WITHDRAWN'
      AND transfer.rate_unit_code = NEW.rate_unit_code
      AND transfer.capacity_base_units = NEW.capacity_base_units
      AND transfer.accounting_schema_version = NEW.accounting_schema_version
      AND transfer.capacity_gpu_seconds IS NEW.capacity_gpu_seconds
      AND transfer.reason = 'CAPACITY_LOT_WITHDRAWN'
  )
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_WITHDRAWAL_FACT_MISMATCH'); END;
--> statement-breakpoint

CREATE TRIGGER exchange_capacity_withdrawals_immutable_update
  BEFORE UPDATE ON exchange_capacity_withdrawals
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_WITHDRAWAL_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TRIGGER exchange_capacity_withdrawals_immutable_delete
  BEFORE DELETE ON exchange_capacity_withdrawals
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_WITHDRAWAL_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TABLE exchange_swap_quotes (
  id TEXT PRIMARY KEY, initiator_actor_id TEXT NOT NULL, counterparty_actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  offered_value_cents INTEGER NOT NULL CHECK (offered_value_cents >= 0),
  wanted_value_cents INTEGER NOT NULL CHECK (wanted_value_cents >= 0),
  cash_adjustment_signed_cents INTEGER NOT NULL,
  cash_adjustment_amount_cents INTEGER NOT NULL CHECK (cash_adjustment_amount_cents >= 0),
  cash_adjustment_payer_actor_id TEXT, cash_adjustment_payee_actor_id TEXT,
  generated_at TEXT NOT NULL, expires_at TEXT NOT NULL, quote_digest TEXT NOT NULL UNIQUE,
  UNIQUE (initiator_actor_id, idempotency_key),
  CHECK (initiator_actor_id <> counterparty_actor_id),
  CHECK (cash_adjustment_signed_cents = wanted_value_cents - offered_value_cents),
  CHECK (cash_adjustment_amount_cents = abs(cash_adjustment_signed_cents)),
  CHECK (
    (cash_adjustment_signed_cents > 0 AND cash_adjustment_payer_actor_id = initiator_actor_id AND cash_adjustment_payee_actor_id = counterparty_actor_id)
    OR (cash_adjustment_signed_cents < 0 AND cash_adjustment_payer_actor_id = counterparty_actor_id AND cash_adjustment_payee_actor_id = initiator_actor_id)
    OR (cash_adjustment_signed_cents = 0 AND cash_adjustment_payer_actor_id IS NULL AND cash_adjustment_payee_actor_id IS NULL)
  ),
  CHECK (expires_at > generated_at)
);
--> statement-breakpoint
CREATE INDEX exchange_swap_quotes_participants_idx
  ON exchange_swap_quotes(initiator_actor_id, counterparty_actor_id, generated_at DESC);
--> statement-breakpoint
CREATE TABLE exchange_swap_quote_snapshots (
  id TEXT PRIMARY KEY, quote_id TEXT NOT NULL,
  leg_role TEXT NOT NULL CHECK (leg_role IN ('OFFERED', 'WANTED')),
  source_listing_version_id TEXT NOT NULL, listing_created_at TEXT NOT NULL, listing_valid_from TEXT NOT NULL,
  product_version_id TEXT NOT NULL, capacity_policy_id TEXT NOT NULL,
  product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'MODEL_INSTANCE', 'TOKEN_THROUGHPUT', 'NAS_STORAGE', 'RACK_SPACE')),
  rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
  fulfillment_model TEXT NOT NULL CHECK (fulfillment_model IN ('GPU_ALLOCATION', 'MODEL_INSTANCE_ALLOCATION', 'TOKEN_THROUGHPUT_RESERVATION', 'NAS_VOLUME_ALLOCATION', 'RACK_COLOCATION_ALLOCATION')),
  pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR', 'TIB_HOUR', 'RACK_HOUR')),
  rate_units INTEGER NOT NULL CHECK (rate_units > 0), start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0), capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
  unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0), price_basis_base_units INTEGER NOT NULL CHECK (price_basis_base_units > 0),
  value_cents INTEGER NOT NULL CHECK (value_cents >= 0), currency TEXT NOT NULL CHECK (currency = 'CNY'),
  generated_at TEXT NOT NULL, expires_at TEXT NOT NULL, snapshot_digest TEXT NOT NULL UNIQUE,
  UNIQUE (quote_id, leg_role),
  FOREIGN KEY (quote_id) REFERENCES exchange_swap_quotes(id),
  FOREIGN KEY (source_listing_version_id) REFERENCES exchange_listing_versions(id),
  FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
  FOREIGN KEY (capacity_policy_id) REFERENCES exchange_product_capacity_policies(id),
  CHECK (duration_seconds = unixepoch(end_at) - unixepoch(start_at)),
  CHECK (capacity_base_units = rate_units * duration_seconds),
  CHECK (expires_at > generated_at)
);
--> statement-breakpoint
CREATE TABLE exchange_swap_quote_status_events (
  id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUOTED', 'OPS_REVIEW', 'CANCELLED', 'EXPIRED')),
  version INTEGER NOT NULL CHECK (version > 0), reason TEXT NOT NULL CHECK (length(reason) BETWEEN 4 AND 500),
  occurred_at TEXT NOT NULL, UNIQUE (quote_id, version), UNIQUE (actor_id, idempotency_key),
  FOREIGN KEY (quote_id) REFERENCES exchange_swap_quotes(id)
);
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quote_status_events_transition
  BEFORE INSERT ON exchange_swap_quote_status_events
  WHEN NOT (
    (NEW.version = 1 AND NEW.status = 'QUOTED' AND NOT EXISTS (SELECT 1 FROM exchange_swap_quote_status_events WHERE quote_id = NEW.quote_id))
    OR (NEW.version > 1 AND EXISTS (
      SELECT 1 FROM exchange_swap_quote_status_events previous
      WHERE previous.quote_id = NEW.quote_id AND previous.version = NEW.version - 1
        AND ((previous.status = 'QUOTED' AND NEW.status IN ('OPS_REVIEW', 'CANCELLED', 'EXPIRED'))
          OR (previous.status = 'OPS_REVIEW' AND NEW.status IN ('CANCELLED', 'EXPIRED')))
        AND NOT EXISTS (SELECT 1 FROM exchange_swap_quote_status_events later WHERE later.quote_id = NEW.quote_id AND later.version >= NEW.version)
    ))
  )
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_STATUS_TRANSITION_INVALID'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quotes_immutable_update BEFORE UPDATE ON exchange_swap_quotes
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_QUOTE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quotes_immutable_delete BEFORE DELETE ON exchange_swap_quotes
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_QUOTE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quote_snapshots_immutable_update BEFORE UPDATE ON exchange_swap_quote_snapshots
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quote_snapshots_immutable_delete BEFORE DELETE ON exchange_swap_quote_snapshots
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_SNAPSHOT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quote_status_events_immutable_update BEFORE UPDATE ON exchange_swap_quote_status_events
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_STATUS_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_swap_quote_status_events_immutable_delete BEFORE DELETE ON exchange_swap_quote_status_events
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_STATUS_EVENT_IMMUTABLE'); END;
--> statement-breakpoint

CREATE TABLE exchange_referral_codes (
  id TEXT PRIMARY KEY, agent_actor_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 8 AND 40 AND code = upper(code) AND code NOT GLOB '*[^A-Z0-9-]*'),
  created_at TEXT NOT NULL, UNIQUE (agent_actor_id, idempotency_key)
);
--> statement-breakpoint
CREATE TABLE exchange_referral_decisions (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL CHECK (outcome IN ('NONE', 'INVALID', 'SELF_BUYER', 'SELF_SUPPLIER', 'APPLIED')),
  resolved_code_id TEXT,
  submitted_code_digest TEXT CHECK (submitted_code_digest IS NULL OR (length(submitted_code_digest) = 71 AND substr(submitted_code_digest, 1, 7) = 'sha256:')),
  decided_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (resolved_code_id) REFERENCES exchange_referral_codes(id),
  CHECK (
    (outcome = 'NONE' AND resolved_code_id IS NULL AND submitted_code_digest IS NULL)
    OR (outcome = 'INVALID' AND resolved_code_id IS NULL AND submitted_code_digest IS NOT NULL)
    OR (outcome IN ('SELF_BUYER', 'SELF_SUPPLIER', 'APPLIED') AND resolved_code_id IS NOT NULL AND submitted_code_digest IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE exchange_referral_attributions (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, decision_id TEXT NOT NULL UNIQUE,
  referral_code_id TEXT NOT NULL, agent_actor_id TEXT NOT NULL,
  buyer_actor_id TEXT NOT NULL, supplier_actor_id TEXT NOT NULL, attributed_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (decision_id) REFERENCES exchange_referral_decisions(id),
  FOREIGN KEY (referral_code_id) REFERENCES exchange_referral_codes(id),
  CHECK (agent_actor_id <> buyer_actor_id AND agent_actor_id <> supplier_actor_id)
);
--> statement-breakpoint
CREATE TRIGGER exchange_referral_attributions_fact_match
  BEFORE INSERT ON exchange_referral_attributions
  WHEN NOT EXISTS (
    SELECT 1 FROM exchange_referral_decisions decision
    JOIN exchange_referral_codes code ON code.id = decision.resolved_code_id
    JOIN exchange_orders orders ON orders.id = decision.order_id
    WHERE decision.id = NEW.decision_id AND decision.order_id = NEW.order_id
      AND decision.outcome = 'APPLIED' AND code.id = NEW.referral_code_id
      AND code.agent_actor_id = NEW.agent_actor_id
      AND orders.buyer_actor_id = NEW.buyer_actor_id
      AND orders.supplier_actor_id = NEW.supplier_actor_id
  ) BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_ATTRIBUTION_FACT_MISMATCH'); END;
--> statement-breakpoint
CREATE TABLE exchange_commission_accruals (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, settlement_id TEXT NOT NULL UNIQUE,
  attribution_id TEXT NOT NULL UNIQUE, agent_actor_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment = 'TEST'),
  record_kind TEXT NOT NULL CHECK (record_kind = 'ESTIMATE_ONLY'),
  commission_base_cents INTEGER NOT NULL CHECK (commission_base_cents >= 0),
  commission_rate_basis_points INTEGER NOT NULL CHECK (commission_rate_basis_points = 300),
  commission_estimate_cents INTEGER NOT NULL CHECK (commission_estimate_cents >= 0),
  funds_moved INTEGER NOT NULL CHECK (funds_moved = 0), created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
  FOREIGN KEY (settlement_id) REFERENCES exchange_settlements(id),
  FOREIGN KEY (attribution_id) REFERENCES exchange_referral_attributions(id),
  CHECK (commission_estimate_cents = (commission_base_cents * 3) / 100)
);
--> statement-breakpoint
CREATE TRIGGER exchange_commission_accruals_fact_match
  BEFORE INSERT ON exchange_commission_accruals
  WHEN NOT EXISTS (
    SELECT 1 FROM exchange_settlements settlement
    JOIN exchange_orders orders ON orders.id = settlement.order_id
    JOIN exchange_referral_attributions attribution ON attribution.order_id = orders.id
    WHERE settlement.id = NEW.settlement_id AND orders.id = NEW.order_id
      AND attribution.id = NEW.attribution_id AND attribution.agent_actor_id = NEW.agent_actor_id
      AND settlement.environment = 'TEST' AND settlement.gross_amount_cents = NEW.commission_base_cents
  ) BEGIN SELECT RAISE(ABORT, 'EXCHANGE_COMMISSION_ACCRUAL_FACT_MISMATCH'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_referral_codes_immutable_update BEFORE UPDATE ON exchange_referral_codes
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_CODE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_referral_codes_immutable_delete BEFORE DELETE ON exchange_referral_codes
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_CODE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_referral_decisions_immutable_update BEFORE UPDATE ON exchange_referral_decisions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_DECISION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_referral_decisions_immutable_delete BEFORE DELETE ON exchange_referral_decisions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_DECISION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_referral_attributions_immutable_update BEFORE UPDATE ON exchange_referral_attributions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_ATTRIBUTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_referral_attributions_immutable_delete BEFORE DELETE ON exchange_referral_attributions
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_ATTRIBUTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_commission_accruals_immutable_update BEFORE UPDATE ON exchange_commission_accruals
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_COMMISSION_ACCRUAL_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER exchange_commission_accruals_immutable_delete BEFORE DELETE ON exchange_commission_accruals
  BEGIN SELECT RAISE(ABORT, 'EXCHANGE_COMMISSION_ACCRUAL_IMMUTABLE'); END;
--> statement-breakpoint
INSERT INTO exchange_referral_decisions (
  id, order_id, outcome, resolved_code_id, submitted_code_digest, decided_at
) SELECT 'KAI-RD-BACKFILL-' || id, id, 'NONE', NULL, NULL, created_at
FROM exchange_orders;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'referral_decision_backfill', CASE WHEN
  (SELECT COUNT(*) FROM exchange_referral_decisions) = (SELECT COUNT(*) FROM exchange_orders)
  AND NOT EXISTS (SELECT 1 FROM exchange_orders orders LEFT JOIN exchange_referral_decisions decision
    ON decision.order_id = orders.id WHERE decision.id IS NULL)
THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'capacity_transfers_row_count', CASE WHEN
  (SELECT COUNT(*) FROM exchange_m11_shadow_capacity_transfers)
  = (SELECT COUNT(*) FROM exchange_capacity_transfers)
THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'capacity_transfers_accounting_sum', CASE WHEN
  COALESCE((SELECT SUM(capacity_base_units) FROM exchange_m11_shadow_capacity_transfers), 0)
  = COALESCE((SELECT SUM(capacity_base_units) FROM exchange_capacity_transfers), 0)
  AND COALESCE((SELECT SUM(capacity_gpu_seconds) FROM exchange_m11_shadow_capacity_transfers), 0)
  = COALESCE((SELECT SUM(capacity_gpu_seconds) FROM exchange_capacity_transfers), 0)
THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'capacity_transfers_roundtrip', CASE WHEN
  NOT EXISTS (SELECT * FROM exchange_m11_shadow_capacity_transfers EXCEPT SELECT * FROM exchange_capacity_transfers)
  AND NOT EXISTS (SELECT * FROM exchange_capacity_transfers EXCEPT SELECT * FROM exchange_m11_shadow_capacity_transfers)
THEN 1 ELSE 0 END;
--> statement-breakpoint

INSERT INTO exchange_m11_guard(label, ok)
SELECT 'foreign_key_check', CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
--> statement-breakpoint

DROP TABLE exchange_m11_shadow_capacity_transfers;
--> statement-breakpoint

DROP TABLE exchange_m11_guard;
--> statement-breakpoint

INSERT INTO exchange_schema_migrations(version, applied_at)
VALUES (11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint

PRAGMA defer_foreign_keys = OFF;
--> statement-breakpoint
