/**
 * KAI Cloud transaction-domain schema. Statements stay runtime-safe for both
 * D1 prepared execution and Node SQLite.
 */
export const EXCHANGE_SCHEMA_VERSION = 11;
export const EXCHANGE_SCHEMA_MIN_VERSION = 1;
// This follows the historical migration markers exactly. Version 5 was never
// emitted; treating an invented marker as applied would hide a corrupt history.
export const EXCHANGE_SCHEMA_VERSIONS = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11] as const;

export const exchangeSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS exchange_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_product_versions (
    id TEXT PRIMARY KEY,
    product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'TOKEN_USAGE', 'TOKEN_THROUGHPUT', 'MODEL_INSTANCE', 'NAS_STORAGE', 'RACK_SPACE', 'POWER_CAPACITY')),
    pricing_unit_code TEXT NOT NULL,
    display_name TEXT NOT NULL,
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    form_factor TEXT NOT NULL,
    specs_json TEXT NOT NULL,
    immutable_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_resource_assets (
    id TEXT PRIMARY KEY,
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    product_version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    region TEXT NOT NULL,
    delivery_form TEXT NOT NULL,
    total_parallel_units INTEGER NOT NULL CHECK (total_parallel_units > 0),
    interruptibility TEXT NOT NULL CHECK (interruptibility IN ('NON_INTERRUPTIBLE', 'INTERRUPTIBLE')),
    network_scope TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DECLARED', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'WITHDRAWN')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (supplier_actor_id, idempotency_key),
    FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id)
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_resource_assets_supplier_idx
    ON exchange_resource_assets(supplier_actor_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS exchange_verification_runs (
    id TEXT PRIMARY KEY,
    resource_asset_id TEXT NOT NULL,
    operator_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('MANUAL', 'CONNECTOR', 'CLOUD_API')),
    result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
    evidence_summary TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    valid_until TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (operator_actor_id, idempotency_key),
    FOREIGN KEY (resource_asset_id) REFERENCES exchange_resource_assets(id)
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_verification_runs_resource_idx
    ON exchange_verification_runs(resource_asset_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS exchange_capacity_lots (
    id TEXT PRIMARY KEY,
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    resource_asset_id TEXT NOT NULL,
    verification_run_id TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    rate_units INTEGER NOT NULL CHECK (rate_units > 0),
    capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
    parallel_units INTEGER CHECK (parallel_units IS NULL OR parallel_units > 0),
    capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
    interruptibility TEXT NOT NULL CHECK (interruptibility IN ('NON_INTERRUPTIBLE', 'INTERRUPTIBLE')),
    status TEXT NOT NULL CHECK (status IN ('READY', 'LISTED', 'SUSPENDED', 'EXPIRED', 'WITHDRAWN')),
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
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
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
      OR (rate_unit_code = 'RACK' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_capacity_lots_supplier_idx
    ON exchange_capacity_lots(supplier_actor_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS exchange_capacity_lots_window_idx
    ON exchange_capacity_lots(resource_asset_id, start_at, end_at)`,
  `CREATE TABLE IF NOT EXISTS exchange_listing_versions (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    capacity_lot_id TEXT NOT NULL,
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0),
    unit_price_cents INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents > 0),
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR', 'TIB_HOUR', 'RACK_HOUR')),
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
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
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
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR' AND pricing_unit_code = 'M_TOKEN_CAPACITY_HOUR'
        AND unit_price_cents IS NULL AND min_parallel_units IS NULL AND max_parallel_units IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE' AND pricing_unit_code = 'TIB_HOUR'
        AND unit_price_cents IS NULL AND min_parallel_units IS NULL AND max_parallel_units IS NULL)
      OR (rate_unit_code = 'RACK' AND pricing_unit_code = 'RACK_HOUR'
        AND unit_price_cents IS NULL AND min_parallel_units IS NULL AND max_parallel_units IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_listing_versions_market_idx
    ON exchange_listing_versions(status, valid_until, created_at DESC)`,
  `CREATE TRIGGER IF NOT EXISTS exchange_listing_versions_immutable_update
    BEFORE UPDATE ON exchange_listing_versions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_LISTING_VERSION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_listing_versions_immutable_delete
    BEFORE DELETE ON exchange_listing_versions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_LISTING_VERSION_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_orders (
    id TEXT PRIMARY KEY,
    buyer_actor_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    listing_version_id TEXT NOT NULL,
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
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
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
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
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR' AND parallel_units IS NULL
        AND capacity_gpu_seconds IS NULL AND unit_price_cents IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE' AND parallel_units IS NULL
        AND capacity_gpu_seconds IS NULL AND unit_price_cents IS NULL)
      OR (rate_unit_code = 'RACK' AND parallel_units IS NULL
        AND capacity_gpu_seconds IS NULL AND unit_price_cents IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_orders_buyer_idx
    ON exchange_orders(buyer_actor_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS exchange_orders_supplier_idx
    ON exchange_orders(supplier_actor_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS exchange_reservations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    capacity_lot_id TEXT NOT NULL,
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    rate_units INTEGER NOT NULL CHECK (rate_units > 0),
    parallel_units INTEGER CHECK (parallel_units IS NULL OR parallel_units > 0),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
    capacity_gpu_seconds INTEGER CHECK (capacity_gpu_seconds IS NULL OR capacity_gpu_seconds > 0),
    state TEXT NOT NULL CHECK (state IN ('HELD', 'SUPPLIER_CONFIRMED', 'COMMITTED', 'IN_SERVICE', 'FULFILLED', 'EXPIRED', 'RELEASED', 'FAILED')),
    hold_expires_at TEXT NOT NULL,
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
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
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
      OR (rate_unit_code = 'RACK' AND parallel_units IS NULL AND capacity_gpu_seconds IS NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_reservations_window_idx
    ON exchange_reservations(capacity_lot_id, start_at, end_at, state, hold_expires_at)`,
  `CREATE TABLE IF NOT EXISTS exchange_capacity_transfers (
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
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_capacity_transfers_lot_idx
    ON exchange_capacity_transfers(capacity_lot_id, occurred_at ASC)`,
  `CREATE TRIGGER IF NOT EXISTS exchange_capacity_transfers_immutable_update
    BEFORE UPDATE ON exchange_capacity_transfers
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_TRANSFER_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_capacity_transfers_immutable_delete
    BEFORE DELETE ON exchange_capacity_transfers
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_TRANSFER_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_capacity_withdrawals (
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
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_capacity_withdrawals_fact_match
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
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_WITHDRAWAL_FACT_MISMATCH'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_capacity_withdrawals_immutable_update
    BEFORE UPDATE ON exchange_capacity_withdrawals
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_WITHDRAWAL_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_capacity_withdrawals_immutable_delete
    BEFORE DELETE ON exchange_capacity_withdrawals
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_WITHDRAWAL_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_swap_quotes (
    id TEXT PRIMARY KEY,
    initiator_actor_id TEXT NOT NULL,
    counterparty_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    offered_value_cents INTEGER NOT NULL CHECK (offered_value_cents >= 0),
    wanted_value_cents INTEGER NOT NULL CHECK (wanted_value_cents >= 0),
    cash_adjustment_signed_cents INTEGER NOT NULL,
    cash_adjustment_amount_cents INTEGER NOT NULL CHECK (cash_adjustment_amount_cents >= 0),
    cash_adjustment_payer_actor_id TEXT,
    cash_adjustment_payee_actor_id TEXT,
    generated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    quote_digest TEXT NOT NULL UNIQUE,
    UNIQUE (initiator_actor_id, idempotency_key),
    CHECK (initiator_actor_id <> counterparty_actor_id),
    CHECK (cash_adjustment_signed_cents = wanted_value_cents - offered_value_cents),
    CHECK (cash_adjustment_amount_cents = abs(cash_adjustment_signed_cents)),
    CHECK (
      (cash_adjustment_signed_cents > 0
        AND cash_adjustment_payer_actor_id = initiator_actor_id
        AND cash_adjustment_payee_actor_id = counterparty_actor_id)
      OR (cash_adjustment_signed_cents < 0
        AND cash_adjustment_payer_actor_id = counterparty_actor_id
        AND cash_adjustment_payee_actor_id = initiator_actor_id)
      OR (cash_adjustment_signed_cents = 0
        AND cash_adjustment_payer_actor_id IS NULL AND cash_adjustment_payee_actor_id IS NULL)
    ),
    CHECK (expires_at > generated_at)
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_swap_quotes_participants_idx
    ON exchange_swap_quotes(initiator_actor_id, counterparty_actor_id, generated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS exchange_swap_quote_snapshots (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    leg_role TEXT NOT NULL CHECK (leg_role IN ('OFFERED', 'WANTED')),
    source_listing_version_id TEXT NOT NULL,
    listing_created_at TEXT NOT NULL,
    listing_valid_from TEXT NOT NULL,
    product_version_id TEXT NOT NULL,
    capacity_policy_id TEXT NOT NULL,
    product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'MODEL_INSTANCE', 'TOKEN_THROUGHPUT', 'NAS_STORAGE', 'RACK_SPACE')),
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    fulfillment_model TEXT NOT NULL CHECK (fulfillment_model IN ('GPU_ALLOCATION', 'MODEL_INSTANCE_ALLOCATION', 'TOKEN_THROUGHPUT_RESERVATION', 'NAS_VOLUME_ALLOCATION', 'RACK_COLOCATION_ALLOCATION')),
    pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR', 'TIB_HOUR', 'RACK_HOUR')),
    rate_units INTEGER NOT NULL CHECK (rate_units > 0),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
    capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
    unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0),
    price_basis_base_units INTEGER NOT NULL CHECK (price_basis_base_units > 0),
    value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    generated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    snapshot_digest TEXT NOT NULL UNIQUE,
    UNIQUE (quote_id, leg_role),
    FOREIGN KEY (quote_id) REFERENCES exchange_swap_quotes(id),
    FOREIGN KEY (source_listing_version_id) REFERENCES exchange_listing_versions(id),
    FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
    FOREIGN KEY (capacity_policy_id) REFERENCES exchange_product_capacity_policies(id),
    CHECK (duration_seconds = unixepoch(end_at) - unixepoch(start_at)),
    CHECK (capacity_base_units = rate_units * duration_seconds),
    CHECK (expires_at > generated_at)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_swap_quote_status_events (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('QUOTED', 'OPS_REVIEW', 'CANCELLED', 'EXPIRED')),
    version INTEGER NOT NULL CHECK (version > 0),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 4 AND 500),
    occurred_at TEXT NOT NULL,
    UNIQUE (quote_id, version),
    UNIQUE (actor_id, idempotency_key),
    FOREIGN KEY (quote_id) REFERENCES exchange_swap_quotes(id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quote_status_events_transition
    BEFORE INSERT ON exchange_swap_quote_status_events
    WHEN NOT (
      (NEW.version = 1 AND NEW.status = 'QUOTED'
        AND NOT EXISTS (SELECT 1 FROM exchange_swap_quote_status_events WHERE quote_id = NEW.quote_id))
      OR (NEW.version > 1 AND EXISTS (
        SELECT 1 FROM exchange_swap_quote_status_events previous
        WHERE previous.quote_id = NEW.quote_id AND previous.version = NEW.version - 1
          AND (
            (previous.status = 'QUOTED' AND NEW.status IN ('OPS_REVIEW', 'CANCELLED', 'EXPIRED'))
            OR (previous.status = 'OPS_REVIEW' AND NEW.status IN ('CANCELLED', 'EXPIRED'))
          )
          AND NOT EXISTS (SELECT 1 FROM exchange_swap_quote_status_events later
            WHERE later.quote_id = NEW.quote_id AND later.version >= NEW.version)
      ))
    )
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_STATUS_TRANSITION_INVALID'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quotes_immutable_update
    BEFORE UPDATE ON exchange_swap_quotes
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_QUOTE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quotes_immutable_delete
    BEFORE DELETE ON exchange_swap_quotes
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_QUOTE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quote_snapshots_immutable_update
    BEFORE UPDATE ON exchange_swap_quote_snapshots
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_SNAPSHOT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quote_snapshots_immutable_delete
    BEFORE DELETE ON exchange_swap_quote_snapshots
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_SNAPSHOT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quote_status_events_immutable_update
    BEFORE UPDATE ON exchange_swap_quote_status_events
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_STATUS_EVENT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_swap_quote_status_events_immutable_delete
    BEFORE DELETE ON exchange_swap_quote_status_events
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_SWAP_STATUS_EVENT_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_referral_codes (
    id TEXT PRIMARY KEY,
    agent_actor_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 8 AND 40 AND code = upper(code) AND code NOT GLOB '*[^A-Z0-9-]*'),
    created_at TEXT NOT NULL,
    UNIQUE (agent_actor_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_referral_decisions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
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
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_referral_attributions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    decision_id TEXT NOT NULL UNIQUE,
    referral_code_id TEXT NOT NULL,
    agent_actor_id TEXT NOT NULL,
    buyer_actor_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    attributed_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
    FOREIGN KEY (decision_id) REFERENCES exchange_referral_decisions(id),
    FOREIGN KEY (referral_code_id) REFERENCES exchange_referral_codes(id),
    CHECK (agent_actor_id <> buyer_actor_id AND agent_actor_id <> supplier_actor_id)
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_attributions_fact_match
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
    )
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_ATTRIBUTION_FACT_MISMATCH'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_commission_accruals (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    settlement_id TEXT NOT NULL UNIQUE,
    attribution_id TEXT NOT NULL UNIQUE,
    agent_actor_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment = 'TEST'),
    record_kind TEXT NOT NULL CHECK (record_kind = 'ESTIMATE_ONLY'),
    commission_base_cents INTEGER NOT NULL CHECK (commission_base_cents >= 0),
    commission_rate_basis_points INTEGER NOT NULL CHECK (commission_rate_basis_points = 300),
    commission_estimate_cents INTEGER NOT NULL CHECK (commission_estimate_cents >= 0),
    funds_moved INTEGER NOT NULL CHECK (funds_moved = 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
    FOREIGN KEY (settlement_id) REFERENCES exchange_settlements(id),
    FOREIGN KEY (attribution_id) REFERENCES exchange_referral_attributions(id),
    CHECK (commission_estimate_cents = (commission_base_cents * 3) / 100)
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_commission_accruals_fact_match
    BEFORE INSERT ON exchange_commission_accruals
    WHEN NOT EXISTS (
      SELECT 1 FROM exchange_settlements settlement
      JOIN exchange_orders orders ON orders.id = settlement.order_id
      JOIN exchange_referral_attributions attribution ON attribution.order_id = orders.id
      WHERE settlement.id = NEW.settlement_id AND orders.id = NEW.order_id
        AND attribution.id = NEW.attribution_id AND attribution.agent_actor_id = NEW.agent_actor_id
        AND settlement.environment = 'TEST' AND settlement.gross_amount_cents = NEW.commission_base_cents
    )
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_COMMISSION_ACCRUAL_FACT_MISMATCH'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_codes_immutable_update BEFORE UPDATE ON exchange_referral_codes
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_CODE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_codes_immutable_delete BEFORE DELETE ON exchange_referral_codes
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_CODE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_decisions_immutable_update BEFORE UPDATE ON exchange_referral_decisions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_DECISION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_decisions_immutable_delete BEFORE DELETE ON exchange_referral_decisions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_DECISION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_attributions_immutable_update BEFORE UPDATE ON exchange_referral_attributions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_ATTRIBUTION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_referral_attributions_immutable_delete BEFORE DELETE ON exchange_referral_attributions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_REFERRAL_ATTRIBUTION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_commission_accruals_immutable_update BEFORE UPDATE ON exchange_commission_accruals
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_COMMISSION_ACCRUAL_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_commission_accruals_immutable_delete BEFORE DELETE ON exchange_commission_accruals
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_COMMISSION_ACCRUAL_IMMUTABLE'); END`,
  `INSERT OR IGNORE INTO exchange_referral_decisions (
    id, order_id, outcome, resolved_code_id, submitted_code_digest, decided_at
  ) SELECT 'KAI-RD-BACKFILL-' || id, id, 'NONE', NULL, NULL, created_at FROM exchange_orders`,
  `CREATE TABLE IF NOT EXISTS exchange_command_receipts (
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    command_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (actor_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_domain_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_domain_events_entity_idx
    ON exchange_domain_events(entity_type, entity_id, occurred_at ASC)`,
  `CREATE TABLE IF NOT EXISTS exchange_order_lifecycle (
    order_id TEXT PRIMARY KEY,
    phase TEXT NOT NULL CHECK (phase IN ('AWAITING_SUPPLIER', 'AWAITING_PAYMENT', 'FULFILLING', 'AWAITING_ACCEPTANCE', 'COMPLETED', 'EXCEPTION')),
    state_reason TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_payment_intents (
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
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_payment_events (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS exchange_payment_events_capture_idx
    ON exchange_payment_events(provider, environment, provider_transaction_id)
    WHERE outcome = 'APPLIED'`,
  `CREATE TABLE IF NOT EXISTS exchange_delivery_tasks (
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
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_delivery_packages (
    id TEXT PRIMARY KEY,
    delivery_task_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    environment TEXT NOT NULL CHECK (environment = 'TEST'),
    status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'CLAIMED', 'EXPIRED', 'REVOKED')),
    public_profile_json TEXT NOT NULL,
    submission_evidence_digest TEXT NOT NULL,
    credential_expires_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (delivery_task_id, revision),
    FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id),
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS exchange_delivery_packages_active_idx
    ON exchange_delivery_packages(delivery_task_id)
    WHERE status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')`,
  `CREATE INDEX IF NOT EXISTS exchange_delivery_packages_ops_idx
    ON exchange_delivery_packages(status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS exchange_delivery_reviews (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL UNIQUE,
    delivery_task_id TEXT NOT NULL,
    reviewer_actor_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('PASS', 'REJECT')),
    verification_method TEXT NOT NULL CHECK (verification_method IN ('MANUAL', 'SIMULATED_TEST')),
    reason TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (package_id) REFERENCES exchange_delivery_packages(id),
    FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_delivery_claims (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    buyer_actor_id TEXT NOT NULL,
    claim_code_digest TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    FOREIGN KEY (package_id) REFERENCES exchange_delivery_packages(id),
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_connection_checks (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL,
    delivery_task_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    buyer_actor_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    adapter TEXT NOT NULL CHECK (adapter = 'SIMULATED_TEST'),
    status TEXT NOT NULL CHECK (status IN ('RUNNING', 'PASSED', 'FAILED')),
    diagnostic_code TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (package_id, attempt),
    FOREIGN KEY (package_id) REFERENCES exchange_delivery_packages(id),
    FOREIGN KEY (delivery_task_id) REFERENCES exchange_delivery_tasks(id),
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS exchange_connection_checks_running_idx
    ON exchange_connection_checks(package_id)
    WHERE status = 'RUNNING'`,
  `CREATE TABLE IF NOT EXISTS exchange_metering_sessions (
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
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
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
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
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
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR'
        AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
        AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE'
        AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
        AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
      OR (rate_unit_code = 'RACK'
        AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
        AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
    )
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_service_facts (
    id TEXT PRIMARY KEY,
    metering_session_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    fact_type TEXT NOT NULL CHECK (fact_type IN ('TEST_SERVICE_STARTED', 'TEST_WINDOW_FINALIZED')),
    environment TEXT NOT NULL CHECK (environment = 'TEST'),
    effective_start_at TEXT NOT NULL,
    effective_end_at TEXT,
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    available_capacity_base_units INTEGER NOT NULL CHECK (available_capacity_base_units >= 0),
    available_gpu_seconds INTEGER CHECK (available_gpu_seconds IS NULL OR available_gpu_seconds >= 0),
    evidence_digest TEXT NOT NULL,
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
    created_at TEXT NOT NULL,
    UNIQUE (metering_session_id, fact_type),
    FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
    CHECK (
      (rate_unit_code = 'GPU' AND available_gpu_seconds = available_capacity_base_units)
      OR (rate_unit_code = 'MODEL_INSTANCE' AND available_gpu_seconds IS NULL)
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR' AND available_gpu_seconds IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE' AND available_gpu_seconds IS NULL)
      OR (rate_unit_code = 'RACK' AND available_gpu_seconds IS NULL)
    )
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_metering_finals (
    id TEXT PRIMARY KEY,
    metering_session_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL UNIQUE,
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
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
    accounting_schema_version INTEGER NOT NULL DEFAULT 4 CHECK (accounting_schema_version IN (1, 2, 3, 4)),
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
      OR (rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR'
        AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
        AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
      OR (rate_unit_code = 'GIB_STORAGE'
        AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
        AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
      OR (rate_unit_code = 'RACK'
        AND scheduled_gpu_seconds IS NULL AND available_gpu_seconds IS NULL
        AND unavailable_gpu_seconds IS NULL AND unproven_gpu_seconds IS NULL)
    )
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_acceptances (
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
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_settlements (
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
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_ledger_batches (
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
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_ledger_entries (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    settlement_id TEXT NOT NULL,
    account_code TEXT NOT NULL CHECK (account_code IN ('TEST_BUYER_SETTLEMENT_CLEARING', 'TEST_SUPPLIER_PAYABLE', 'TEST_BUYER_CREDIT')),
    side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES exchange_ledger_batches(id),
    FOREIGN KEY (settlement_id) REFERENCES exchange_settlements(id)
  )`,
  `CREATE TABLE IF NOT EXISTS exchange_product_capacity_policies (
    id TEXT PRIMARY KEY,
    product_version_id TEXT UNIQUE,
    policy_key TEXT NOT NULL UNIQUE,
    product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'MODEL_INSTANCE', 'TOKEN_THROUGHPUT', 'NAS_STORAGE', 'RACK_SPACE')),
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    fulfillment_model TEXT NOT NULL CHECK (fulfillment_model IN ('GPU_ALLOCATION', 'MODEL_INSTANCE_ALLOCATION', 'TOKEN_THROUGHPUT_RESERVATION', 'NAS_VOLUME_ALLOCATION', 'RACK_COLOCATION_ALLOCATION')),
    pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR', 'TIB_HOUR', 'RACK_HOUR')),
    rate_unit_scale_numerator INTEGER NOT NULL CHECK (rate_unit_scale_numerator > 0),
    rate_unit_scale_denominator INTEGER NOT NULL CHECK (rate_unit_scale_denominator > 0),
    rate_unit_reference_code TEXT NOT NULL CHECK (rate_unit_reference_code IN ('GPU', 'MODEL_INSTANCE', 'M_TOKEN_PER_HOUR', 'TIB_STORAGE', 'RACK')),
    price_basis_base_units INTEGER NOT NULL CHECK (price_basis_base_units > 0),
    feature_status TEXT NOT NULL CHECK (feature_status IN ('ENABLED', 'DISABLED')),
    identity_spec_json TEXT NOT NULL,
    immutable_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
    CHECK (feature_status = 'DISABLED' OR product_version_id IS NOT NULL),
    CHECK (
      (product_code = 'GPU_COMPUTE' AND rate_unit_code = 'GPU'
        AND fulfillment_model = 'GPU_ALLOCATION' AND pricing_unit_code = 'GPU_HOUR'
        AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1
        AND rate_unit_reference_code = 'GPU' AND price_basis_base_units = 3600)
      OR
      (product_code = 'MODEL_INSTANCE' AND rate_unit_code = 'MODEL_INSTANCE'
        AND fulfillment_model = 'MODEL_INSTANCE_ALLOCATION' AND pricing_unit_code = 'MODEL_INSTANCE_HOUR'
        AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1
        AND rate_unit_reference_code = 'MODEL_INSTANCE' AND price_basis_base_units = 3600)
      OR
      (product_code = 'TOKEN_THROUGHPUT' AND rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR'
        AND fulfillment_model = 'TOKEN_THROUGHPUT_RESERVATION' AND pricing_unit_code = 'M_TOKEN_CAPACITY_HOUR'
        AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1000
        AND rate_unit_reference_code = 'M_TOKEN_PER_HOUR' AND price_basis_base_units = 3600000)
      OR
      (product_code = 'NAS_STORAGE' AND rate_unit_code = 'GIB_STORAGE'
        AND fulfillment_model = 'NAS_VOLUME_ALLOCATION' AND pricing_unit_code = 'TIB_HOUR'
        AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1024
        AND rate_unit_reference_code = 'TIB_STORAGE' AND price_basis_base_units = 3686400)
      OR
      (product_code = 'RACK_SPACE' AND rate_unit_code = 'RACK'
        AND fulfillment_model = 'RACK_COLOCATION_ALLOCATION' AND pricing_unit_code = 'RACK_HOUR'
        AND rate_unit_scale_numerator = 1 AND rate_unit_scale_denominator = 1
        AND rate_unit_reference_code = 'RACK' AND price_basis_base_units = 3600)
    )
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_product_versions_immutable_update
    BEFORE UPDATE ON exchange_product_versions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_PRODUCT_VERSION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_product_versions_immutable_delete
    BEFORE DELETE ON exchange_product_versions
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_PRODUCT_VERSION_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_product_capacity_policies_immutable_update
    BEFORE UPDATE ON exchange_product_capacity_policies
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_POLICY_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_product_capacity_policies_immutable_delete
    BEFORE DELETE ON exchange_product_capacity_policies
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_CAPACITY_POLICY_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_order_contract_snapshots (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE,
    listing_version_id TEXT NOT NULL,
    product_version_id TEXT NOT NULL,
    capacity_policy_id TEXT NOT NULL,
    product_code TEXT NOT NULL CHECK (product_code IN ('GPU_COMPUTE', 'MODEL_INSTANCE', 'TOKEN_THROUGHPUT', 'NAS_STORAGE', 'RACK_SPACE')),
    rate_unit_code TEXT NOT NULL CHECK (rate_unit_code IN ('GPU', 'MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')),
    fulfillment_model TEXT NOT NULL CHECK (fulfillment_model IN ('GPU_ALLOCATION', 'MODEL_INSTANCE_ALLOCATION', 'TOKEN_THROUGHPUT_RESERVATION', 'NAS_VOLUME_ALLOCATION', 'RACK_COLOCATION_ALLOCATION')),
    pricing_unit_code TEXT NOT NULL CHECK (pricing_unit_code IN ('GPU_HOUR', 'MODEL_INSTANCE_HOUR', 'M_TOKEN_CAPACITY_HOUR', 'TIB_HOUR', 'RACK_HOUR')),
    rate_units INTEGER NOT NULL CHECK (rate_units > 0),
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
    capacity_base_units INTEGER NOT NULL CHECK (capacity_base_units > 0),
    unit_price_micros INTEGER NOT NULL CHECK (unit_price_micros > 0),
    price_basis_base_units INTEGER NOT NULL CHECK (price_basis_base_units > 0),
    gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    product_identity_json TEXT NOT NULL,
    sla_json TEXT NOT NULL,
    evidence_policy_version TEXT NOT NULL,
    snapshot_digest TEXT NOT NULL CHECK (
      length(snapshot_digest) = 71 AND substr(snapshot_digest, 1, 7) = 'sha256:'
      AND substr(snapshot_digest, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
    FOREIGN KEY (listing_version_id) REFERENCES exchange_listing_versions(id),
    FOREIGN KEY (product_version_id) REFERENCES exchange_product_versions(id),
    FOREIGN KEY (capacity_policy_id) REFERENCES exchange_product_capacity_policies(id),
    CHECK (capacity_base_units = rate_units * duration_seconds)
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_order_contract_snapshots_immutable_update
    BEFORE UPDATE ON exchange_order_contract_snapshots
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_order_contract_snapshots_immutable_delete
    BEFORE DELETE ON exchange_order_contract_snapshots
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_order_contract_snapshots_terms_match
    BEFORE INSERT ON exchange_order_contract_snapshots
    WHEN NOT EXISTS (
      SELECT 1
      FROM exchange_orders o
      JOIN exchange_listing_versions lv ON lv.id = o.listing_version_id
      JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
      JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
      JOIN exchange_product_versions pv ON pv.id = ra.product_version_id
      JOIN exchange_product_capacity_policies p
        ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
      WHERE o.id = NEW.order_id
        AND lv.id = NEW.listing_version_id
        AND pv.id = NEW.product_version_id
        AND p.id = NEW.capacity_policy_id
        AND pv.product_code = p.product_code
        AND pv.pricing_unit_code = p.pricing_unit_code
        AND p.product_code = NEW.product_code
        AND p.rate_unit_code = NEW.rate_unit_code
        AND p.fulfillment_model = NEW.fulfillment_model
        AND p.pricing_unit_code = NEW.pricing_unit_code
        AND lot.rate_unit_code = p.rate_unit_code
        AND lv.rate_unit_code = p.rate_unit_code
        AND lv.pricing_unit_code = p.pricing_unit_code
        AND o.rate_unit_code = NEW.rate_unit_code
        AND o.rate_units = NEW.rate_units
        AND unixepoch(o.end_at) - unixepoch(o.start_at) = NEW.duration_seconds
        AND o.capacity_base_units = NEW.capacity_base_units
        AND lv.unit_price_micros = NEW.unit_price_micros
        AND p.price_basis_base_units = NEW.price_basis_base_units
        AND o.total_amount_cents = NEW.gross_amount_cents
        AND NEW.gross_amount_cents = (
          (NEW.unit_price_micros / (NEW.price_basis_base_units * 10000))
            * (NEW.capacity_base_units / (NEW.price_basis_base_units * 10000))
            * (NEW.price_basis_base_units * 10000)
          + (NEW.unit_price_micros / (NEW.price_basis_base_units * 10000))
            * (NEW.capacity_base_units % (NEW.price_basis_base_units * 10000))
          + (NEW.unit_price_micros % (NEW.price_basis_base_units * 10000))
            * (NEW.capacity_base_units / (NEW.price_basis_base_units * 10000))
          + (
              (NEW.unit_price_micros % (NEW.price_basis_base_units * 10000))
                * (NEW.capacity_base_units % (NEW.price_basis_base_units * 10000))
              + (NEW.price_basis_base_units * 10000) - 1
            ) / (NEW.price_basis_base_units * 10000)
        )
        AND o.currency = NEW.currency
        AND json(NEW.product_identity_json) = json(pv.specs_json)
        AND json(NEW.sla_json) = json(lv.sla_json)
        AND NEW.evidence_policy_version = p.immutable_hash
    )
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_ORDER_CONTRACT_TERMS_MISMATCH'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_meter_intervals (
    id TEXT PRIMARY KEY,
    metering_session_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    capacity_policy_id TEXT NOT NULL,
    sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
    interval_start_at TEXT NOT NULL,
    interval_end_at TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
    reserved_rate_units INTEGER NOT NULL CHECK (reserved_rate_units > 0),
    proven_rate_units INTEGER NOT NULL CHECK (proven_rate_units >= 0),
    scheduled_capacity_base_units INTEGER NOT NULL CHECK (scheduled_capacity_base_units > 0),
    available_capacity_base_units INTEGER NOT NULL CHECK (available_capacity_base_units >= 0),
    unavailable_capacity_base_units INTEGER NOT NULL CHECK (unavailable_capacity_base_units >= 0),
    unproven_capacity_base_units INTEGER NOT NULL CHECK (unproven_capacity_base_units >= 0),
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('PROVEN', 'UNAVAILABLE', 'UNPROVEN')),
    adapter TEXT NOT NULL CHECK (adapter IN ('TEST', 'CONNECTOR', 'CLOUD_API', 'KAI_GATEWAY')),
    evidence_digest TEXT NOT NULL CHECK (
      length(evidence_digest) = 71 AND substr(evidence_digest, 1, 7) = 'sha256:'
      AND substr(evidence_digest, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    UNIQUE (metering_session_id, sequence_number),
    FOREIGN KEY (metering_session_id) REFERENCES exchange_metering_sessions(id),
    FOREIGN KEY (order_id) REFERENCES exchange_orders(id),
    FOREIGN KEY (capacity_policy_id) REFERENCES exchange_product_capacity_policies(id),
    CHECK (
      length(interval_start_at) = 24
      AND interval_start_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
      AND unixepoch(interval_start_at) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%S.000Z', interval_start_at) = interval_start_at
    ),
    CHECK (
      length(interval_end_at) = 24
      AND interval_end_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
      AND unixepoch(interval_end_at) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%S.000Z', interval_end_at) = interval_end_at
    ),
    CHECK (unixepoch(interval_end_at) > unixepoch(interval_start_at)),
    CHECK (duration_seconds = unixepoch(interval_end_at) - unixepoch(interval_start_at)),
    CHECK (proven_rate_units <= reserved_rate_units),
    CHECK (scheduled_capacity_base_units = reserved_rate_units * duration_seconds),
    CHECK (available_capacity_base_units + unavailable_capacity_base_units = scheduled_capacity_base_units),
    CHECK (unproven_capacity_base_units <= unavailable_capacity_base_units),
    CHECK (available_capacity_base_units <= scheduled_capacity_base_units)
  )`,
  `CREATE INDEX IF NOT EXISTS exchange_meter_intervals_session_idx
    ON exchange_meter_intervals(metering_session_id, interval_start_at, interval_end_at)`,
  `CREATE TRIGGER IF NOT EXISTS exchange_meter_intervals_no_overlap
    BEFORE INSERT ON exchange_meter_intervals
    WHEN EXISTS (
      SELECT 1 FROM exchange_meter_intervals existing
      WHERE existing.metering_session_id = NEW.metering_session_id
        AND existing.interval_start_at < NEW.interval_end_at
        AND existing.interval_end_at > NEW.interval_start_at
    )
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_INTERVAL_OVERLAP'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_meter_intervals_immutable_update
    BEFORE UPDATE ON exchange_meter_intervals
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_INTERVAL_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_meter_intervals_immutable_delete
    BEFORE DELETE ON exchange_meter_intervals
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_INTERVAL_IMMUTABLE'); END`,
  `CREATE TABLE IF NOT EXISTS exchange_meter_evidence (
    id TEXT PRIMARY KEY,
    meter_interval_id TEXT NOT NULL,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN ('AVAILABILITY', 'MODEL_IDENTITY', 'THROUGHPUT', 'INSTANCE_HEARTBEAT', 'STORAGE_IDENTITY', 'STORAGE_AVAILABILITY', 'FACILITY_IDENTITY', 'RACK_AVAILABILITY')),
    source TEXT NOT NULL CHECK (source IN ('TEST', 'CONNECTOR', 'CLOUD_API', 'KAI_GATEWAY')),
    model_identity_digest TEXT CHECK (
      model_identity_digest IS NULL OR (
        length(model_identity_digest) = 71 AND substr(model_identity_digest, 1, 7) = 'sha256:'
        AND substr(model_identity_digest, 8) NOT GLOB '*[^0-9a-f]*'
      )
    ),
    payload_digest TEXT NOT NULL CHECK (
      length(payload_digest) = 71 AND substr(payload_digest, 1, 7) = 'sha256:'
      AND substr(payload_digest, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    observed_at TEXT NOT NULL CHECK (
      length(observed_at) = 24
      AND observed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].000Z'
      AND unixepoch(observed_at) IS NOT NULL
      AND strftime('%Y-%m-%dT%H:%M:%S.000Z', observed_at) = observed_at
    ),
    created_at TEXT NOT NULL,
    UNIQUE (meter_interval_id, evidence_type, payload_digest),
    FOREIGN KEY (meter_interval_id) REFERENCES exchange_meter_intervals(id),
    CHECK (evidence_type NOT IN ('MODEL_IDENTITY', 'STORAGE_IDENTITY', 'FACILITY_IDENTITY') OR model_identity_digest IS NOT NULL)
  )`,
  `CREATE TRIGGER IF NOT EXISTS exchange_meter_evidence_observed_within_interval
    BEFORE INSERT ON exchange_meter_evidence
    WHEN NOT EXISTS (
      SELECT 1 FROM exchange_meter_intervals interval
      WHERE interval.id = NEW.meter_interval_id
        AND NEW.observed_at >= interval.interval_start_at
        AND NEW.observed_at <= interval.interval_end_at
    )
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_EVIDENCE_OUTSIDE_INTERVAL'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_meter_evidence_immutable_update
    BEFORE UPDATE ON exchange_meter_evidence
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_EVIDENCE_IMMUTABLE'); END`,
  `CREATE TRIGGER IF NOT EXISTS exchange_meter_evidence_immutable_delete
    BEFORE DELETE ON exchange_meter_evidence
    BEGIN SELECT RAISE(ABORT, 'EXCHANGE_METER_EVIDENCE_IMMUTABLE'); END`,
  `INSERT OR IGNORE INTO exchange_metering_sessions (
    id, order_id, payment_event_id, delivery_task_id, reservation_id, environment, status,
    scheduled_start_at, scheduled_end_at, actual_start_at, finalized_at,
    rate_unit_code, reserved_rate_units,
    scheduled_capacity_base_units, available_capacity_base_units,
    unavailable_capacity_base_units, unproven_capacity_base_units,
    scheduled_gpu_seconds, available_gpu_seconds, unavailable_gpu_seconds, unproven_gpu_seconds,
    availability_ppm, version, created_at, updated_at
  )
  SELECT 'KAI-MS-BACKFILL-' || o.id, o.id, dt.payment_event_id, dt.id, r.id, 'TEST', 'SCHEDULED',
    o.start_at, o.end_at, NULL, NULL,
    o.rate_unit_code, o.rate_units, o.capacity_base_units, 0, 0, o.capacity_base_units,
    o.capacity_gpu_seconds,
    CASE WHEN o.rate_unit_code = 'GPU' THEN 0 ELSE NULL END,
    CASE WHEN o.rate_unit_code = 'GPU' THEN 0 ELSE NULL END,
    o.capacity_gpu_seconds,
    NULL, 1, pi.updated_at, pi.updated_at
  FROM exchange_orders o
  JOIN exchange_payment_intents pi ON pi.order_id = o.id AND pi.status = 'CAPTURED' AND pi.environment = 'TEST'
  JOIN exchange_delivery_tasks dt ON dt.order_id = o.id
  JOIN exchange_reservations r ON r.order_id = o.id
  WHERE NOT EXISTS (SELECT 1 FROM exchange_metering_sessions ms WHERE ms.order_id = o.id)`,
] as const;

export const exchangeSeedStatements = [
  `INSERT OR IGNORE INTO exchange_product_versions (
    id, product_code, pricing_unit_code, display_name, manufacturer, model,
    form_factor, specs_json, immutable_hash, created_at
  ) VALUES
    ('PV-GPU-H100-SXM5-80GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA H100 SXM5 80GB', 'NVIDIA', 'H100 80GB', 'SXM5', '{"memoryGiB":80,"architecture":"Hopper"}', 'gpu:nvidia:h100-80gb:sxm5:v1', '2026-08-05T00:00:00.000Z'),
    ('PV-GPU-H100-PCIE-80GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA H100 PCIe 80GB', 'NVIDIA', 'H100 80GB', 'PCIe', '{"memoryGiB":80,"architecture":"Hopper"}', 'gpu:nvidia:h100-80gb:pcie:v1', '2026-08-05T00:00:00.000Z'),
    ('PV-GPU-A100-SXM4-80GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA A100 SXM4 80GB', 'NVIDIA', 'A100 80GB', 'SXM4', '{"memoryGiB":80,"architecture":"Ampere"}', 'gpu:nvidia:a100-80gb:sxm4:v1', '2026-08-05T00:00:00.000Z'),
    ('PV-GPU-H20-PCIE-96GB', 'GPU_COMPUTE', 'GPU_HOUR', 'NVIDIA H20 PCIe 96GB', 'NVIDIA', 'H20 96GB', 'PCIe', '{"memoryGiB":96,"architecture":"Hopper"}', 'gpu:nvidia:h20-96gb:pcie:v1', '2026-08-05T00:00:00.000Z'),
    ('PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1', 'MODEL_INSTANCE', 'MODEL_INSTANCE_HOUR', 'DeepSeek V4 Pro 标准实例', 'DeepSeek', 'deepseek-v4-pro', 'MANAGED_MODEL_INSTANCE', '{"registryId":"deepseek-v4-pro-standard","provider":"DeepSeek","canonicalModel":"deepseek-v4-pro","modelRevision":"v4-pro","serviceTier":"standard-reasoning-switchable","contextBucket":"default","regionScope":"REGION_INDEPENDENT","quantization":"PROVIDER_MANAGED"}', 'model:deepseek:deepseek-v4-pro:standard:v1', '2026-08-06T00:00:00.000Z'),
    ('PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1', 'TOKEN_THROUGHPUT', 'M_TOKEN_CAPACITY_HOUR', 'DeepSeek V4 Pro 标准 Token 吞吐容量', 'DeepSeek', 'deepseek-v4-pro', 'MANAGED_TOKEN_THROUGHPUT', '{"registryId":"deepseek-v4-pro-throughput-standard","manufacturer":"DeepSeek","canonicalModel":"deepseek-v4-pro","modelRevision":"v4-pro","serviceTier":"standard-reasoning-switchable","contextBucket":"default","regionScope":"REGION_INDEPENDENT","quantization":"PROVIDER_MANAGED","throughputMetric":"BILLABLE_INPUT_PLUS_OUTPUT_PER_HOUR","tokenizer":"PROVIDER_TOKENIZER","formFactor":"MANAGED_TOKEN_THROUGHPUT"}', 'token-throughput:deepseek:deepseek-v4-pro:standard:v1', '2026-08-06T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO exchange_product_versions (
    id, product_code, pricing_unit_code, display_name, manufacturer, model,
    form_factor, specs_json, immutable_hash, created_at
  ) VALUES
    ('PV-NAS-NFS41-BALANCED-1TIB-V1', 'NAS_STORAGE', 'TIB_HOUR', '托管 NFS 4.1 均衡存储 1 TiB', 'KAI', 'nfs41-balanced-1tib', 'MANAGED_NAS_VOLUME', '{"registryId":"kai-nas-nfs41-balanced-v1","protocol":"NFS_4_1","performanceTier":"BALANCED","minIopsPerTiB":3000,"minThroughputMiBpsPerTiB":200,"redundancy":"MULTI_NODE","encryptionAtRest":true,"snapshotPolicy":"DAILY_7D","regionScope":"SUPPLIER_DECLARED_CN_REGION","egressBilling":"EXCLUDED","formFactor":"MANAGED_NAS_VOLUME"}', 'nas-storage:kai:nfs41-balanced-1tib:v1', '2026-08-06T00:00:00.000Z'),
    ('PV-RACK-42U-10KW-MANAGED-V1', 'RACK_SPACE', 'RACK_HOUR', '42U 10kW 托管共址空间', 'KAI', 'rack-42u-10kw-managed', 'MANAGED_COLOCATION_RACK', '{"registryId":"kai-rack-42u-10kw-managed-v1","rackUnits":42,"committedPowerKw":10,"powerBilling":"INCLUDED_UP_TO_10KW","cooling":"N_PLUS_ONE","network":"BASIC_DUAL_UPLINK","access":"MANAGED_WORK_ORDER","regionScope":"SUPPLIER_DECLARED_CN_REGION","formFactor":"MANAGED_COLOCATION_RACK"}', 'rack-space:kai:42u-10kw-managed:v1', '2026-08-06T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO exchange_product_capacity_policies (
    id, product_version_id, policy_key, product_code, rate_unit_code, fulfillment_model,
    pricing_unit_code, rate_unit_scale_numerator, rate_unit_scale_denominator,
    rate_unit_reference_code, price_basis_base_units, feature_status,
    identity_spec_json, immutable_hash, created_at
  ) VALUES
    ('PCP-GPU-H100-SXM5-80GB-V1', 'PV-GPU-H100-SXM5-80GB', 'gpu-h100-sxm5-80gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
      'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:h100-sxm5-80gb:v1', '2026-08-05T00:00:00.000Z'),
    ('PCP-GPU-H100-PCIE-80GB-V1', 'PV-GPU-H100-PCIE-80GB', 'gpu-h100-pcie-80gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
      'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:h100-pcie-80gb:v1', '2026-08-05T00:00:00.000Z'),
    ('PCP-GPU-A100-SXM4-80GB-V1', 'PV-GPU-A100-SXM4-80GB', 'gpu-a100-sxm4-80gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
      'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:a100-sxm4-80gb:v1', '2026-08-05T00:00:00.000Z'),
    ('PCP-GPU-H20-PCIE-96GB-V1', 'PV-GPU-H20-PCIE-96GB', 'gpu-h20-pcie-96gb-v1', 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION',
      'GPU_HOUR', 1, 1, 'GPU', 3600, 'ENABLED', '{"identity":"GPU_PRODUCT_VERSION","capacityBaseUnit":"GPU_SECOND"}', 'policy:gpu:h20-pcie-96gb:v1', '2026-08-05T00:00:00.000Z'),
    ('PCP-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1', 'PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1', 'model-deepseek-v4-pro-standard-v1', 'MODEL_INSTANCE', 'MODEL_INSTANCE', 'MODEL_INSTANCE_ALLOCATION',
      'MODEL_INSTANCE_HOUR', 1, 1, 'MODEL_INSTANCE', 3600, 'ENABLED', '{"registryId":"deepseek-v4-pro-standard","provider":"DeepSeek","canonicalModel":"deepseek-v4-pro","modelRevision":"v4-pro","serviceTier":"standard-reasoning-switchable","contextBucket":"default","regionScope":"REGION_INDEPENDENT","quantization":"PROVIDER_MANAGED","capacityBaseUnit":"MODEL_INSTANCE_SECOND"}', 'policy:model:deepseek-v4-pro:standard:v1', '2026-08-06T00:00:00.000Z'),
    ('PCP-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1', 'PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1', 'deepseek-v4-pro-throughput-standard', 'TOKEN_THROUGHPUT', 'MILLI_M_TOKEN_PER_HOUR', 'TOKEN_THROUGHPUT_RESERVATION',
      'M_TOKEN_CAPACITY_HOUR', 1, 1000, 'M_TOKEN_PER_HOUR', 3600000, 'ENABLED', '{"registryId":"deepseek-v4-pro-throughput-standard","manufacturer":"DeepSeek","canonicalModel":"deepseek-v4-pro","modelRevision":"v4-pro","serviceTier":"standard-reasoning-switchable","contextBucket":"default","regionScope":"REGION_INDEPENDENT","quantization":"PROVIDER_MANAGED","throughputMetric":"BILLABLE_INPUT_PLUS_OUTPUT_PER_HOUR","tokenizer":"PROVIDER_TOKENIZER","formFactor":"MANAGED_TOKEN_THROUGHPUT","rateUnit":"0.001_M_TOKEN_PER_HOUR","capacityBaseUnit":"MILLI_M_TOKEN_PER_HOUR_SECOND"}', 'policy:token-throughput:deepseek-v4-pro:standard:v1', '2026-08-06T00:00:00.000Z'),
    ('PCP-TEMPLATE-MODEL-INSTANCE-V1', NULL, 'template-model-instance-v1', 'MODEL_INSTANCE', 'MODEL_INSTANCE', 'MODEL_INSTANCE_ALLOCATION',
      'MODEL_INSTANCE_HOUR', 1, 1, 'MODEL_INSTANCE', 3600, 'DISABLED', '{"canonicalModelRequired":true,"modelRevisionRequired":true,"serviceTierRequired":true,"contextBucketRequired":true,"quantizationRequired":true,"capacityBaseUnit":"MODEL_INSTANCE_SECOND"}', 'policy-template:model-instance:v1', '2026-08-05T00:00:00.000Z'),
    ('PCP-TEMPLATE-TOKEN-THROUGHPUT-V1', NULL, 'template-token-throughput-v1', 'TOKEN_THROUGHPUT', 'MILLI_M_TOKEN_PER_HOUR', 'TOKEN_THROUGHPUT_RESERVATION',
      'M_TOKEN_CAPACITY_HOUR', 1, 1000, 'M_TOKEN_PER_HOUR', 3600000, 'DISABLED', '{"canonicalModelRequired":true,"modelRevisionRequired":true,"serviceTierRequired":true,"contextBucketRequired":true,"throughputDimensionRequired":true,"rateUnit":"0.001_M_TOKEN_PER_HOUR","capacityBaseUnit":"MILLI_M_TOKEN_PER_HOUR_SECOND"}', 'policy-template:token-throughput:v1', '2026-08-05T00:00:00.000Z')`,
  `INSERT OR IGNORE INTO exchange_product_capacity_policies (
    id, product_version_id, policy_key, product_code, rate_unit_code, fulfillment_model,
    pricing_unit_code, rate_unit_scale_numerator, rate_unit_scale_denominator,
    rate_unit_reference_code, price_basis_base_units, feature_status,
    identity_spec_json, immutable_hash, created_at
  ) VALUES
    ('PCP-NAS-NFS41-BALANCED-1TIB-V1', 'PV-NAS-NFS41-BALANCED-1TIB-V1', 'kai-nas-nfs41-balanced-v1', 'NAS_STORAGE', 'GIB_STORAGE', 'NAS_VOLUME_ALLOCATION',
      'TIB_HOUR', 1, 1024, 'TIB_STORAGE', 3686400, 'ENABLED', '{"registryId":"kai-nas-nfs41-balanced-v1","protocol":"NFS_4_1","performanceTier":"BALANCED","minIopsPerTiB":3000,"minThroughputMiBpsPerTiB":200,"redundancy":"MULTI_NODE","encryptionAtRest":true,"snapshotPolicy":"DAILY_7D","regionScope":"SUPPLIER_DECLARED_CN_REGION","egressBilling":"EXCLUDED","formFactor":"MANAGED_NAS_VOLUME","rateUnit":"GIB_STORAGE","capacityBaseUnit":"GIB_STORAGE_SECOND"}', 'policy:nas-storage:kai:nfs41-balanced:v1', '2026-08-06T00:00:00.000Z'),
    ('PCP-RACK-42U-10KW-MANAGED-V1', 'PV-RACK-42U-10KW-MANAGED-V1', 'kai-rack-42u-10kw-managed-v1', 'RACK_SPACE', 'RACK', 'RACK_COLOCATION_ALLOCATION',
      'RACK_HOUR', 1, 1, 'RACK', 3600, 'ENABLED', '{"registryId":"kai-rack-42u-10kw-managed-v1","rackUnits":42,"committedPowerKw":10,"powerBilling":"INCLUDED_UP_TO_10KW","cooling":"N_PLUS_ONE","network":"BASIC_DUAL_UPLINK","access":"MANAGED_WORK_ORDER","regionScope":"SUPPLIER_DECLARED_CN_REGION","formFactor":"MANAGED_COLOCATION_RACK","rateUnit":"RACK","capacityBaseUnit":"RACK_SECOND"}', 'policy:rack-space:kai:42u-10kw-managed:v1', '2026-08-06T00:00:00.000Z')`,
] as const;
