-- Isolated supply inventory, promotion, order, payment and secure-delivery schema.
CREATE TABLE IF NOT EXISTS supply_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS supply_asset_pools (
    id TEXT PRIMARY KEY,
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    asset_kind TEXT NOT NULL CHECK (asset_kind IN ('H100_8X_NODE','MAC_MINI','GENERAL_SERVER')),
    name TEXT NOT NULL,
    region TEXT NOT NULL,
    delivery_form TEXT NOT NULL,
    spec_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (supplier_actor_id, idempotency_key),
    UNIQUE (supplier_actor_id, external_ref)
  );

CREATE TABLE IF NOT EXISTS supply_promotion_policies (
    pool_id TEXT PRIMARY KEY,
    publication_mode TEXT NOT NULL CHECK (publication_mode IN ('H100_LIMITED_TRIAL','INVENTORY_ONLY')),
    unit_price_micros_gpu_hour INTEGER,
    gpu_count_per_node INTEGER,
    max_order_hours INTEGER NOT NULL,
    max_buyer_node_hours INTEGER NOT NULL,
    max_total_node_hours INTEGER NOT NULL,
    ssh_exclusive_required INTEGER NOT NULL CHECK (ssh_exclusive_required IN (0,1)),
    created_at TEXT NOT NULL,
    FOREIGN KEY (pool_id) REFERENCES supply_asset_pools(id),
    CHECK (
      (publication_mode = 'H100_LIMITED_TRIAL' AND unit_price_micros_gpu_hour = 1000000
        AND gpu_count_per_node = 8 AND max_order_hours BETWEEN 1 AND 8
        AND max_buyer_node_hours BETWEEN 1 AND 8 AND max_total_node_hours = 80
        AND ssh_exclusive_required = 1)
      OR (publication_mode = 'INVENTORY_ONLY' AND unit_price_micros_gpu_hour IS NULL
        AND gpu_count_per_node IS NULL AND max_total_node_hours = 0)
    )
  );

CREATE TABLE IF NOT EXISTS supply_asset_members (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    external_ref TEXT NOT NULL,
    serial_digest TEXT NOT NULL,
    hardware_uuid_digest TEXT,
    spec_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DECLARED','ONLINE','VERIFIED','REJECTED','SUSPENDED')),
    last_seen_at TEXT,
    verified_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (supplier_actor_id, external_ref),
    UNIQUE (supplier_actor_id, serial_digest),
    FOREIGN KEY (pool_id) REFERENCES supply_asset_pools(id)
  );

CREATE INDEX IF NOT EXISTS supply_members_pool_idx ON supply_asset_members(pool_id, status, created_at);

CREATE TABLE IF NOT EXISTS supply_asset_components (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    component_type TEXT NOT NULL CHECK (component_type IN ('GPU','CPU','MEMORY','STORAGE','NETWORK','HOST')),
    identity_digest TEXT NOT NULL,
    model TEXT NOT NULL,
    memory_gib INTEGER,
    topology_group TEXT,
    specs_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DECLARED','VERIFIED','REJECTED')),
    created_at TEXT NOT NULL,
    UNIQUE (member_id, identity_digest),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id)
  );

CREATE TABLE IF NOT EXISTS supply_agent_enrollments (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    public_key_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
    enrolled_at TEXT NOT NULL,
    last_seen_at TEXT,
    UNIQUE (supplier_actor_id, idempotency_key),
    UNIQUE (member_id, public_key_digest),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id)
  );

CREATE TABLE IF NOT EXISTS supply_agent_heartbeats (
    id TEXT PRIMARY KEY,
    enrollment_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE (supplier_actor_id, idempotency_key),
    UNIQUE (enrollment_id, payload_digest),
    FOREIGN KEY (enrollment_id) REFERENCES supply_agent_enrollments(id)
  );

CREATE TABLE IF NOT EXISTS supply_verification_jobs (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    request_idempotency_key TEXT NOT NULL,
    request_payload_hash TEXT NOT NULL,
    reviewed_by TEXT,
    completion_idempotency_key TEXT,
    completion_payload_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('PENDING','PASSED','FAILED')),
    valid_until TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (requested_by, request_idempotency_key),
    FOREIGN KEY (pool_id) REFERENCES supply_asset_pools(id),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id)
  );

CREATE TABLE IF NOT EXISTS supply_verification_evidence (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    operator_actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    evidence_type TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    summary TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (operator_actor_id, idempotency_key),
    UNIQUE (job_id, evidence_type, payload_digest),
    FOREIGN KEY (job_id) REFERENCES supply_verification_jobs(id)
  );

CREATE TABLE IF NOT EXISTS supply_availability_windows (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    import_idempotency_key TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('AVAILABLE','PROMOTED','SUSPENDED')),
    created_at TEXT NOT NULL,
    UNIQUE (member_id, start_at, end_at),
    FOREIGN KEY (pool_id) REFERENCES supply_asset_pools(id),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id),
    CHECK (end_at > start_at)
  );

CREATE INDEX IF NOT EXISTS supply_windows_member_idx ON supply_availability_windows(member_id, start_at, end_at, status);

CREATE TABLE IF NOT EXISTS supply_promotions (
    id TEXT PRIMARY KEY,
    pool_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    availability_window_id TEXT NOT NULL UNIQUE,
    supplier_actor_id TEXT NOT NULL,
    commit_idempotency_key TEXT NOT NULL,
    unit_price_micros_gpu_hour INTEGER NOT NULL CHECK (unit_price_micros_gpu_hour = 1000000),
    gpu_count INTEGER NOT NULL CHECK (gpu_count = 8),
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    node_hours INTEGER NOT NULL CHECK (node_hours > 0),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED','EXHAUSTED')),
    created_at TEXT NOT NULL,
    UNIQUE (supplier_actor_id, commit_idempotency_key, availability_window_id),
    FOREIGN KEY (pool_id) REFERENCES supply_asset_pools(id),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id),
    FOREIGN KEY (availability_window_id) REFERENCES supply_availability_windows(id)
  );

