import { CARD_HOUR_ASSET_CODE } from "../card-hours.ts";
import { CARD_HOUR_SCHEMA_VERSION, cardHourSchemaStatements } from "../../db/card-hour-schema.ts";
import { AccountAuthError, accountAuthDigest } from "./account-auth.ts";
import type { CardHourDashboard, CardHourStore } from "./card-hour-store.ts";

export type CardHourSql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export interface CardHourDatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(items: readonly CardHourSql[]): Promise<Array<{ changes: number }>>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

type Row = Record<string, unknown>;
const number = (row: Row | null, key: string) => Number(row?.[key] ?? 0);
const text = (row: Row, key: string) => String(row[key]);

async function referralCode(organizationId: string) {
  return `KAI${(await accountAuthDigest(organizationId)).slice(0, 10).toUpperCase()}`;
}

function topupRecord(row: Row) {
  return {
    id: text(row, "id"), cardHourMicros: number(row, "card_hour_micros"), amountCents: number(row, "amount_cents"),
    currency: "CNY", status: text(row, "status"), expiresAt: text(row, "expires_at"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function paymentRecord(row: Row) {
  return {
    id: text(row, "id"), sourceSystem: text(row, "source_system"), orderId: text(row, "order_id"),
    amountMicros: number(row, "amount_micros"), cnyReferenceCents: number(row, "cny_reference_cents"), status: text(row, "status"),
    createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

export async function createCardHourStore(db: CardHourDatabaseAdapter): Promise<CardHourStore> {
  await db.ensureSchema(cardHourSchemaStatements, CARD_HOUR_SCHEMA_VERSION);
  return {
    async dashboard(organizationId, now) {
      const code = await referralCode(organizationId);
      await db.batch([
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId, now, now] },
        { sql: "INSERT OR IGNORE INTO card_hour_referral_codes(organization_id,code,created_at) VALUES(?,?,?)", values: [organizationId, code, now] },
      ]);
      const wallet = await db.first<Row>("SELECT * FROM card_hour_wallets WHERE organization_id=?", [organizationId]);
      const topups = await db.all<Row>("SELECT * FROM card_hour_topup_orders WHERE organization_id=? ORDER BY created_at DESC LIMIT 20", [organizationId]);
      const payments = await db.all<Row>("SELECT * FROM card_hour_order_payments WHERE organization_id=? ORDER BY created_at DESC LIMIT 20", [organizationId]);
      const buybacks = await db.all<Row>("SELECT * FROM card_hour_buyback_orders WHERE organization_id=? ORDER BY created_at DESC LIMIT 20", [organizationId]);
      const incomeRows = await db.all<Row>("SELECT income_type,status,COALESCE(SUM(amount_micros),0) AS amount_micros FROM card_hour_income_accruals WHERE organization_id=? GROUP BY income_type,status", [organizationId]);
      const ledger = await db.all<Row>(`SELECT b.operation,b.business_key,e.side,e.amount_micros,e.balance_after_micros,e.created_at
        FROM card_hour_ledger_entries e JOIN card_hour_ledger_batches b ON b.id=e.batch_id
        WHERE e.organization_id=? ORDER BY e.created_at DESC LIMIT 30`, [organizationId]);
      const invited = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM card_hour_referral_attributions WHERE referrer_organization_id=?", [organizationId]);
      const income = { rentalPendingMicros: 0, rentalVestedMicros: 0, commissionPendingMicros: 0, commissionVestedMicros: 0 };
      for (const row of incomeRows) {
        const key = `${text(row, "income_type")}:${text(row, "status")}`;
        const value = number(row, "amount_micros");
        if (key === "RENTAL:PENDING") income.rentalPendingMicros = value;
        if (key === "RENTAL:VESTED") income.rentalVestedMicros = value;
        if (key === "COMMISSION:PENDING") income.commissionPendingMicros = value;
        if (key === "COMMISSION:VESTED") income.commissionVestedMicros = value;
      }
      return {
        assetCode: CARD_HOUR_ASSET_CODE,
        rate: { cardHours: "1", cny: "1.002", topupBlockCardHours: "5", topupBlockCny: "5.01" },
        balance: { availableMicros: number(wallet, "available_micros"), heldMicros: number(wallet, "held_micros"), lifetimeTopupMicros: number(wallet, "lifetime_topup_micros"), lifetimeSpentMicros: number(wallet, "lifetime_spent_micros") },
        topups: topups.map(topupRecord), purchases: payments.map(paymentRecord), buybacks,
        income, referral: { code, invitedOrganizations: Number(invited?.count ?? 0) }, ledger,
      } satisfies CardHourDashboard;
    },
    async createTopup(input) {
      const existing = await db.first<Row>("SELECT * FROM card_hour_topup_orders WHERE organization_id=? AND idempotency_key=?", [input.account.activeOrganization.id, input.idempotencyKey]);
      if (existing) {
        if (text(existing, "payload_hash") !== input.payloadHash) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识对应了不同的充值内容。 ");
        return { record: topupRecord(existing), replayed: true };
      }
      const id = `KAI_CH_${crypto.randomUUID().replaceAll("-", "")}`;
      await db.batch([{ sql: `INSERT INTO card_hour_topup_orders(id,organization_id,account_id,card_hour_micros,amount_cents,currency,provider,status,idempotency_key,payload_hash,provider_transaction_id,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,'CNY','ALIPAY','PENDING',?,?,NULL,?,?,?)`, values: [id, input.account.activeOrganization.id, input.account.account.id, input.cardHourMicros, input.amountCents, input.idempotencyKey, input.payloadHash, input.expiresAt, input.now, input.now] }]);
      const created = await db.first<Row>("SELECT * FROM card_hour_topup_orders WHERE id=?", [id]);
      if (!created) throw new Error("CARD_HOUR_TOPUP_CREATE_FAILED");
      return { record: topupRecord(created), replayed: false };
    },
    async getTopup(orderId) {
      const row = await db.first<Row>("SELECT * FROM card_hour_topup_orders WHERE id=?", [orderId]);
      return row ? { ...topupRecord(row), organizationId: text(row, "organization_id"), accountId: text(row, "account_id"), provider: "ALIPAY", providerTransactionId: row.provider_transaction_id == null ? null : text(row, "provider_transaction_id") } : null;
    },
    async applyTopupEvent(input) {
      if (await db.first<Row>("SELECT id FROM card_hour_topup_events WHERE provider_event_id=?", [input.providerEventId])) return { applied: false };
      const order = await db.first<Row>("SELECT * FROM card_hour_topup_orders WHERE id=?", [input.orderId]);
      if (!order || number(order, "amount_cents") !== input.amountCents) throw new Error("CARD_HOUR_TOPUP_EVENT_MISMATCH");
      if (text(order, "status") !== "PENDING") return { applied: false };
      const organizationId = text(order, "organization_id");
      const amountMicros = number(order, "card_hour_micros");
      const eventId = `chte_${crypto.randomUUID()}`;
      const batchId = `chb_${crypto.randomUUID()}`;
      const nextStatus = input.eventType === "CAPTURED" ? "CAPTURED" : "CLOSED";
      const statements: CardHourSql[] = [
        { sql: "INSERT INTO card_hour_topup_events(id,topup_order_id,provider_event_id,provider_transaction_id,event_type,amount_cents,payload_digest,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?,?)", values: [eventId, input.orderId, input.providerEventId, input.providerTransactionId, input.eventType, input.amountCents, input.payloadDigest, input.occurredAt, input.receivedAt] },
        { sql: "UPDATE card_hour_topup_orders SET status=?,provider_transaction_id=?,updated_at=? WHERE id=? AND status='PENDING'", values: [nextStatus, input.providerTransactionId, input.receivedAt, input.orderId] },
      ];
      if (input.eventType === "CAPTURED") statements.push(
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId, input.receivedAt, input.receivedAt] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,lifetime_topup_micros=lifetime_topup_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS (SELECT 1 FROM card_hour_topup_orders WHERE id=? AND status='CAPTURED' AND provider_transaction_id=?)", values: [amountMicros, amountMicros, input.receivedAt, organizationId, input.orderId, input.providerTransactionId] },
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'TOPUP',?,?,'POSTED',?,? WHERE EXISTS (SELECT 1 FROM card_hour_topup_orders WHERE id=? AND status='CAPTURED' AND provider_transaction_id=?)", values: [batchId, organizationId, `topup:${input.orderId}`, amountMicros, JSON.stringify({ amountCents: input.amountCents, provider: "ALIPAY" }), input.receivedAt, input.orderId, input.providerTransactionId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','CREDIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=?", values: [`che_${crypto.randomUUID()}`, batchId, organizationId, amountMicros, input.receivedAt, organizationId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) VALUES(?,?,NULL,'PLATFORM_ISSUANCE','DEBIT',?,NULL,?)", values: [`che_${crypto.randomUUID()}`, batchId, amountMicros, input.receivedAt] },
      );
      const results = await db.batch(statements);
      return { applied: results[1]?.changes === 1 };
    },
    async captureOrder(input) {
      const organizationId = input.account.activeOrganization.id;
      const existing = await db.first<Row>("SELECT * FROM card_hour_order_payments WHERE source_system=? AND order_id=?", [input.sourceSystem, input.orderId]);
      if (existing) {
        if (text(existing, "organization_id") !== organizationId || text(existing, "payload_hash") !== input.payloadHash) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "订单卡时支付记录不一致。 ");
        return { record: paymentRecord(existing), replayed: true };
      }
      const idempotent = await db.first<Row>("SELECT * FROM card_hour_order_payments WHERE organization_id=? AND idempotency_key=?", [organizationId, input.idempotencyKey]);
      if (idempotent) {
        if (text(idempotent, "payload_hash") !== input.payloadHash) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识对应了不同的订单支付。 ");
        return { record: paymentRecord(idempotent), replayed: true };
      }
      const id = `chp_${crypto.randomUUID()}`;
      const batchId = `chb_${crypto.randomUUID()}`;
      const businessKey = `order:${input.sourceSystem}:${input.orderId}`;
      const rewardMicros = Math.floor(input.amountMicros * 3 / 100);
      await db.batch([
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId, input.now, input.now] },
        { sql: `INSERT INTO card_hour_order_payments(id,organization_id,account_id,source_system,order_id,amount_micros,cny_reference_cents,rate_numerator,rate_denominator,status,idempotency_key,payload_hash,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,501,500,'CAPTURED',?,?,?,? FROM card_hour_wallets WHERE organization_id=? AND available_micros>=?`, values: [id, organizationId, input.account.account.id, input.sourceSystem, input.orderId, input.amountMicros, input.cnyReferenceCents, input.idempotencyKey, input.payloadHash, input.now, input.now, organizationId, input.amountMicros] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros-?,lifetime_spent_micros=lifetime_spent_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS (SELECT 1 FROM card_hour_order_payments WHERE id=?) AND NOT EXISTS (SELECT 1 FROM card_hour_ledger_batches WHERE business_key=?)", values: [input.amountMicros, input.amountMicros, input.now, organizationId, id, businessKey] },
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'ORDER_CAPTURE',?,?,'POSTED',?,? WHERE EXISTS (SELECT 1 FROM card_hour_order_payments WHERE id=?)", values: [batchId, organizationId, businessKey, input.amountMicros, JSON.stringify({ sourceSystem: input.sourceSystem, orderId: input.orderId, cnyReferenceCents: input.cnyReferenceCents }), input.now, id] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','DEBIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=? AND EXISTS (SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, batchId, organizationId, input.amountMicros, input.now, organizationId, batchId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,NULL,'PLATFORM_ORDER_CLEARING','CREDIT',?,NULL,? WHERE EXISTS (SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, batchId, input.amountMicros, input.now, batchId] },
        { sql: `INSERT OR IGNORE INTO card_hour_income_accruals(id,organization_id,income_type,source_system,source_id,amount_micros,status,created_at,vested_at)
          SELECT ?,a.referrer_organization_id,'COMMISSION',?,?,?,'PENDING',?,NULL
          FROM card_hour_referral_attributions a WHERE a.invitee_organization_id=? AND ?>0 AND EXISTS (SELECT 1 FROM card_hour_order_payments WHERE id=?)`, values: [`chi_${crypto.randomUUID()}`, input.sourceSystem, input.orderId, rewardMicros, input.now, organizationId, rewardMicros, id] },
      ]);
      const created = await db.first<Row>("SELECT * FROM card_hour_order_payments WHERE id=?", [id]);
      if (!created) throw new AccountAuthError("CARD_HOUR_BALANCE_INSUFFICIENT", 409, "卡时余额不足，请先购买卡时。 ");
      return { record: paymentRecord(created), replayed: false };
    },
    async attachReferral(input) {
      const code = input.code.trim().toUpperCase();
      if (!/^KAI[A-F0-9]{10}$/u.test(code)) throw new AccountAuthError("REFERRAL_CODE_INVALID", 400, "邀请码格式无效。 ");
      const referrer = await db.first<Row>("SELECT organization_id FROM card_hour_referral_codes WHERE code=?", [code]);
      if (!referrer || text(referrer, "organization_id") === input.account.activeOrganization.id) throw new AccountAuthError("REFERRAL_CODE_INVALID", 400, "邀请码无效或不能邀请自己。 ");
      try {
        await db.batch([{ sql: "INSERT INTO card_hour_referral_attributions(invitee_organization_id,referrer_organization_id,referral_code,created_at) VALUES(?,?,?,?)", values: [input.account.activeOrganization.id, text(referrer, "organization_id"), code, input.now] }]);
      } catch {
        throw new AccountAuthError("REFERRAL_ALREADY_ATTACHED", 409, "当前交易主体已经绑定过邀请关系。 ");
      }
    },
  };
}
