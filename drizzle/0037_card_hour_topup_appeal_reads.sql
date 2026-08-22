-- Organization-scoped read receipts for in-product appeal updates. This
-- migration does not change payments, wallets, ledgers, refunds, or providers.
CREATE TABLE IF NOT EXISTS card_hour_topup_appeal_member_reads (
  appeal_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  seen_version INTEGER NOT NULL CHECK (seen_version > 0),
  seen_at TEXT NOT NULL,
  FOREIGN KEY (appeal_id) REFERENCES card_hour_topup_appeals(id)
);
CREATE INDEX IF NOT EXISTS card_hour_topup_appeal_member_reads_org_idx ON card_hour_topup_appeal_member_reads(organization_id,seen_at DESC);
INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(5,datetime('now'));
