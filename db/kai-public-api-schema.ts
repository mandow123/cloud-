export const KAI_PUBLIC_API_SCHEMA_VERSION = 1;

export const kaiPublicApiSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS kai_public_api_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kai_public_api_verifications (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    organization_reference TEXT NOT NULL,
    resource_reference TEXT NOT NULL,
    product_code TEXT NOT NULL,
    region TEXT NOT NULL,
    specifications_json TEXT NOT NULL,
    device_id TEXT,
    command_id TEXT,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed','revoked')),
    failure_code TEXT,
    failure_message TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(client_id,idempotency_key),
    CHECK((failure_code IS NULL AND failure_message IS NULL) OR (failure_code IS NOT NULL AND failure_message IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS kai_public_api_verification_resource_idx
    ON kai_public_api_verifications(client_id,resource_reference,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS kai_public_api_verification_device_idx
    ON kai_public_api_verifications(client_id,device_id,updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS kai_public_api_challenge_bindings (
    challenge_id TEXT PRIMARY KEY,
    verification_id TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    resource_reference TEXT NOT NULL,
    device_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    registered_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS kai_public_api_challenge_client_idx
    ON kai_public_api_challenge_bindings(client_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS kai_public_api_webhook_outbox (
    delivery_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    verification_id TEXT NOT NULL,
    event_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING','DELIVERED','DEAD')),
    attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
    next_attempt_at TEXT NOT NULL,
    delivered_at TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(verification_id,event_version)
  )`,
  `CREATE INDEX IF NOT EXISTS kai_public_api_outbox_pending_idx
    ON kai_public_api_webhook_outbox(status,next_attempt_at,created_at)`,
  `CREATE TABLE IF NOT EXISTS kai_public_api_audit_events (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS kai_public_api_audit_client_idx
    ON kai_public_api_audit_events(client_id,occurred_at DESC)`,
] as const;
