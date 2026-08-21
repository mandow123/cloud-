-- Additive compatibility migration for Qixiang Pay top-up attempts.
-- Apply before deploying an image that can create QIXIANG_PAY top-ups.
-- Rollback is application-only: disable KAI_QIXIANG_PAY_ENABLED before reverting
-- the image; the old application continues to read its ALIPAY rows and ignores
-- these additive provider snapshots.
-- D1 migrations are executed by Wrangler inside its migration transaction.
-- Defer the existing event foreign key until the replacement parent table has
-- been renamed into place; explicit transaction and foreign_keys pragmas are
-- intentionally absent because D1 rejects them in migration files.
PRAGMA defer_foreign_keys = ON;

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

-- D1 enforces the child foreign key at every statement boundary even while the
-- migration is being applied. Rebuild the sole child table in the same
-- migration so the old child can be removed before its parent is replaced.
CREATE TABLE card_hour_topup_events_0033 (
  id TEXT PRIMARY KEY,
  topup_order_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_transaction_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('CAPTURED','CLOSED')),
  amount_cents INTEGER NOT NULL,
  payload_digest TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (topup_order_id) REFERENCES card_hour_topup_orders_0033(id)
);

INSERT INTO card_hour_topup_events_0033(
  id,topup_order_id,provider_event_id,provider_transaction_id,event_type,
  amount_cents,payload_digest,occurred_at,received_at
)
SELECT id,topup_order_id,provider_event_id,provider_transaction_id,event_type,
  amount_cents,payload_digest,occurred_at,received_at
FROM card_hour_topup_events;

DROP TABLE card_hour_topup_events;
DROP TABLE card_hour_topup_orders;
ALTER TABLE card_hour_topup_orders_0033 RENAME TO card_hour_topup_orders;
ALTER TABLE card_hour_topup_events_0033 RENAME TO card_hour_topup_events;
CREATE INDEX card_hour_topups_org_time_idx ON card_hour_topup_orders(organization_id, created_at DESC);
