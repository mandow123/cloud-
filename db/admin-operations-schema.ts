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
  `CREATE TABLE IF NOT EXISTS admin_manual_delivery_statuses (
    demand_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('PENDING_MANUAL_DELIVERY','SUPPLIER_ASSIGNED','DELIVERY_IN_PROGRESS','AWAITING_BUYER_ACCEPTANCE','COMPLETED','CANCELLED','ACCESS_REVOKED')),
    supplier_organization_id TEXT,
    internal_note TEXT,
    buyer_visible_note TEXT,
    connection_host TEXT,
    connection_port INTEGER CHECK (connection_port IS NULL OR (connection_port BETWEEN 1 AND 65535)),
    connection_username TEXT,
    connection_host_key_fingerprint TEXT,
    assigned_at TEXT,
    started_at TEXT,
    delivered_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    revoked_at TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (demand_id) REFERENCES admin_manual_delivery_intakes(demand_id)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_manual_delivery_statuses_supplier_idx
    ON admin_manual_delivery_statuses(supplier_organization_id,status,updated_at DESC)`,
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
  `CREATE TABLE IF NOT EXISTS admin_manual_appeal_cases (
    id TEXT PRIMARY KEY,
    case_number TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL CHECK (source_type='MANUAL_DELIVERY_DEMAND'),
    source_id TEXT NOT NULL,
    parent_case_id TEXT,
    buyer_organization_id TEXT NOT NULL,
    buyer_account_id TEXT NOT NULL,
    supplier_organization_id TEXT,
    category TEXT NOT NULL CHECK (category IN ('DELIVERY_DELAY','CONNECTION_FAILURE','SPEC_MISMATCH','DELIVERY_QUALITY','CANCELLATION_REQUEST','EXTERNAL_PAYMENT_CLAIM','OTHER')),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
    status TEXT NOT NULL CHECK (status IN ('OPEN','TRIAGED','AWAITING_BUYER','AWAITING_SUPPLIER','UNDER_REVIEW','RESOLUTION_PROPOSED','RESOLVED','CLOSED')),
    resolution_outcome TEXT CHECK (resolution_outcome IS NULL OR resolution_outcome IN ('NO_ACTION','REDELIVERY_RECOMMENDED','CANCEL_REQUEST_RECOMMENDED','OFFLINE_REFUND_RECOMMENDED','OTHER')),
    resolution_summary TEXT,
    assigned_admin_principal_id TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    closed_at TEXT,
    FOREIGN KEY (parent_case_id) REFERENCES admin_manual_appeal_cases(id),
    FOREIGN KEY (source_id) REFERENCES admin_catalog_purchase_intent_snapshots(demand_id),
    CHECK ((status IN ('RESOLUTION_PROPOSED','RESOLVED') AND resolution_outcome IS NOT NULL AND resolution_summary IS NOT NULL) OR (status NOT IN ('RESOLUTION_PROPOSED','RESOLVED','CLOSED') AND resolution_outcome IS NULL AND resolution_summary IS NULL) OR (status='CLOSED' AND ((resolution_outcome IS NULL AND resolution_summary IS NULL) OR (resolution_outcome IS NOT NULL AND resolution_summary IS NOT NULL))))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS admin_manual_appeal_one_active_source_idx
    ON admin_manual_appeal_cases(buyer_organization_id,source_type,source_id) WHERE status<>'CLOSED'`,
  `CREATE INDEX IF NOT EXISTS admin_manual_appeal_buyer_idx ON admin_manual_appeal_cases(buyer_organization_id,updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_manual_appeal_supplier_idx ON admin_manual_appeal_cases(supplier_organization_id,updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_manual_appeal_queue_idx ON admin_manual_appeal_cases(status,assigned_admin_principal_id,updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_manual_appeal_messages (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    author_type TEXT NOT NULL CHECK (author_type IN ('BUYER','SUPPLIER','ADMIN')),
    author_principal_id TEXT NOT NULL,
    author_organization_id TEXT,
    visibility TEXT NOT NULL CHECK (visibility IN ('PARTIES','ADMIN_ONLY')),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES admin_manual_appeal_cases(id)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_manual_appeal_messages_case_idx ON admin_manual_appeal_messages(case_id,created_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_messages_immutable_update BEFORE UPDATE ON admin_manual_appeal_messages BEGIN SELECT RAISE(ABORT,'manual appeal message immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_messages_immutable_delete BEFORE DELETE ON admin_manual_appeal_messages BEGIN SELECT RAISE(ABORT,'manual appeal message immutable'); END`,
  `CREATE TABLE IF NOT EXISTS admin_manual_appeal_events (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('CREATE','ASSIGN','TRANSITION','MESSAGE_ADDED','REFUND_RECORD_CREATED','REFUND_PROOF_SUBMITTED','REFUND_PROOF_VERIFIED')),
    from_status TEXT,
    to_status TEXT,
    actor_principal_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES admin_manual_appeal_cases(id)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_manual_appeal_events_case_idx ON admin_manual_appeal_events(case_id,occurred_at,id)`,
  `CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_events_immutable_update BEFORE UPDATE ON admin_manual_appeal_events BEGIN SELECT RAISE(ABORT,'manual appeal event immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS admin_manual_appeal_events_immutable_delete BEFORE DELETE ON admin_manual_appeal_events BEGIN SELECT RAISE(ABORT,'manual appeal event immutable'); END`,
  `CREATE TABLE IF NOT EXISTS admin_verified_financial_references (
    id TEXT PRIMARY KEY,
    buyer_organization_id TEXT NOT NULL,
    source_system TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status='VERIFIED'),
    evidence_digest TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    UNIQUE (source_system,source_entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_manual_appeal_evidence (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    object_ref TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    scan_status TEXT NOT NULL CHECK (scan_status='SAFE'),
    created_by_principal_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES admin_manual_appeal_cases(id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_manual_appeal_offline_refunds (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    supersedes_record_id TEXT,
    verified_financial_reference_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('BANK_TRANSFER','ALIPAY','WXPAY','OTHER')),
    masked_reference TEXT,
    external_reference_hash TEXT,
    proof_evidence_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('APPROVED_FOR_OFFLINE_HANDLING','OFFLINE_PROCESSING','PROOF_SUBMITTED','INDEPENDENTLY_VERIFIED','FAILED','CANCELLED')),
    recorded_by_principal_id TEXT NOT NULL,
    verified_by_principal_id TEXT,
    proof_submitted_at TEXT,
    proof_verified_at TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES admin_manual_appeal_cases(id),
    FOREIGN KEY (supersedes_record_id) REFERENCES admin_manual_appeal_offline_refunds(id),
    FOREIGN KEY (verified_financial_reference_id) REFERENCES admin_verified_financial_references(id),
    CHECK (verified_by_principal_id IS NULL OR verified_by_principal_id<>recorded_by_principal_id),
    CHECK ((status='INDEPENDENTLY_VERIFIED' AND verified_by_principal_id IS NOT NULL AND proof_verified_at IS NOT NULL) OR status<>'INDEPENDENTLY_VERIFIED')
  )`,
  `CREATE INDEX IF NOT EXISTS admin_manual_appeal_refunds_case_idx ON admin_manual_appeal_offline_refunds(case_id,created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS admin_manual_appeal_refunds_source_once_idx ON admin_manual_appeal_offline_refunds(case_id,verified_financial_reference_id)`,
  `CREATE TABLE IF NOT EXISTS admin_manual_order_fee_tiers (
    policy_version TEXT NOT NULL,
    tier_code TEXT NOT NULL,
    minimum_lifetime_micros INTEGER NOT NULL CHECK (minimum_lifetime_micros>=0),
    platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 20 AND 100),
    created_at TEXT NOT NULL,
    PRIMARY KEY(policy_version,tier_code),
    UNIQUE(policy_version,minimum_lifetime_micros)
  )`,
  `INSERT OR IGNORE INTO admin_manual_order_fee_tiers(policy_version,tier_code,minimum_lifetime_micros,platform_fee_bps,created_at) VALUES
    ('MANUAL-2026-01','STARTER',0,100,'2026-08-21T00:00:00.000Z'),
    ('MANUAL-2026-01','GROWTH',10000000000,80,'2026-08-21T00:00:00.000Z'),
    ('MANUAL-2026-01','SCALE',50000000000,60,'2026-08-21T00:00:00.000Z'),
    ('MANUAL-2026-01','VOLUME',200000000000,40,'2026-08-21T00:00:00.000Z'),
    ('MANUAL-2026-01','STRATEGIC',1000000000000,20,'2026-08-21T00:00:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS admin_manual_commercial_orders (
    id TEXT PRIMARY KEY,demand_id TEXT NOT NULL UNIQUE,buyer_organization_id TEXT NOT NULL,buyer_account_id TEXT NOT NULL,supplier_organization_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('OFFERED','CARD_HOURS_HELD','PREPARING','READY','CONNECTION_CONFIRMED','AWAITING_ACCEPTANCE','COMPLETED','CANCELLED')),
    current_offer_version INTEGER NOT NULL DEFAULT 1 CHECK(current_offer_version>0),accepted_offer_version INTEGER,actual_card_hour_micros INTEGER,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    FOREIGN KEY(demand_id) REFERENCES admin_catalog_purchase_intent_snapshots(demand_id)
  )`,
  `CREATE INDEX IF NOT EXISTS admin_manual_orders_buyer_idx ON admin_manual_commercial_orders(buyer_organization_id,updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS admin_manual_orders_supplier_idx ON admin_manual_commercial_orders(supplier_organization_id,updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS admin_manual_order_offer_versions (
    order_id TEXT NOT NULL,offer_version INTEGER NOT NULL,quoted_card_hour_micros INTEGER NOT NULL CHECK(quoted_card_hour_micros>0),service_summary TEXT NOT NULL,expected_delivery_at TEXT,snapshot_json TEXT NOT NULL,
    fee_policy_version TEXT NOT NULL,fee_tier_code TEXT NOT NULL,platform_fee_bps INTEGER NOT NULL CHECK(platform_fee_bps BETWEEN 20 AND 100),
    created_by_principal_id TEXT NOT NULL,created_at TEXT NOT NULL,
    PRIMARY KEY(order_id,offer_version),FOREIGN KEY(order_id) REFERENCES admin_manual_commercial_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_manual_order_holds (
    id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE,buyer_organization_id TEXT NOT NULL,buyer_account_id TEXT NOT NULL,amount_micros INTEGER NOT NULL CHECK(amount_micros>0),captured_micros INTEGER,released_micros INTEGER,status TEXT NOT NULL CHECK(status IN ('HELD','CAPTURED','RELEASED')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(order_id) REFERENCES admin_manual_commercial_orders(id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_manual_order_hold_events (
    id TEXT PRIMARY KEY,hold_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('HELD','CAPTURED','RELEASED')),amount_micros INTEGER NOT NULL CHECK(amount_micros>=0),payload_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,UNIQUE(hold_id,event_type),FOREIGN KEY(hold_id) REFERENCES admin_manual_order_holds(id)
  )`,
  `CREATE TABLE IF NOT EXISTS admin_manual_order_settlement_eligibility (
    id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE,supplier_organization_id TEXT NOT NULL,captured_card_hour_micros INTEGER NOT NULL CHECK(captured_card_hour_micros>0),gross_cny_cents INTEGER NOT NULL CHECK(gross_cny_cents>0),policy_version TEXT NOT NULL,tier_code TEXT NOT NULL,platform_fee_bps INTEGER NOT NULL CHECK(platform_fee_bps BETWEEN 20 AND 100),platform_fee_cny_cents INTEGER NOT NULL CHECK(platform_fee_cny_cents>0),supplier_receivable_cny_cents INTEGER NOT NULL CHECK(supplier_receivable_cny_cents>0),status TEXT NOT NULL CHECK(status='ELIGIBLE'),payout_status TEXT NOT NULL CHECK(payout_status='CLOSED'),created_at TEXT NOT NULL,FOREIGN KEY(order_id) REFERENCES admin_manual_commercial_orders(id)
  )`,
] as const;
