export const marketplaceSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS marketplace_requests (
    id TEXT PRIMARY KEY,
    request_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    region TEXT NOT NULL,
    pricing_unit TEXT NOT NULL,
    quantity REAL NOT NULL,
    duration_hours REAL,
    delivery_date TEXT,
    summary TEXT NOT NULL,
    offered_json TEXT,
    wanted_json TEXT,
    cash_direction TEXT NOT NULL,
    cash_amount REAL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_requests_created_idx
    ON marketplace_requests(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS marketplace_quotes (
    id TEXT PRIMARY KEY,
    demand_id TEXT NOT NULL,
    demand_title TEXT NOT NULL,
    unit_price REAL NOT NULL,
    pricing_unit TEXT NOT NULL,
    lead_time TEXT NOT NULL,
    valid_days INTEGER NOT NULL,
    scope_note TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (demand_id) REFERENCES marketplace_requests(id)
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_quotes_demand_idx
    ON marketplace_quotes(demand_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS marketplace_drafts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    capacity TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS marketplace_drafts_created_idx
    ON marketplace_drafts(created_at DESC)`,
] as const;
