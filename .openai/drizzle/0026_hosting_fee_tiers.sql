CREATE TABLE IF NOT EXISTS hosting_v2_fee_tiers (
  fee_schedule_id TEXT NOT NULL,
  tier_code TEXT NOT NULL,
  minimum_qualifying_micros INTEGER NOT NULL CHECK (minimum_qualifying_micros >= 0),
  platform_fee_bps INTEGER NOT NULL CHECK (platform_fee_bps BETWEEN 20 AND 100),
  referral_reward_bps INTEGER NOT NULL CHECK (referral_reward_bps BETWEEN 0 AND platform_fee_bps),
  created_at TEXT NOT NULL,
  PRIMARY KEY(fee_schedule_id,tier_code),
  UNIQUE(fee_schedule_id,minimum_qualifying_micros)
);
CREATE TRIGGER IF NOT EXISTS hosting_v2_fee_tier_immutable_update
  BEFORE UPDATE ON hosting_v2_fee_tiers
  BEGIN SELECT RAISE(ABORT, 'hosting fee tier immutable'); END;
CREATE TRIGGER IF NOT EXISTS hosting_v2_fee_tier_immutable_delete
  BEFORE DELETE ON hosting_v2_fee_tiers
  BEGIN SELECT RAISE(ABORT, 'hosting fee tier immutable'); END;

INSERT OR IGNORE INTO hosting_v2_fee_tiers(
  fee_schedule_id,tier_code,minimum_qualifying_micros,platform_fee_bps,referral_reward_bps,created_at
)
SELECT id,'STARTER',0,100,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(100*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'GROWTH',1000000000,80,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(80*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'SCALE',10000000000,60,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(60*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'VOLUME',50000000000,40,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(40*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules
UNION ALL SELECT id,'STRATEGIC',100000000000,20,CASE WHEN platform_fee_bps=0 THEN 0 ELSE CAST(20*referral_reward_bps/platform_fee_bps AS INTEGER) END,created_at FROM hosting_v2_fee_schedules;

INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(12,datetime('now'));
