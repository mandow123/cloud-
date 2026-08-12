export const HOSTING_V2_SCHEMA_VERSION = 10;

export const hostingV2SchemaStatements = [
  `CREATE TABLE IF NOT EXISTS hosting_v2_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_supplier_profiles (
    organization_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    supplier_type TEXT NOT NULL CHECK (supplier_type IN ('INDIVIDUAL','COMPANY','IDC','CLOUD_VENDOR')),
    legal_display_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    agreement_version TEXT,
    evidence_digest TEXT,
    review_note TEXT,
    status TEXT NOT NULL CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUSPENDED')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_agent_challenges (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    minimum_agent_version TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_challenge_org_idx ON hosting_v2_agent_challenges(organization_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_agent_registrations (
    challenge_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    registered_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_agent_registrations_org_idx ON hosting_v2_agent_registrations(organization_id, registered_at DESC)`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_agent_registration_immutable_update BEFORE UPDATE ON hosting_v2_agent_registrations BEGIN SELECT RAISE(ABORT, 'hosting agent registration immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_agent_registration_immutable_delete BEFORE DELETE ON hosting_v2_agent_registrations BEGIN SELECT RAISE(ABORT, 'hosting agent registration immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_devices (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    device_key_id TEXT NOT NULL UNIQUE,
    device_public_key TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    inventory_json TEXT NOT NULL,
    inventory_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ONLINE','VERIFYING','VERIFIED','BUSY','DRAINING','OFFLINE','REVOKED')),
    verification_status TEXT NOT NULL CHECK (verification_status IN ('NOT_RUN','PENDING','PASSED','FAILED','EXPIRED')),
    verification_evidence_digest TEXT,
    verified_until TEXT,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_devices_org_idx ON hosting_v2_devices(organization_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_agent_heartbeats (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    inventory_digest TEXT NOT NULL,
    capacity_state TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    UNIQUE(device_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_fee_schedules (
    id TEXT PRIMARY KEY,
    platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 0 AND 5000),
    referral_reward_bps INTEGER NOT NULL CHECK (referral_reward_bps BETWEEN 0 AND platform_fee_bps),
    status TEXT NOT NULL CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
    effective_from TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS hosting_v2_one_active_fee ON hosting_v2_fee_schedules(status) WHERE status='ACTIVE'`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_offers (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    fee_schedule_id TEXT NOT NULL,
    title TEXT NOT NULL,
    gpu_model TEXT NOT NULL CHECK (gpu_model IN ('RTX_4090','H100_80GB')),
    region TEXT NOT NULL,
    card_hour_micros_per_gpu_hour INTEGER NOT NULL CHECK (card_hour_micros_per_gpu_hour > 0),
    min_rental_seconds INTEGER NOT NULL CHECK (min_rental_seconds >= 180),
    max_rental_seconds INTEGER NOT NULL CHECK (max_rental_seconds >= min_rental_seconds),
    available_from TEXT NOT NULL,
    available_until TEXT NOT NULL,
    approved_image TEXT NOT NULL,
    terms_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RESERVED','PAUSED','UNLISTED','SUSPENDED')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_offers_market_idx ON hosting_v2_offers(status, gpu_model, card_hour_micros_per_gpu_hour)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_contracts (
    id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    buyer_organization_id TEXT NOT NULL,
    buyer_account_id TEXT NOT NULL,
    supplier_organization_id TEXT NOT NULL,
    fee_schedule_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    reserved_seconds INTEGER NOT NULL,
    measured_seconds INTEGER,
    held_micros INTEGER NOT NULL,
    settled_micros INTEGER,
    supplier_income_micros INTEGER,
    commission_micros INTEGER,
    status TEXT NOT NULL CHECK (status IN ('RESERVED','CARD_HOURS_HELD','PAID','PROVISIONING','READY','IN_SERVICE','AWAITING_ACCEPTANCE','SETTLED','CLEANING','CLEANED','CANCELLED','FAILED','DISPUTED','REFUNDED')),
    ssh_public_key_fingerprint TEXT,
    endpoint_display TEXT,
    started_at TEXT,
    stopped_at TEXT,
    accepted_at TEXT,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(buyer_organization_id, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_contracts_buyer_idx ON hosting_v2_contracts(buyer_organization_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_contracts_supplier_idx ON hosting_v2_contracts(supplier_organization_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_instances (
    contract_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    provision_command_id TEXT NOT NULL UNIQUE,
    approved_image TEXT NOT NULL,
    endpoint_display TEXT NOT NULL,
    container_digest TEXT NOT NULL,
    workspace_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('READY','RUNNING','STOPPED','CLEANED','FAILED')),
    provision_evidence_digest TEXT NOT NULL,
    start_evidence_digest TEXT,
    stop_evidence_digest TEXT,
    provisioned_at TEXT NOT NULL,
    started_at TEXT,
    stopped_at TEXT,
    cleaned_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_instances_device_idx ON hosting_v2_instances(device_id, status, updated_at DESC)`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_instance_identity_immutable BEFORE UPDATE ON hosting_v2_instances
    WHEN OLD.contract_id<>NEW.contract_id OR OLD.device_id<>NEW.device_id OR OLD.provision_command_id<>NEW.provision_command_id
      OR OLD.approved_image<>NEW.approved_image OR OLD.endpoint_display<>NEW.endpoint_display
      OR OLD.container_digest<>NEW.container_digest OR OLD.workspace_digest<>NEW.workspace_digest
      OR OLD.provision_evidence_digest<>NEW.provision_evidence_digest OR OLD.provisioned_at<>NEW.provisioned_at
    BEGIN SELECT RAISE(ABORT, 'hosting instance identity immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_metering_proofs (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL UNIQUE,
    command_id TEXT NOT NULL UNIQUE,
    container_digest TEXT NOT NULL,
    runtime_state_digest TEXT NOT NULL,
    agent_started_at TEXT NOT NULL,
    agent_stopped_at TEXT NOT NULL,
    agent_runtime_seconds INTEGER NOT NULL CHECK (agent_runtime_seconds >= 0),
    server_measured_seconds INTEGER NOT NULL CHECK (server_measured_seconds >= 180),
    evidence_digest TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_metering_proofs_immutable_update BEFORE UPDATE ON hosting_v2_metering_proofs BEGIN SELECT RAISE(ABORT, 'hosting metering proof immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_metering_proofs_immutable_delete BEFORE DELETE ON hosting_v2_metering_proofs BEGIN SELECT RAISE(ABORT, 'hosting metering proof immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_cleanup_proofs (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL UNIQUE,
    command_id TEXT NOT NULL UNIQUE,
    container_digest TEXT NOT NULL,
    cleanup_digest TEXT NOT NULL,
    container_removed INTEGER NOT NULL CHECK (container_removed = 1),
    authorized_key_removed INTEGER NOT NULL CHECK (authorized_key_removed = 1),
    workspace_removed INTEGER NOT NULL CHECK (workspace_removed = 1),
    evidence_digest TEXT NOT NULL,
    cleaned_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_cleanup_proofs_immutable_update BEFORE UPDATE ON hosting_v2_cleanup_proofs BEGIN SELECT RAISE(ABORT, 'hosting cleanup proof immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_cleanup_proofs_immutable_delete BEFORE DELETE ON hosting_v2_cleanup_proofs BEGIN SELECT RAISE(ABORT, 'hosting cleanup proof immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_agent_commands (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    contract_id TEXT,
    command_type TEXT NOT NULL CHECK (command_type IN ('VERIFY','PROVISION','START','STOP','CLEANUP')),
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING','DELIVERED','SUCCEEDED','FAILED')),
    attempt INTEGER NOT NULL DEFAULT 0,
    evidence_digest TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_commands_device_idx ON hosting_v2_agent_commands(device_id, status, created_at)`,
  `DROP INDEX IF EXISTS hosting_v2_commands_contract_stop_unique`,
  `CREATE UNIQUE INDEX IF NOT EXISTS hosting_v2_commands_contract_stop_active_unique ON hosting_v2_agent_commands(contract_id, command_type) WHERE contract_id IS NOT NULL AND command_type='STOP' AND status IN ('PENDING','DELIVERED')`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_terminal_command_immutable BEFORE UPDATE ON hosting_v2_agent_commands
    WHEN OLD.status IN ('SUCCEEDED','FAILED')
    BEGIN SELECT RAISE(ABORT, 'hosting terminal command immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_command_immutable_delete BEFORE DELETE ON hosting_v2_agent_commands BEGIN SELECT RAISE(ABORT, 'hosting command immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_delivery_failures (
    command_id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL UNIQUE,
    failure_stage TEXT NOT NULL CHECK (failure_stage IN ('PROVISION','START')),
    error_code TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('RECORDED','REFUNDED','CLEANING','CLEANED')),
    refund_payload_hash TEXT,
    refund_applied_at TEXT,
    cleanup_command_id TEXT,
    cleanup_queued_at TEXT,
    cleaned_at TEXT,
    failed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_delivery_failures_status_idx ON hosting_v2_delivery_failures(status,failed_at)`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_delivery_failure_identity_immutable BEFORE UPDATE ON hosting_v2_delivery_failures
    WHEN OLD.command_id<>NEW.command_id OR OLD.contract_id<>NEW.contract_id OR OLD.failure_stage<>NEW.failure_stage
      OR OLD.error_code<>NEW.error_code OR OLD.evidence_digest<>NEW.evidence_digest OR OLD.failed_at<>NEW.failed_at
    BEGIN SELECT RAISE(ABORT, 'hosting delivery failure identity immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_delivery_failure_transition_guard BEFORE UPDATE ON hosting_v2_delivery_failures
    WHEN NOT (
      (OLD.status='RECORDED' AND NEW.status='REFUNDED' AND NEW.refund_payload_hash IS NOT NULL AND NEW.refund_applied_at IS NOT NULL)
      OR (OLD.status='REFUNDED' AND NEW.status='CLEANING' AND NEW.cleanup_command_id IS NOT NULL AND NEW.cleanup_queued_at IS NOT NULL)
      OR (OLD.status='CLEANING' AND NEW.status='CLEANED' AND NEW.cleaned_at IS NOT NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'hosting delivery failure transition invalid'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_delivery_failure_immutable_delete BEFORE DELETE ON hosting_v2_delivery_failures BEGIN SELECT RAISE(ABORT, 'hosting delivery failure immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_stop_failures (
    command_id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    retry_sequence INTEGER NOT NULL CHECK (retry_sequence >= 1),
    error_code TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('RECORDED','RETRYING','RETRY_FAILED','RECOVERED','EXHAUSTED')),
    recovery_command_id TEXT UNIQUE,
    recovery_queued_at TEXT,
    resolved_at TEXT,
    failed_at TEXT NOT NULL,
    UNIQUE(contract_id,retry_sequence)
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_stop_failures_status_idx ON hosting_v2_stop_failures(status,failed_at)`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_stop_failure_identity_immutable BEFORE UPDATE ON hosting_v2_stop_failures
    WHEN OLD.command_id<>NEW.command_id OR OLD.contract_id<>NEW.contract_id OR OLD.retry_sequence<>NEW.retry_sequence
      OR OLD.error_code<>NEW.error_code OR OLD.evidence_digest<>NEW.evidence_digest OR OLD.failed_at<>NEW.failed_at
    BEGIN SELECT RAISE(ABORT, 'hosting stop failure identity immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_stop_failure_transition_guard BEFORE UPDATE ON hosting_v2_stop_failures
    WHEN NOT (
      (OLD.status='RECORDED' AND NEW.status='RETRYING' AND NEW.recovery_command_id IS NOT NULL AND NEW.recovery_queued_at IS NOT NULL)
      OR (OLD.status='RECORDED' AND NEW.status='EXHAUSTED' AND NEW.resolved_at IS NOT NULL)
      OR (OLD.status='RETRYING' AND NEW.status IN ('RETRY_FAILED','RECOVERED') AND NEW.resolved_at IS NOT NULL)
      OR (OLD.status='EXHAUSTED' AND NEW.status='RETRYING' AND NEW.recovery_command_id IS NOT NULL AND NEW.recovery_queued_at IS NOT NULL AND NEW.resolved_at IS NULL)
    )
    BEGIN SELECT RAISE(ABORT, 'hosting stop failure transition invalid'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_stop_failure_immutable_delete BEFORE DELETE ON hosting_v2_stop_failures BEGIN SELECT RAISE(ABORT, 'hosting stop failure immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_verification_proofs (
    command_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    agent_evidence_digest TEXT NOT NULL,
    control_plane_reachability_digest TEXT NOT NULL,
    public_host TEXT NOT NULL,
    public_port INTEGER NOT NULL CHECK (public_port BETWEEN 1024 AND 65535),
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_verification_proofs_immutable_update BEFORE UPDATE ON hosting_v2_verification_proofs BEGIN SELECT RAISE(ABORT, 'hosting verification proof immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_verification_proofs_immutable_delete BEFORE DELETE ON hosting_v2_verification_proofs BEGIN SELECT RAISE(ABORT, 'hosting verification proof immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_events (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_events_entity_idx ON hosting_v2_events(entity_type, entity_id, occurred_at)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_acceptance_proofs (
    contract_id TEXT PRIMARY KEY,
    decision_mode TEXT NOT NULL CHECK (decision_mode IN ('BUYER','TIMEOUT')),
    acceptance_window_seconds INTEGER NOT NULL CHECK (acceptance_window_seconds >= 0),
    deadline_at TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_acceptance_proofs_immutable_update BEFORE UPDATE ON hosting_v2_acceptance_proofs BEGIN SELECT RAISE(ABORT, 'hosting acceptance proof immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_acceptance_proofs_immutable_delete BEFORE DELETE ON hosting_v2_acceptance_proofs BEGIN SELECT RAISE(ABORT, 'hosting acceptance proof immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_disputes (
    contract_id TEXT PRIMARY KEY,
    buyer_organization_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    opened_by TEXT NOT NULL,
    opened_at TEXT NOT NULL
  )`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_disputes_immutable_update BEFORE UPDATE ON hosting_v2_disputes BEGIN SELECT RAISE(ABORT, 'hosting dispute immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_disputes_immutable_delete BEFORE DELETE ON hosting_v2_disputes BEGIN SELECT RAISE(ABORT, 'hosting dispute immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_dispute_resolution_proposals (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    proposal_version INTEGER NOT NULL CHECK (proposal_version >= 1),
    resolution TEXT NOT NULL CHECK (resolution IN ('REFUND','SETTLE')),
    request_reason TEXT NOT NULL,
    evidence_digest TEXT,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','APPLIED')),
    decided_by TEXT,
    decision_reason TEXT,
    decision_payload_hash TEXT,
    execution_payload_hash TEXT,
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE(contract_id,proposal_version)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS hosting_v2_one_pending_dispute_proposal ON hosting_v2_dispute_resolution_proposals(contract_id) WHERE status='REQUESTED'`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_dispute_proposals_contract_idx ON hosting_v2_dispute_resolution_proposals(contract_id,proposal_version DESC)`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_dispute_proposal_identity_immutable BEFORE UPDATE ON hosting_v2_dispute_resolution_proposals
    WHEN OLD.id<>NEW.id OR OLD.contract_id<>NEW.contract_id OR OLD.proposal_version<>NEW.proposal_version OR OLD.resolution<>NEW.resolution
      OR OLD.request_reason<>NEW.request_reason OR COALESCE(OLD.evidence_digest,'')<>COALESCE(NEW.evidence_digest,'')
      OR OLD.requested_by<>NEW.requested_by OR OLD.requested_at<>NEW.requested_at
    BEGIN SELECT RAISE(ABORT, 'hosting dispute proposal identity immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_dispute_proposal_status_guard BEFORE UPDATE ON hosting_v2_dispute_resolution_proposals
    WHEN NOT (
      OLD.status='REQUESTED' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.decided_by IS NOT NULL AND NEW.decision_reason IS NOT NULL AND NEW.decision_payload_hash IS NOT NULL AND NEW.decided_at IS NOT NULL
      OR OLD.status='APPROVED' AND NEW.status='APPLIED' AND NEW.execution_payload_hash IS NOT NULL
    )
    BEGIN SELECT RAISE(ABORT, 'hosting dispute proposal status transition invalid'); END`,
  `CREATE TRIGGER IF NOT EXISTS hosting_v2_dispute_proposals_immutable_delete BEFORE DELETE ON hosting_v2_dispute_resolution_proposals BEGIN SELECT RAISE(ABORT, 'hosting dispute proposal immutable'); END`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_command_receipts (
    actor_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_card_hour_holds (
    contract_id TEXT PRIMARY KEY,
    buyer_organization_id TEXT NOT NULL,
    held_micros INTEGER NOT NULL CHECK (held_micros > 0),
    captured_micros INTEGER CHECK (captured_micros >= 0 AND captured_micros <= held_micros),
    released_micros INTEGER CHECK (released_micros >= 0 AND released_micros <= held_micros),
    status TEXT NOT NULL CHECK (status IN ('HELD','CAPTURED','RELEASED','REFUNDED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_card_hour_events (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('HOLD','CAPTURE','RELEASE','REFUND','RENTAL_INCOME','COMMISSION_INCOME')),
    amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
    business_key TEXT NOT NULL UNIQUE,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_card_events_org_idx ON hosting_v2_card_hour_events(organization_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS hosting_v2_income_entries (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    income_type TEXT NOT NULL CHECK (income_type IN ('RENTAL','COMMISSION')),
    amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
    status TEXT NOT NULL CHECK (status IN ('PENDING','VESTED','REVERSED')),
    business_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    vested_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS hosting_v2_income_org_idx ON hosting_v2_income_entries(organization_id, status, created_at DESC)`,
] as const;
