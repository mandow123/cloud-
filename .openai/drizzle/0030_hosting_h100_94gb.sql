DROP TABLE IF EXISTS hosting_v2_offers_h100_94gb;
CREATE TABLE hosting_v2_offers_h100_94gb (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  fee_schedule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  gpu_model TEXT NOT NULL CHECK (gpu_model IN ('RTX_4090','H100_80GB','H100_94GB')),
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
);
INSERT INTO hosting_v2_offers_h100_94gb(
  id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,
  card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,
  available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
) SELECT
  id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,
  card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,
  available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
FROM hosting_v2_offers;
DROP TABLE hosting_v2_offers;
ALTER TABLE hosting_v2_offers_h100_94gb RENAME TO hosting_v2_offers;
CREATE INDEX hosting_v2_offers_market_idx
  ON hosting_v2_offers(status,gpu_model,card_hour_micros_per_gpu_hour);
INSERT OR IGNORE INTO hosting_v2_schema_migrations(version,applied_at) VALUES(16,datetime('now'));
