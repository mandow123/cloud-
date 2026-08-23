export const kaiPublicApiCommandSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS kai_public_api_command_receipts (
    client_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(client_id,idempotency_key)
  )`,
] as const;