CREATE TABLE IF NOT EXISTS supply_exchange_bindings (
    id TEXT PRIMARY KEY,
    promotion_id TEXT NOT NULL UNIQUE,
    pool_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    availability_window_id TEXT NOT NULL,
    binding_mode TEXT NOT NULL CHECK (binding_mode = 'ISOLATED_SUPPLY'),
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
    created_at TEXT NOT NULL,
    FOREIGN KEY (promotion_id) REFERENCES supply_promotions(id),
    FOREIGN KEY (pool_id) REFERENCES supply_asset_pools(id),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id),
    FOREIGN KEY (availability_window_id) REFERENCES supply_availability_windows(id)
  );

CREATE TABLE IF NOT EXISTS supply_trial_orders (
    id TEXT PRIMARY KEY,
    promotion_id TEXT NOT NULL,
    allocation_binding_id TEXT NOT NULL UNIQUE,
    buyer_actor_id TEXT NOT NULL,
    supplier_actor_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    duration_hours INTEGER NOT NULL CHECK (duration_hours BETWEEN 1 AND 8),
    gpu_count INTEGER NOT NULL CHECK (gpu_count = 8),
    unit_price_micros_gpu_hour INTEGER NOT NULL CHECK (unit_price_micros_gpu_hour = 1000000),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    status TEXT NOT NULL CHECK (status IN ('PAYMENT_PENDING','PAID','PROVISIONING','DELIVERED','IN_SERVICE','COMPLETED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')),
    expires_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (buyer_actor_id, idempotency_key),
    FOREIGN KEY (promotion_id) REFERENCES supply_promotions(id),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id),
    CHECK (end_at > start_at),
    CHECK (amount_cents = duration_hours * gpu_count * 100)
  );

CREATE TABLE IF NOT EXISTS supply_allocation_bindings (
    id TEXT PRIMARY KEY,
    promotion_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    buyer_actor_id TEXT NOT NULL,
    trial_order_id TEXT NOT NULL UNIQUE,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    node_hours INTEGER NOT NULL CHECK (node_hours BETWEEN 1 AND 8),
    status TEXT NOT NULL CHECK (status IN ('RESERVED','LOCKED','IN_SERVICE','RELEASED','CANCELLED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (promotion_id) REFERENCES supply_promotions(id),
    FOREIGN KEY (member_id) REFERENCES supply_asset_members(id),
    FOREIGN KEY (trial_order_id) REFERENCES supply_trial_orders(id),
    CHECK (end_at > start_at)
  );

CREATE INDEX IF NOT EXISTS supply_allocations_member_window_idx ON supply_allocation_bindings(member_id, start_at, end_at, status);

CREATE TABLE IF NOT EXISTS supply_trial_payments (
    order_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('PENDING','CAPTURED','CLOSED','REFUND_PENDING','REFUNDED','FAILED')),
    provider TEXT NOT NULL,
    provider_order_ref TEXT NOT NULL,
    provider_transaction_ref TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (provider, provider_order_ref),
    UNIQUE (provider, provider_transaction_ref),
    FOREIGN KEY (order_id) REFERENCES supply_trial_orders(id)
  );

CREATE TABLE IF NOT EXISTS supply_trial_payment_events (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_event_ref TEXT NOT NULL,
    provider_transaction_ref TEXT,
    event_type TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('CAPTURE','REFUND','OTHER')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    payload_digest TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('APPLIED','IGNORED','REJECTED')),
    resulting_status TEXT NOT NULL CHECK (resulting_status IN ('PENDING','CAPTURED','CLOSED','REFUND_PENDING','REFUNDED','FAILED')),
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE (provider, provider_event_ref),
    UNIQUE (provider, provider_transaction_ref, event_type),
    FOREIGN KEY (order_id) REFERENCES supply_trial_orders(id)
  );

CREATE INDEX IF NOT EXISTS supply_payment_events_order_idx ON supply_trial_payment_events(order_id, received_at);

CREATE TABLE IF NOT EXISTS supply_trial_deliveries (
    order_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('AWAITING_PAYMENT','AWAITING_KEY','PROVISIONING','READY','IN_SERVICE','CLEANING','COMPLETED','FAILED')),
    buyer_public_key_fingerprint TEXT,
    secure_endpoint_ref TEXT,
    host_key_fingerprint TEXT,
    credential_expires_at TEXT,
    cleanup_evidence_digest TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES supply_trial_orders(id),
    CHECK (secure_endpoint_ref IS NULL OR secure_endpoint_ref LIKE 'secure-ref:%')
  );

CREATE TABLE IF NOT EXISTS supply_trial_connection_checks (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('RUNNING','PASSED','FAILED')),
    diagnostic_code TEXT NOT NULL,
    evidence_digest TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (order_id) REFERENCES supply_trial_orders(id)
  );

CREATE INDEX IF NOT EXISTS supply_connection_checks_order_idx ON supply_trial_connection_checks(order_id, started_at);

CREATE TABLE IF NOT EXISTS supply_command_receipts (
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    command_type TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (actor_id, idempotency_key)
  );

INSERT OR IGNORE INTO supply_schema_migrations (version, applied_at) VALUES (1, CURRENT_TIMESTAMP);

