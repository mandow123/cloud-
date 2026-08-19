// 0021 only adds backward-compatible write guards. Keep the application
// schema gate at v3 so the currently deployed v3 application can be restored
// without a database rollback.
export const ADMIN_OPERATIONS_SCHEMA_VERSION = 3;

export const adminOperationsSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS admin_operations_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_work_items (
    id TEXT PRIMARY KEY,
    source_system TEXT NOT NULL CHECK (source_system IN ('MARKETPLACE','EXCHANGE','SUPPLY_PILOT','ADMIN')),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    work_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN','CLAIMED','WAITING','RESOLVED','CANCELLED')),
    priority TEXT NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
    assignee_principal_id TEXT,
    due_at TEXT,
    metadata_json TEXT NOT NULL,
    created_by TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_work_items_queue_idx ON admin_work_items(status,priority,due_at,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_work_items_entity_idx ON admin_work_items(source_system,entity_type,entity_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_approvals (
    id TEXT PRIMARY KEY,
    approval_type TEXT NOT NULL CHECK (approval_type IN ('REFUND')),
    source_system TEXT NOT NULL CHECK (source_system IN ('EXCHANGE','SUPPLY_PILOT')),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency='CNY'),
    business_expected_version INTEGER NOT NULL CHECK (business_expected_version > 0),
    status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    requested_by TEXT NOT NULL,
    request_reason TEXT NOT NULL,
    decided_by TEXT,
    decision_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    decided_at TEXT,
    CHECK (status='PENDING' OR (decided_by IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL)),
    CHECK (decided_by IS NULL OR decided_by<>requested_by)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_approvals_queue_idx ON admin_approvals(approval_type,status,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_refund_executions (
    refund_case_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider='ALIPAY'),
    refund_request_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED')),
    attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
    attempted_by TEXT NOT NULL,
    claim_token TEXT NOT NULL,
    provider_transaction_ref TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    last_attempt_at TEXT NOT NULL,
    completed_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (refund_case_id) REFERENCES admin_approvals(id)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_refund_executions_status_idx ON admin_refund_executions(status,last_attempt_at)`,
  `CREATE TRIGGER IF NOT EXISTS admin_refund_executions_order_processing_insert_guard
    BEFORE INSERT ON admin_refund_executions
    WHEN NEW.status='PROCESSING' AND EXISTS (
      SELECT 1 FROM admin_refund_executions
      WHERE order_id=NEW.order_id AND status='PROCESSING'
    )
    BEGIN SELECT RAISE(IGNORE); END`,
  `CREATE TRIGGER IF NOT EXISTS admin_refund_executions_order_processing_update_guard
    BEFORE UPDATE OF order_id,status ON admin_refund_executions
    WHEN NEW.status='PROCESSING' AND EXISTS (
      SELECT 1 FROM admin_refund_executions
      WHERE order_id=NEW.order_id
        AND refund_case_id<>OLD.refund_case_id
        AND status='PROCESSING'
    )
    BEGIN SELECT RAISE(IGNORE); END`,
  `CREATE TABLE IF NOT EXISTS admin_audit_events (
    id TEXT PRIMARY KEY,
    actor_principal_id TEXT NOT NULL,
    source_system TEXT NOT NULL CHECK (source_system IN ('MARKETPLACE','EXCHANGE','SUPPLY_PILOT','ADMIN')),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS admin_audit_events_entity_idx ON admin_audit_events(source_system,entity_type,entity_id,occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx ON admin_audit_events(actor_principal_id,occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_principal_projection (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
    roles_json TEXT NOT NULL,
    permissions_json TEXT NOT NULL,
    projected_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_role_projection (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
    permissions_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    projected_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_principal_management (
    membership_id TEXT PRIMARY KEY,
    invited_by_principal_id TEXT,
    invited_at TEXT,
    updated_by_principal_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (membership_id) REFERENCES admin_memberships(id),
    FOREIGN KEY (invited_by_principal_id) REFERENCES admin_user_accounts(id),
    FOREIGN KEY (updated_by_principal_id) REFERENCES admin_user_accounts(id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_command_receipts (
    actor_principal_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_principal_id,idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_entity_ownership (
    source_system TEXT NOT NULL CHECK (source_system IN ('MARKETPLACE','EXCHANGE','SUPPLY_PILOT','ADMIN')),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    legacy_actor_id TEXT,
    bound_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(source_system,entity_type,entity_id)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_entity_ownership_org_idx ON admin_entity_ownership(organization_id,source_system,entity_type,updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_manual_delivery_intakes (
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
  )`,
  `CREATE INDEX IF NOT EXISTS admin_manual_delivery_intakes_created_idx
    ON admin_manual_delivery_intakes(status,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_catalog_purchase_intent_snapshots (
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
  )`,
  `CREATE INDEX IF NOT EXISTS admin_catalog_purchase_intent_snapshots_buyer_idx
    ON admin_catalog_purchase_intent_snapshots(buyer_organization_id,created_at DESC)`,
] as const;
