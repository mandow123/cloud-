CREATE TABLE IF NOT EXISTS managed_gpu_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS managed_gpu_product_versions (
    id TEXT PRIMARY KEY,
    hardware_class_id TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    display_name TEXT NOT NULL,
    seller_name TEXT NOT NULL,
    gpu_model TEXT NOT NULL,
    hardware_tier TEXT NOT NULL CHECK (hardware_tier IN ('CONSUMER','WORKSTATION','DATACENTER')),
    vram_gb INTEGER CHECK (vram_gb IS NULL OR vram_gb>0),
    specs_json TEXT NOT NULL,
    quote_mode TEXT NOT NULL CHECK (quote_mode='QUOTE_REQUIRED'),
    sellable INTEGER NOT NULL DEFAULT 0 CHECK (sellable IN (0,1)),
    currency TEXT CHECK (currency IS NULL OR currency IN ('CNY','USD','HKD','SGD')),
    unit_price_minor INTEGER CHECK (unit_price_minor IS NULL OR unit_price_minor>0),
    card_hour_reference_micros INTEGER CHECK (card_hour_reference_micros IS NULL OR card_hour_reference_micros>=0),
    warranty_months INTEGER CHECK (warranty_months IS NULL OR warranty_months>=0),
    estimated_delivery_days INTEGER CHECK (estimated_delivery_days IS NULL OR estimated_delivery_days>=0),
    fulfillment_modes_json TEXT NOT NULL,
    facility_ids_json TEXT NOT NULL,
    utilization_7d_bps INTEGER CHECK (utilization_7d_bps IS NULL OR utilization_7d_bps BETWEEN 0 AND 10000),
    utilization_30d_bps INTEGER CHECK (utilization_30d_bps IS NULL OR utilization_30d_bps BETWEEN 0 AND 10000),
    quote_valid_until TEXT,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','RETIRED')),
    immutable_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_product_versions_immutable_update
    BEFORE UPDATE ON managed_gpu_product_versions BEGIN SELECT RAISE(ABORT,'managed gpu product version immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_product_versions_immutable_delete
    BEFORE DELETE ON managed_gpu_product_versions BEGIN SELECT RAISE(ABORT,'managed gpu product version immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_facilities (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    country_code TEXT NOT NULL CHECK (length(country_code)=2),
    region TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PLANNED','ACTIVE','SUSPENDED')),
    custody_terms_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
    CHECK(status<>'ACTIVE' OR custody_terms_version<>'PENDING')
  );

CREATE TABLE IF NOT EXISTS managed_gpu_economic_policy_versions (
    id TEXT PRIMARY KEY,
    policy_code TEXT NOT NULL,
    version_number INTEGER NOT NULL CHECK (version_number>0),
    facility_id TEXT NOT NULL,
    facility_charge_micros_per_asset_day INTEGER NOT NULL CHECK (facility_charge_micros_per_asset_day>=0),
    platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 10000),
    wear_reserve_bps INTEGER NOT NULL CHECK (wear_reserve_bps BETWEEN 0 AND 10000),
    calculation_json TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_until TEXT,
    approved_by TEXT NOT NULL,
    immutable_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE(policy_code,version_number),
    FOREIGN KEY(facility_id) REFERENCES managed_gpu_facilities(id),
    CHECK (effective_until IS NULL OR effective_until>effective_from)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_policy_versions_immutable_update
    BEFORE UPDATE ON managed_gpu_economic_policy_versions BEGIN SELECT RAISE(ABORT,'managed gpu policy version immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_policy_versions_immutable_delete
    BEFORE DELETE ON managed_gpu_economic_policy_versions BEGIN SELECT RAISE(ABORT,'managed gpu policy version immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_fee_policy_versions (
    id TEXT PRIMARY KEY,
    policy_code TEXT NOT NULL UNIQUE,
    effective_from TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS managed_gpu_fee_tiers (
    policy_version_id TEXT NOT NULL,
    tier_code TEXT NOT NULL,
    minimum_lifetime_card_hour_micros INTEGER NOT NULL CHECK (minimum_lifetime_card_hour_micros>=0),
    platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 20 AND 100),
    created_at TEXT NOT NULL,
    PRIMARY KEY(policy_version_id,tier_code),
    UNIQUE(policy_version_id,minimum_lifetime_card_hour_micros),
    FOREIGN KEY(policy_version_id) REFERENCES managed_gpu_fee_policy_versions(id)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_fee_policy_immutable_update BEFORE UPDATE ON managed_gpu_fee_policy_versions BEGIN SELECT RAISE(ABORT,'managed gpu fee policy immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_fee_policy_immutable_delete BEFORE DELETE ON managed_gpu_fee_policy_versions BEGIN SELECT RAISE(ABORT,'managed gpu fee policy immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_fee_tiers_immutable_update BEFORE UPDATE ON managed_gpu_fee_tiers BEGIN SELECT RAISE(ABORT,'managed gpu fee tier immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_fee_tiers_immutable_delete BEFORE DELETE ON managed_gpu_fee_tiers BEGIN SELECT RAISE(ABORT,'managed gpu fee tier immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_quotes (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    product_version_id TEXT NOT NULL,
    facility_id TEXT,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
    fulfillment_choice TEXT NOT NULL CHECK (fulfillment_choice IN ('BEIDOU_HOSTING','GLOBAL_SHIPPING')),
    requested_currency TEXT NOT NULL CHECK (requested_currency IN ('CNY','USD','HKD','SGD')),
    destination_country_code TEXT,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED','ISSUED','ACCEPTED','EXPIRED','CANCELLED')),
    unit_amount_minor INTEGER CHECK (unit_amount_minor IS NULL OR unit_amount_minor>0),
    total_amount_minor INTEGER CHECK (total_amount_minor IS NULL OR total_amount_minor>0),
    issued_currency TEXT CHECK (issued_currency IS NULL OR issued_currency IN ('CNY','USD','HKD','SGD')),
    price_breakdown_json TEXT,
    expires_at TEXT,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id,idempotency_key),
    FOREIGN KEY(product_version_id) REFERENCES managed_gpu_product_versions(id),
    FOREIGN KEY(facility_id) REFERENCES managed_gpu_facilities(id),
    CHECK ((fulfillment_choice='BEIDOU_HOSTING' AND facility_id IS NOT NULL AND destination_country_code IS NULL)
      OR (fulfillment_choice='GLOBAL_SHIPPING' AND facility_id IS NULL AND destination_country_code IS NOT NULL)),
    CHECK ((status='REQUESTED' AND unit_amount_minor IS NULL AND total_amount_minor IS NULL AND issued_currency IS NULL AND price_breakdown_json IS NULL AND expires_at IS NULL)
      OR (status<>'REQUESTED' AND unit_amount_minor IS NOT NULL AND total_amount_minor IS NOT NULL AND issued_currency IS NOT NULL AND price_breakdown_json IS NOT NULL AND expires_at IS NOT NULL))
  );

CREATE INDEX IF NOT EXISTS managed_gpu_quotes_org_time_idx ON managed_gpu_quotes(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS managed_gpu_purchase_orders (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    product_version_id TEXT NOT NULL,
    facility_id TEXT,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
    fulfillment_choice TEXT NOT NULL CHECK (fulfillment_choice IN ('BEIDOU_HOSTING','GLOBAL_SHIPPING')),
    currency TEXT NOT NULL CHECK (currency IN ('CNY','USD','HKD','SGD')),
    total_amount_minor INTEGER NOT NULL CHECK (total_amount_minor>0),
    status TEXT NOT NULL CHECK (status IN ('REQUESTED','QUOTED','AWAITING_PAYMENT','PAID','PROCUREMENT','ASSET_ASSIGNED','FULFILLED','CANCELLED','DISPUTED','REFUNDED')),
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id,idempotency_key),
    FOREIGN KEY(quote_id) REFERENCES managed_gpu_quotes(id),
    FOREIGN KEY(product_version_id) REFERENCES managed_gpu_product_versions(id),
    FOREIGN KEY(facility_id) REFERENCES managed_gpu_facilities(id)
  );

CREATE INDEX IF NOT EXISTS managed_gpu_orders_org_time_idx ON managed_gpu_purchase_orders(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS managed_gpu_payment_events (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_reference TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('CAPTURED','REFUNDED','CHARGEBACK','REVERSAL')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor>0),
    currency TEXT NOT NULL CHECK (currency IN ('CNY','USD','HKD','SGD')),
    payload_digest TEXT NOT NULL CHECK (length(payload_digest)=64),
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(provider,provider_reference,event_type),
    FOREIGN KEY(order_id) REFERENCES managed_gpu_purchase_orders(id)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_payment_events_immutable_update BEFORE UPDATE ON managed_gpu_payment_events BEGIN SELECT RAISE(ABORT,'managed gpu payment event immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_payment_events_immutable_delete BEFORE DELETE ON managed_gpu_payment_events BEGIN SELECT RAISE(ABORT,'managed gpu payment event immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_physical_assets (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    unit_index INTEGER NOT NULL CHECK (unit_index>0),
    owner_organization_id TEXT NOT NULL,
    product_version_id TEXT NOT NULL,
    facility_id TEXT,
    serial_fingerprint TEXT NOT NULL UNIQUE,
    acquisition_amount_minor INTEGER NOT NULL CHECK (acquisition_amount_minor>0),
    currency TEXT NOT NULL CHECK (currency IN ('CNY','USD','HKD','SGD')),
    ownership_bps INTEGER NOT NULL DEFAULT 10000 CHECK (ownership_bps=10000),
    agent_binding_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('EXPECTED','RECEIVED','INSPECTING','VERIFIED','INSTALLED','ACTIVE','MAINTENANCE','DRAINING','SHIPPING','DELIVERED','RETIRED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES managed_gpu_purchase_orders(id),
    FOREIGN KEY(product_version_id) REFERENCES managed_gpu_product_versions(id),
    FOREIGN KEY(facility_id) REFERENCES managed_gpu_facilities(id),
    UNIQUE(order_id,unit_index)
  );

CREATE INDEX IF NOT EXISTS managed_gpu_assets_owner_idx ON managed_gpu_physical_assets(owner_organization_id,updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS managed_gpu_assets_agent_binding_unique ON managed_gpu_physical_assets(agent_binding_id) WHERE agent_binding_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS managed_gpu_asset_evidence (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN ('RECEIPT','INSPECTION_STARTED','VERIFICATION','AGENT_BINDING','AGENT_ONLINE','MAINTENANCE','DRAINING','SHIPPING','DELIVERY','RETIREMENT')),
    evidence_digest TEXT NOT NULL CHECK (length(evidence_digest)=64),
    agent_binding_id TEXT,
    recorded_by TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(asset_id,evidence_type,evidence_digest),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id),
    CHECK ((evidence_type IN ('AGENT_BINDING','AGENT_ONLINE') AND agent_binding_id IS NOT NULL) OR evidence_type NOT IN ('AGENT_BINDING','AGENT_ONLINE'))
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_asset_evidence_immutable_update BEFORE UPDATE ON managed_gpu_asset_evidence BEGIN SELECT RAISE(ABORT,'managed gpu asset evidence immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_asset_evidence_immutable_delete BEFORE DELETE ON managed_gpu_asset_evidence BEGIN SELECT RAISE(ABORT,'managed gpu asset evidence immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_asset_drain_attestations (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    agent_binding_id TEXT NOT NULL,
    allocation_count INTEGER NOT NULL CHECK (allocation_count=0),
    process_count INTEGER NOT NULL CHECK (process_count=0),
    evidence_digest TEXT NOT NULL CHECK (length(evidence_digest)=64),
    verified_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id)
  );

CREATE INDEX IF NOT EXISTS managed_gpu_asset_drain_latest_idx ON managed_gpu_asset_drain_attestations(asset_id,verified_at DESC);

CREATE TRIGGER IF NOT EXISTS managed_gpu_drain_attestations_immutable_update BEFORE UPDATE ON managed_gpu_asset_drain_attestations BEGIN SELECT RAISE(ABORT,'managed gpu drain attestation immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_drain_attestations_immutable_delete BEFORE DELETE ON managed_gpu_asset_drain_attestations BEGIN SELECT RAISE(ABORT,'managed gpu drain attestation immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_production_intervals (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    interval_start TEXT NOT NULL,
    interval_end TEXT NOT NULL,
    observed_seconds INTEGER NOT NULL CHECK (observed_seconds>=0),
    verified_gpu_seconds INTEGER NOT NULL CHECK (verified_gpu_seconds>=0),
    effective_gpu_seconds INTEGER NOT NULL CHECK (effective_gpu_seconds>=0),
    energy_wh INTEGER NOT NULL CHECK (energy_wh>=0),
    evidence_digest TEXT NOT NULL,
    source_sequence INTEGER NOT NULL CHECK (source_sequence>0),
    created_at TEXT NOT NULL,
    UNIQUE(asset_id,source_sequence),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id),
    CHECK(interval_end>interval_start)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_production_immutable_update BEFORE UPDATE ON managed_gpu_production_intervals BEGIN SELECT RAISE(ABORT,'managed gpu production interval immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_production_immutable_delete BEFORE DELETE ON managed_gpu_production_intervals BEGIN SELECT RAISE(ABORT,'managed gpu production interval immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_compute_aggregates (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    granularity TEXT NOT NULL CHECK (granularity IN ('HOUR','DAY','MONTH')),
    status TEXT NOT NULL CHECK (status IN ('HOURLY_PROVISIONAL','DAILY_CONFIRMED','MONTHLY_CALCULATED')),
    effective_gpu_seconds INTEGER NOT NULL CHECK (effective_gpu_seconds>=0),
    gross_card_hour_micros INTEGER NOT NULL CHECK (gross_card_hour_micros>=0),
    evidence_digest TEXT NOT NULL CHECK (length(evidence_digest)=64),
    created_at TEXT NOT NULL,
    UNIQUE(asset_id,granularity,period_start,period_end),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id),
    CHECK(period_end>period_start)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_compute_aggregates_immutable_update BEFORE UPDATE ON managed_gpu_compute_aggregates BEGIN SELECT RAISE(ABORT,'managed gpu compute aggregate immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_compute_aggregates_immutable_delete BEFORE DELETE ON managed_gpu_compute_aggregates BEGIN SELECT RAISE(ABORT,'managed gpu compute aggregate immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_compute_sale_events (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    hosting_contract_id TEXT NOT NULL,
    acceptance_event_id TEXT NOT NULL,
    capture_batch_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('CAPTURED','REFUNDED','CHARGEBACK','REVERSAL')),
    accepted_gpu_seconds INTEGER NOT NULL CHECK (accepted_gpu_seconds>0),
    card_hour_micros INTEGER NOT NULL CHECK (card_hour_micros>0),
    source_entry_kind TEXT NOT NULL CHECK (source_entry_kind='MANAGED_GPU_INCOME'),
    source_entry_status TEXT NOT NULL CHECK (source_entry_status='POSTED'),
    payload_digest TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE(capture_batch_id,event_type),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_sale_events_immutable_update BEFORE UPDATE ON managed_gpu_compute_sale_events BEGIN SELECT RAISE(ABORT,'managed gpu compute sale event immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_sale_events_immutable_delete BEFORE DELETE ON managed_gpu_compute_sale_events BEGIN SELECT RAISE(ABORT,'managed gpu compute sale event immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_sale_refund_duplicate_guard BEFORE INSERT ON card_hour_ledger_batches
    WHEN NEW.operation='ORDER_REFUND' AND NEW.status='POSTED' AND json_extract(NEW.metadata_json,'$.sourceSystem')='HOSTING_V2'
      AND EXISTS(SELECT 1 FROM managed_gpu_compute_sale_events sale
        WHERE sale.hosting_contract_id=json_extract(NEW.metadata_json,'$.orderId') AND sale.event_type IN ('REFUNDED','CHARGEBACK','REVERSAL'))
    BEGIN SELECT RAISE(ABORT,'managed gpu sale already reversed'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_sale_refund_evidence_guard BEFORE INSERT ON card_hour_ledger_batches
    WHEN NEW.operation='ORDER_REFUND' AND NEW.status='POSTED' AND json_extract(NEW.metadata_json,'$.sourceSystem')='HOSTING_V2'
      AND EXISTS(SELECT 1 FROM managed_gpu_compute_sale_events sale
        WHERE sale.hosting_contract_id=json_extract(NEW.metadata_json,'$.orderId') AND sale.event_type='CAPTURED')
      AND (length(COALESCE(json_extract(NEW.metadata_json,'$.refundPayloadDigest'),''))<>64
        OR json_extract(NEW.metadata_json,'$.refundPayloadDigest') GLOB '*[^0-9A-Fa-f]*')
    BEGIN SELECT RAISE(ABORT,'managed gpu refund evidence required'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_sale_refund_bridge AFTER INSERT ON card_hour_ledger_batches
    WHEN NEW.operation='ORDER_REFUND' AND NEW.status='POSTED' AND json_extract(NEW.metadata_json,'$.sourceSystem')='HOSTING_V2'
    BEGIN
      INSERT INTO managed_gpu_compute_sale_events(id,asset_id,hosting_contract_id,acceptance_event_id,capture_batch_id,event_type,accepted_gpu_seconds,card_hour_micros,source_entry_kind,source_entry_status,payload_digest,occurred_at,recorded_at)
      SELECT 'mgcse_refund_'||lower(hex(randomblob(16))),sale.asset_id,sale.hosting_contract_id,sale.acceptance_event_id,NEW.id,'REFUNDED',sale.accepted_gpu_seconds,
        CASE WHEN NEW.amount_micros<sale.card_hour_micros THEN NEW.amount_micros ELSE sale.card_hour_micros END,'MANAGED_GPU_INCOME','POSTED',lower(json_extract(NEW.metadata_json,'$.refundPayloadDigest')),NEW.created_at,NEW.created_at
      FROM managed_gpu_compute_sale_events sale
      WHERE sale.hosting_contract_id=json_extract(NEW.metadata_json,'$.orderId') AND sale.event_type='CAPTURED';
    END;

CREATE TABLE IF NOT EXISTS managed_gpu_settlements (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    gross_card_hour_micros INTEGER NOT NULL CHECK (gross_card_hour_micros>=0),
    refund_card_hour_micros INTEGER NOT NULL CHECK (refund_card_hour_micros>=0),
    platform_fee_micros INTEGER NOT NULL CHECK (platform_fee_micros>=0),
    wear_micros INTEGER NOT NULL CHECK (wear_micros>=0),
    facility_charge_micros INTEGER NOT NULL CHECK (facility_charge_micros>=0),
    earned_card_hour_micros INTEGER NOT NULL CHECK (earned_card_hour_micros>=0),
    total_charge_micros INTEGER NOT NULL CHECK (total_charge_micros>=0),
    applied_deduction_micros INTEGER NOT NULL CHECK (applied_deduction_micros>=0),
    shortfall_micros INTEGER NOT NULL CHECK (shortfall_micros>=0),
    net_card_hour_micros INTEGER NOT NULL CHECK (net_card_hour_micros>=0),
    policy_version_id TEXT NOT NULL,
    fee_policy_version_id TEXT NOT NULL,
    fee_tier_code TEXT NOT NULL,
    platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 20 AND 100),
    wear_reserve_bps INTEGER NOT NULL CHECK (wear_reserve_bps IN (500,700,1000)),
    status TEXT NOT NULL CHECK (status='REVIEW_REQUIRED'),
    ledger_entry_id TEXT,
    source_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE(asset_id,period_start,period_end),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id),
    FOREIGN KEY(policy_version_id) REFERENCES managed_gpu_economic_policy_versions(id),
    FOREIGN KEY(fee_policy_version_id,fee_tier_code) REFERENCES managed_gpu_fee_tiers(policy_version_id,tier_code),
    CHECK(period_end>period_start),
    CHECK(earned_card_hour_micros=gross_card_hour_micros-refund_card_hour_micros),
    CHECK(total_charge_micros=platform_fee_micros+wear_micros+facility_charge_micros),
    CHECK(applied_deduction_micros+shortfall_micros=total_charge_micros),
    CHECK(net_card_hour_micros=earned_card_hour_micros-applied_deduction_micros),
    CHECK(status='REVIEW_REQUIRED' AND ledger_entry_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS managed_gpu_settlements_org_time_idx ON managed_gpu_settlements(organization_id,period_end DESC);

CREATE TRIGGER IF NOT EXISTS managed_gpu_settlements_immutable_update BEFORE UPDATE ON managed_gpu_settlements BEGIN SELECT RAISE(ABORT,'managed gpu settlement immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_settlements_immutable_delete BEFORE DELETE ON managed_gpu_settlements BEGIN SELECT RAISE(ABORT,'managed gpu settlement immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_settlement_events (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence>0),
    status TEXT NOT NULL CHECK (status IN ('REVIEW_REQUIRED','READY','APPROVED','POSTED','REVERSED')),
    requested_by TEXT NOT NULL,
    approved_by TEXT,
    approval_id TEXT,
    ledger_batch_id TEXT,
    payload_digest TEXT NOT NULL CHECK (length(payload_digest)=64),
    occurred_at TEXT NOT NULL,
    UNIQUE(settlement_id,sequence),
    FOREIGN KEY(settlement_id) REFERENCES managed_gpu_settlements(id),
    CHECK ((status='REVIEW_REQUIRED' AND approved_by IS NULL AND approval_id IS NULL)
      OR (status<>'REVIEW_REQUIRED' AND approved_by IS NOT NULL AND approval_id IS NOT NULL)),
    CHECK (status='POSTED' OR ledger_batch_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS managed_gpu_settlement_events_current_idx ON managed_gpu_settlement_events(settlement_id,sequence DESC);

CREATE TRIGGER IF NOT EXISTS managed_gpu_settlement_events_immutable_update BEFORE UPDATE ON managed_gpu_settlement_events BEGIN SELECT RAISE(ABORT,'managed gpu settlement event immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_settlement_events_immutable_delete BEFORE DELETE ON managed_gpu_settlement_events BEGIN SELECT RAISE(ABORT,'managed gpu settlement event immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_outstanding_hosting_fees (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    amount_micros INTEGER NOT NULL CHECK (amount_micros>0),
    due_at TEXT NOT NULL,
    automatic_debit_authorization_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(settlement_id) REFERENCES managed_gpu_settlements(id),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id)
  );

CREATE INDEX IF NOT EXISTS managed_gpu_outstanding_fees_org_due_idx ON managed_gpu_outstanding_hosting_fees(organization_id,due_at);

CREATE TRIGGER IF NOT EXISTS managed_gpu_outstanding_fees_immutable_update BEFORE UPDATE ON managed_gpu_outstanding_hosting_fees BEGIN SELECT RAISE(ABORT,'managed gpu outstanding hosting fee immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_outstanding_fees_immutable_delete BEFORE DELETE ON managed_gpu_outstanding_hosting_fees BEGIN SELECT RAISE(ABORT,'managed gpu outstanding hosting fee immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_outstanding_hosting_fee_events (
    id TEXT PRIMARY KEY,
    fee_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence>0),
    status TEXT NOT NULL CHECK (status IN ('PENDING','PAID','OVERDUE')),
    payload_digest TEXT NOT NULL CHECK (length(payload_digest)=64),
    occurred_at TEXT NOT NULL,
    UNIQUE(fee_id,sequence),
    FOREIGN KEY(fee_id) REFERENCES managed_gpu_outstanding_hosting_fees(id)
  );

CREATE TRIGGER IF NOT EXISTS managed_gpu_outstanding_fee_events_immutable_update BEFORE UPDATE ON managed_gpu_outstanding_hosting_fee_events BEGIN SELECT RAISE(ABORT,'managed gpu outstanding fee event immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_outstanding_fee_events_immutable_delete BEFORE DELETE ON managed_gpu_outstanding_hosting_fee_events BEGIN SELECT RAISE(ABORT,'managed gpu outstanding fee event immutable'); END;

CREATE TABLE IF NOT EXISTS managed_gpu_service_requests (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    request_type TEXT NOT NULL CHECK (request_type IN ('GLOBAL_SHIPPING','EXIT_HOSTING')),
    destination_country_code TEXT,
    address_reference TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED','REVIEWING','APPROVED','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED')),
    earliest_execution_at TEXT,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(organization_id,idempotency_key),
    FOREIGN KEY(asset_id) REFERENCES managed_gpu_physical_assets(id),
    CHECK ((request_type='GLOBAL_SHIPPING' AND destination_country_code IS NOT NULL AND address_reference IS NOT NULL)
      OR (request_type='EXIT_HOSTING' AND destination_country_code IS NULL AND address_reference IS NULL)),
    CHECK ((request_type='EXIT_HOSTING' AND earliest_execution_at IS NOT NULL) OR request_type='GLOBAL_SHIPPING')
  );

CREATE INDEX IF NOT EXISTS managed_gpu_service_requests_org_idx ON managed_gpu_service_requests(organization_id,created_at DESC);

CREATE TABLE IF NOT EXISTS managed_gpu_command_receipts (
    organization_id TEXT NOT NULL,
    command_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(organization_id,command_scope,idempotency_key)
  );

CREATE TABLE IF NOT EXISTS managed_gpu_approvals (
    id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL CHECK (action_type IN ('ISSUE_QUOTE','RECORD_PAYMENT_EVIDENCE','TRANSITION_ORDER','CREATE_ASSET','TRANSITION_ASSET','CREATE_SETTLEMENT','TRANSITION_SETTLEMENT','SHIP_ASSET','PUBLISH_PRODUCT_VERSION','ACTIVATE_FACILITY','PUBLISH_ECONOMIC_POLICY')),
    target_id TEXT NOT NULL,
    requester_account_id TEXT NOT NULL,
    requester_organization_id TEXT NOT NULL,
    approver_account_id TEXT,
    payload_hash TEXT NOT NULL CHECK (length(payload_hash)=64),
    command_payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','CONSUMED','REJECTED','EXPIRED')),
    idempotency_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    consumed_at TEXT,
    UNIQUE(requester_organization_id,idempotency_key),
    CHECK (approver_account_id IS NULL OR approver_account_id<>requester_account_id),
    CHECK ((status='REQUESTED' AND approver_account_id IS NULL AND decided_at IS NULL)
      OR (status<>'REQUESTED' AND approver_account_id IS NOT NULL AND decided_at IS NOT NULL)),
    CHECK ((status='CONSUMED' AND consumed_at IS NOT NULL) OR (status<>'CONSUMED' AND consumed_at IS NULL))
  );

CREATE INDEX IF NOT EXISTS managed_gpu_approvals_status_idx ON managed_gpu_approvals(status,requested_at);

CREATE TABLE IF NOT EXISTS managed_gpu_domain_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS managed_gpu_events_entity_idx ON managed_gpu_domain_events(entity_type,entity_id,occurred_at);

CREATE TRIGGER IF NOT EXISTS managed_gpu_events_immutable_update BEFORE UPDATE ON managed_gpu_domain_events BEGIN SELECT RAISE(ABORT,'managed gpu domain event immutable'); END;

CREATE TRIGGER IF NOT EXISTS managed_gpu_events_immutable_delete BEFORE DELETE ON managed_gpu_domain_events BEGIN SELECT RAISE(ABORT,'managed gpu domain event immutable'); END;

INSERT OR IGNORE INTO managed_gpu_product_versions(id,hardware_class_id,sku,manufacturer,model,display_name,seller_name,gpu_model,hardware_tier,vram_gb,specs_json,quote_mode,sellable,currency,unit_price_minor,card_hour_reference_micros,warranty_months,estimated_delivery_days,fulfillment_modes_json,facility_ids_json,utilization_7d_bps,utilization_30d_bps,quote_valid_until,status,immutable_hash,created_at)
    VALUES('MGPU-PV-RTX5090-REFERENCE','NVIDIA_RTX_5090','RTX5090-REFERENCE','NVIDIA','RTX 5090','NVIDIA RTX 5090（询价参考）','待核验供应商','RTX 5090','CONSUMER',NULL,'{"inventory":"UNVERIFIED","pricing":"QUOTE_REQUIRED"}','QUOTE_REQUIRED',0,NULL,NULL,NULL,NULL,NULL,'["GLOBAL_SHIPPING","BEIDOU_HOSTING"]','[]',NULL,NULL,NULL,'ACTIVE','managed-gpu:nvidia:rtx5090:reference:v3','2026-08-26T00:00:00.000Z');

INSERT OR IGNORE INTO managed_gpu_product_versions(id,hardware_class_id,sku,manufacturer,model,display_name,seller_name,gpu_model,hardware_tier,vram_gb,specs_json,quote_mode,sellable,currency,unit_price_minor,card_hour_reference_micros,warranty_months,estimated_delivery_days,fulfillment_modes_json,facility_ids_json,utilization_7d_bps,utilization_30d_bps,quote_valid_until,status,immutable_hash,created_at)
    VALUES('MGPU-PV-RTX6000-REFERENCE','NVIDIA_RTX_6000','RTX6000-REFERENCE','NVIDIA','RTX 6000','NVIDIA RTX 6000（询价参考）','待核验供应商','RTX 6000','WORKSTATION',NULL,'{"inventory":"UNVERIFIED","pricing":"QUOTE_REQUIRED"}','QUOTE_REQUIRED',0,NULL,NULL,NULL,NULL,NULL,'["GLOBAL_SHIPPING","BEIDOU_HOSTING"]','[]',NULL,NULL,NULL,'ACTIVE','managed-gpu:nvidia:rtx6000:reference:v3','2026-08-26T00:00:00.000Z');

INSERT OR IGNORE INTO managed_gpu_facilities(id,code,display_name,country_code,region,timezone,status,custody_terms_version,created_at,updated_at,version)
    VALUES('MGPU-FAC-BEIDOU-REFERENCE','BEIDOU_REFERENCE','北斗机房（待运营验收）','CN','待确认','Asia/Shanghai','PLANNED','PENDING','2026-08-26T00:00:00.000Z','2026-08-26T00:00:00.000Z',1);

INSERT OR IGNORE INTO managed_gpu_fee_policy_versions(id,policy_code,effective_from,approved_by,created_at)
    VALUES('MGPU-FEE-2026-01','MANAGED_GPU_LIFETIME_VOLUME','2026-08-26T00:00:00.000Z','PRODUCT_APPROVED','2026-08-26T00:00:00.000Z');

INSERT OR IGNORE INTO managed_gpu_fee_tiers(policy_version_id,tier_code,minimum_lifetime_card_hour_micros,platform_fee_bps,created_at) VALUES
    ('MGPU-FEE-2026-01','STARTER',0,100,'2026-08-26T00:00:00.000Z'),
    ('MGPU-FEE-2026-01','GROWTH',10000000000,80,'2026-08-26T00:00:00.000Z'),
    ('MGPU-FEE-2026-01','SCALE',50000000000,60,'2026-08-26T00:00:00.000Z'),
    ('MGPU-FEE-2026-01','VOLUME',200000000000,40,'2026-08-26T00:00:00.000Z'),
    ('MGPU-FEE-2026-01','STRATEGIC',1000000000000,20,'2026-08-26T00:00:00.000Z');

INSERT OR IGNORE INTO managed_gpu_schema_migrations(version,applied_at) VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
