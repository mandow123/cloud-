CREATE TABLE IF NOT EXISTS hosting_v2_lifetime_fee_tiers (
  fee_schedule_id TEXT NOT NULL,
  tier_code TEXT NOT NULL,
  minimum_qualifying_micros INTEGER NOT NULL CHECK (minimum_qualifying_micros >= 0),
  platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 20 AND 100),
  referral_reward_bps INTEGER NOT NULL CHECK (referral_reward_bps BETWEEN 0 AND platform_fee_bps),
  created_at TEXT NOT NULL,
  PRIMARY KEY(fee_schedule_id,tier_code),
  UNIQUE(fee_schedule_id,minimum_qualifying_micros)
);
CREATE TRIGGER IF NOT EXISTS hosting_v2_lifetime_fee_tier_immutable_update
  BEFORE UPDATE ON hosting_v2_lifetime_fee_tiers
  BEGIN SELECT RAISE(ABORT, 'hosting lifetime fee tier immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_lifetime_fee_tier_immutable_delete
  BEFORE DELETE ON hosting_v2_lifetime_fee_tiers
  BEGIN SELECT RAISE(ABORT, 'hosting lifetime fee tier immutable'); END;

INSERT OR IGNORE INTO hosting_v2_lifetime_fee_tiers(
  fee_schedule_id,tier_code,minimum_qualifying_micros,platform_fee_bps,referral_reward_bps,created_at
)
SELECT id,'STARTER',0,100,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(100*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'GROWTH',10000000000,80,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(80*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'SCALE',50000000000,60,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(60*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'VOLUME',200000000000,40,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(40*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'STRATEGIC',1000000000000,20,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(20*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules;

CREATE TABLE IF NOT EXISTS hosting_v2_supplier_fee_volume_events (
  id TEXT PRIMARY KEY,
  supplier_organization_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('SETTLEMENT','REFUND','REVERSAL')),
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
  source_event_id TEXT NOT NULL UNIQUE,
  payload_digest TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hosting_v2_fee_volume_supplier_time_idx
  ON hosting_v2_supplier_fee_volume_events(supplier_organization_id,occurred_at,source_event_id);
CREATE INDEX IF NOT EXISTS hosting_v2_fee_volume_contract_time_idx
  ON hosting_v2_supplier_fee_volume_events(contract_id,occurred_at,source_event_id);
CREATE TRIGGER IF NOT EXISTS hosting_v2_fee_volume_immutable_update
  BEFORE UPDATE ON hosting_v2_supplier_fee_volume_events
  BEGIN SELECT RAISE(ABORT, 'hosting fee volume event immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_fee_volume_immutable_delete
  BEFORE DELETE ON hosting_v2_supplier_fee_volume_events
  BEGIN SELECT RAISE(ABORT, 'hosting fee volume event immutable'); END;

INSERT OR IGNORE INTO hosting_v2_supplier_fee_volume_events(
  id,supplier_organization_id,contract_id,event_type,amount_micros,source_event_id,payload_digest,occurred_at,created_at
)
SELECT 'hfve_settlement_' || e.id,c.supplier_organization_id,c.id,'SETTLEMENT',e.amount_micros,e.id,e.payload_hash,e.occurred_at,e.occurred_at
FROM card_hour_hold_events e
JOIN card_hour_order_holds h ON h.id=e.hold_id AND h.source_system='HOSTING_V2'
JOIN hosting_v2_contracts c ON c.id=h.order_id
WHERE e.event_type='SETTLED';

INSERT OR IGNORE INTO hosting_v2_supplier_fee_volume_events(
  id,supplier_organization_id,contract_id,event_type,amount_micros,source_event_id,payload_digest,occurred_at,created_at
)
SELECT 'hfve_refund_' || released.id,c.supplier_organization_id,c.id,'REFUND',settled.amount_micros,released.id,released.payload_hash,released.occurred_at,released.occurred_at
FROM hosting_v2_dispute_resolution_proposals p
JOIN hosting_v2_contracts c ON c.id=p.contract_id
JOIN card_hour_order_holds h ON h.source_system='HOSTING_V2' AND h.order_id=c.id
JOIN card_hour_hold_events settled ON settled.hold_id=h.id AND settled.event_type='SETTLED'
JOIN card_hour_hold_events released ON released.hold_id=h.id AND released.event_type='RELEASED'
WHERE p.resolution='REFUND' AND p.status='APPLIED';

INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(13,datetime('now'));
INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(3,datetime('now'));
