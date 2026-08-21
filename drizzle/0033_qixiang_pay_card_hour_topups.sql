-- Additive compatibility migration for Qixiang Pay top-up attempts.
-- Apply before deploying an image that can create QIXIANG_PAY top-ups.
-- Rollback is application-only: disable KAI_QIXIANG_PAY_ENABLED before reverting
-- the image; the old application continues to read its ALIPAY rows and ignores
-- these additive provider snapshots.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE card_hour_topup_orders_0033 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  card_hour_micros INTEGER NOT NULL CHECK (card_hour_micros >= 5000000 AND card_hour_micros % 5000000 = 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  provider TEXT NOT NULL CHECK (provider IN ('ALIPAY','QIXIANG_PAY')),
  provider_merchant_ref TEXT,
  provider_payment_type TEXT CHECK (provider_payment_type IS NULL OR provider_payment_type IN ('alipay','wxpay')),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING','PENDING','CAPTURED','CLOSED','RECONCILIATION_REQUIRED')),
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  provider_transaction_id TEXT,
  checkout_url TEXT,
  checkout_created_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (provider, provider_transaction_id),
  CHECK ((provider = 'ALIPAY' AND provider_merchant_ref IS NULL AND provider_payment_type IS NULL)
    OR (provider = 'QIXIANG_PAY' AND provider_merchant_ref IS NOT NULL AND provider_payment_type IS NOT NULL)),
  CHECK ((checkout_url IS NULL AND checkout_created_at IS NULL) OR (checkout_url IS NOT NULL AND checkout_created_at IS NOT NULL))
);

INSERT INTO card_hour_topup_orders_0033(
  id,organization_id,account_id,card_hour_micros,amount_cents,currency,provider,
  provider_merchant_ref,provider_payment_type,status,idempotency_key,payload_hash,
  provider_transaction_id,checkout_url,checkout_created_at,expires_at,created_at,updated_at
)
SELECT id,organization_id,account_id,card_hour_micros,amount_cents,currency,provider,
  NULL,NULL,status,idempotency_key,payload_hash,provider_transaction_id,NULL,NULL,expires_at,created_at,updated_at
FROM card_hour_topup_orders;

DROP TABLE card_hour_topup_orders;
ALTER TABLE card_hour_topup_orders_0033 RENAME TO card_hour_topup_orders;
CREATE INDEX card_hour_topups_org_time_idx ON card_hour_topup_orders(organization_id, created_at DESC);

COMMIT;
PRAGMA foreign_keys = ON;
