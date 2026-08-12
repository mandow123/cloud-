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

function holdRecord(row: Row) {
  return {
    id: text(row, "id"), sourceSystem: "HOSTING_V2", orderId: text(row, "order_id"),
    amountMicros: number(row, "amount_micros"), settledMicros: row.settled_micros == null ? null : number(row, "settled_micros"),
    status: text(row, "status"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function trialGrantRecord(row: Row) {
  return {
    id: text(row, "id"), organizationId: text(row, "organization_id"), amountMicros: number(row, "amount_micros"),
    reason: text(row, "reason"), status: text(row, "status"), requestedBy: text(row, "requested_by"),
    approvedBy: row.approved_by == null ? null : text(row, "approved_by"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

export async function createCardHourStore(db: CardHourDatabaseAdapter): Promise<CardHourStore> {
  await db.ensureSchema(cardHourSchemaStatements, CARD_HOUR_SCHEMA_VERSION);
  return {
    async health() {
      const migration = await db.first<{ version: number | null }>("SELECT MAX(version) AS version FROM card_hour_schema_migrations");
      if (Number(migration?.version ?? 0) !== CARD_HOUR_SCHEMA_VERSION) throw new Error("CARD_HOUR_SCHEMA_MISMATCH");
      await db.first("SELECT id FROM card_hour_ledger_batches LIMIT 1");
      await db.first("SELECT id FROM card_hour_ledger_entries LIMIT 1");
      await db.first("SELECT id FROM card_hour_order_holds LIMIT 1");
      return { schemaVersion: CARD_HOUR_SCHEMA_VERSION, integrity: "ok" as const };
    },
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
    async holdHostingOrder(input) {
      const organizationId = input.account.activeOrganization.id;
      const existing = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE source_system='HOSTING_V2' AND order_id=?", [input.orderId]);
      if (existing) {
        if (text(existing, "organization_id") !== organizationId || text(existing, "payload_hash") !== input.payloadHash || number(existing, "amount_micros") !== input.amountMicros) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "订单卡时预留记录不一致。 ");
        return { record: holdRecord(existing), replayed: true };
      }
      const byKey = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE organization_id=? AND idempotency_key=?", [organizationId, input.idempotencyKey]);
      if (byKey) {
        if (text(byKey, "payload_hash") !== input.payloadHash) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识对应了不同的卡时预留。 ");
        return { record: holdRecord(byKey), replayed: true };
      }
      if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros < 1) throw new AccountAuthError("CARD_HOUR_HOLD_INVALID", 400, "预留卡时数量无效。 ");
      const holdId = `chh_${crypto.randomUUID()}`;
      await db.batch([
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId, input.now, input.now] },
        { sql: `INSERT INTO card_hour_order_holds(id,organization_id,account_id,source_system,order_id,amount_micros,settled_micros,status,idempotency_key,payload_hash,created_at,updated_at)
          SELECT ?,?,?, 'HOSTING_V2',?,?,NULL,'HELD',?,?,?,? FROM card_hour_wallets WHERE organization_id=? AND available_micros>=?`, values: [holdId, organizationId, input.account.account.id, input.orderId, input.amountMicros, input.idempotencyKey, input.payloadHash, input.now, input.now, organizationId, input.amountMicros] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros-?,held_micros=held_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_order_holds WHERE id=? AND status='HELD')", values: [input.amountMicros, input.amountMicros, input.now, organizationId, holdId] },
        { sql: "INSERT INTO card_hour_hold_events(id,hold_id,event_type,amount_micros,payload_hash,occurred_at) SELECT ?,?,'HELD',?,?,? WHERE EXISTS(SELECT 1 FROM card_hour_order_holds WHERE id=?)", values: [`chhe_${crypto.randomUUID()}`, holdId, input.amountMicros, input.payloadHash, input.now, holdId] },
      ]);
      const created = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE id=?", [holdId]);
      if (!created) throw new AccountAuthError("CARD_HOUR_BALANCE_INSUFFICIENT", 409, "卡时余额不足，无法锁定本次租用额度。 ");
      return { record: holdRecord(created), replayed: false };
    },

    async settleHostingOrder(input) {
      const organizationId = input.buyerOrganizationId;
      const current = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE source_system='HOSTING_V2' AND order_id=? AND organization_id=?", [input.orderId, organizationId]);
      if (!current) throw new AccountAuthError("CARD_HOUR_HOLD_NOT_FOUND", 409, "订单卡时预留不存在。 ");
      if (text(current, "status") === "SETTLED") {
        const settledEvent = await db.first<Row>("SELECT payload_hash FROM card_hour_hold_events WHERE hold_id=? AND event_type='SETTLED'", [text(current, "id")]);
        if (number(current, "settled_micros") !== input.settledMicros || !settledEvent || text(settledEvent, "payload_hash") !== input.payloadHash) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "订单结算结果与已经入账的记录不一致。 ");
        const attribution = await db.first<Row>("SELECT referrer_organization_id FROM card_hour_referral_attributions WHERE invitee_organization_id=?", [organizationId]);
        return { record: holdRecord(current), referrerOrganizationId: attribution ? text(attribution, "referrer_organization_id") : null, applied: false };
      }
      if (text(current, "status") !== "HELD") throw new AccountAuthError("CARD_HOUR_HOLD_STATE_CONFLICT", 409, "订单卡时已经释放，不能结算。 ");
      const heldMicros = number(current, "amount_micros");
      if (!Number.isSafeInteger(input.settledMicros) || input.settledMicros < 1 || input.settledMicros > heldMicros) throw new AccountAuthError("CARD_HOUR_SETTLEMENT_INVALID", 400, "实际结算卡时必须大于零且不能超过锁定额度。 ");
      if (!Number.isSafeInteger(input.supplierIncomeMicros) || input.supplierIncomeMicros < 1 || input.supplierIncomeMicros > input.settledMicros) throw new AccountAuthError("CARD_HOUR_SETTLEMENT_INVALID", 400, "供应方租金收益金额无效。 ");
      if (!Number.isSafeInteger(input.commissionMicros) || input.commissionMicros < 0 || input.supplierIncomeMicros + input.commissionMicros > input.settledMicros) throw new AccountAuthError("CARD_HOUR_SETTLEMENT_INVALID", 400, "佣金金额与本单结算金额不匹配。 ");
      if (input.supplierOrganizationId === organizationId) throw new AccountAuthError("CARD_HOUR_SETTLEMENT_INVALID", 400, "买方不能向自己的供应主体结算。 ");
      if (!Number.isSafeInteger(input.measuredSeconds) || input.measuredSeconds < 180 || !["BUYER", "TIMEOUT"].includes(input.acceptanceMode) || !Number.isFinite(Date.parse(input.acceptanceDeadlineAt)) || !input.acceptanceActorId.trim() || !input.acceptancePayloadHash.trim()) throw new AccountAuthError("CARD_HOUR_SETTLEMENT_INVALID", 400, "验收决定参数无效。 ");

      const attribution = await db.first<Row>("SELECT referrer_organization_id FROM card_hour_referral_attributions WHERE invitee_organization_id=?", [organizationId]);
      const referrerOrganizationId = attribution ? text(attribution, "referrer_organization_id") : null;
      const commissionMicros = referrerOrganizationId ? input.commissionMicros : 0;
      const holdId = text(current, "id");
      const eventId = `chhe_${crypto.randomUUID()}`;
      const captureBatchId = `chb_${crypto.randomUUID()}`;
      const rentalBatchId = `chb_${crypto.randomUUID()}`;
      const commissionBatchId = `chb_${crypto.randomUUID()}`;
      const releaseMicros = heldMicros - input.settledMicros;
      const statements: CardHourSql[] = [
        { sql: `INSERT INTO hosting_v2_acceptance_proofs(contract_id,decision_mode,acceptance_window_seconds,deadline_at,decided_at,actor_id,payload_digest)
          SELECT c.id,?,COALESCE(CAST(json_extract(c.snapshot_json,'$.acceptanceWindowSeconds') AS INTEGER),1800),?,?,?,?
          FROM hosting_v2_contracts c JOIN hosting_v2_metering_proofs m ON m.contract_id=c.id
          WHERE c.id=? AND c.buyer_organization_id=? AND c.supplier_organization_id=? AND c.status='AWAITING_ACCEPTANCE'
            AND c.measured_seconds=? AND m.server_measured_seconds=? AND c.stopped_at IS NOT NULL
            AND CAST(strftime('%s',?) AS INTEGER)=CAST(strftime('%s',c.stopped_at) AS INTEGER)+COALESCE(CAST(json_extract(c.snapshot_json,'$.acceptanceWindowSeconds') AS INTEGER),1800)
            AND (?='BUYER' OR (?='TIMEOUT' AND CAST(strftime('%s',?) AS INTEGER)>=CAST(strftime('%s',?) AS INTEGER)))`, values: [input.acceptanceMode, input.acceptanceDeadlineAt, input.now, input.acceptanceActorId, input.acceptancePayloadHash, input.orderId, organizationId, input.supplierOrganizationId, input.measuredSeconds, input.measuredSeconds, input.acceptanceDeadlineAt, input.acceptanceMode, input.acceptanceMode, input.now, input.acceptanceDeadlineAt] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: "UPDATE hosting_v2_contracts SET status='SETTLED',accepted_at=?,version=version+1,updated_at=? WHERE id=? AND status='AWAITING_ACCEPTANCE' AND EXISTS(SELECT 1 FROM hosting_v2_acceptance_proofs WHERE contract_id=?)", values: [input.now, input.now, input.orderId, input.orderId] },
        { sql: "INSERT OR IGNORE INTO card_hour_hold_events(id,hold_id,event_type,amount_micros,payload_hash,occurred_at) SELECT ?,?,'SETTLED',?,?,? WHERE EXISTS(SELECT 1 FROM card_hour_order_holds WHERE id=? AND status='HELD') AND EXISTS(SELECT 1 FROM hosting_v2_acceptance_proofs WHERE contract_id=?)", values: [eventId, holdId, input.settledMicros, input.payloadHash, input.now, holdId, input.orderId] },
        { sql: "UPDATE card_hour_order_holds SET settled_micros=?,status='SETTLED',updated_at=? WHERE id=? AND status='HELD' AND EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?) AND EXISTS(SELECT 1 FROM hosting_v2_contracts WHERE id=? AND status='SETTLED')", values: [input.settledMicros, input.now, holdId, eventId, input.orderId] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,held_micros=held_micros-?,lifetime_spent_micros=lifetime_spent_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?) AND EXISTS(SELECT 1 FROM hosting_v2_contracts WHERE id=? AND status='SETTLED')", values: [releaseMicros, heldMicros, input.settledMicros, input.now, organizationId, eventId, input.orderId] },
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'ORDER_CAPTURE',?,?,'POSTED',?,? WHERE EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [captureBatchId, organizationId, `order:HOSTING_V2:${input.orderId}`, input.settledMicros, JSON.stringify({ sourceSystem: "HOSTING_V2", orderId: input.orderId, heldMicros, releasedMicros: releaseMicros }), input.now, eventId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_HELD','DEBIT',?,held_micros,? FROM card_hour_wallets WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, captureBatchId, organizationId, input.settledMicros, input.now, organizationId, captureBatchId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,NULL,'PLATFORM_ORDER_CLEARING','CREDIT',?,NULL,? WHERE EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, captureBatchId, input.settledMicros, input.now, captureBatchId] },
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [input.supplierOrganizationId, input.now, input.now] },
        { sql: "INSERT INTO card_hour_income_accruals(id,organization_id,income_type,source_system,source_id,amount_micros,status,created_at,vested_at) SELECT ?,?,'RENTAL','HOSTING_V2',?,?,'VESTED',?,? WHERE EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [`chi_${crypto.randomUUID()}`, input.supplierOrganizationId, input.orderId, input.supplierIncomeMicros, input.now, input.now, eventId] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [input.supplierIncomeMicros, input.now, input.supplierOrganizationId, eventId] },
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'RENTAL_INCOME',?,?,'POSTED',?,? WHERE EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [rentalBatchId, input.supplierOrganizationId, `rental:HOSTING_V2:${input.orderId}`, input.supplierIncomeMicros, JSON.stringify({ buyerOrganizationId: organizationId, orderId: input.orderId }), input.now, eventId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','CREDIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, rentalBatchId, input.supplierOrganizationId, input.supplierIncomeMicros, input.now, input.supplierOrganizationId, rentalBatchId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,NULL,'PLATFORM_ORDER_CLEARING','DEBIT',?,NULL,? WHERE EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, rentalBatchId, input.supplierIncomeMicros, input.now, rentalBatchId] },
      ];
      if (referrerOrganizationId && commissionMicros > 0) statements.push(
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [referrerOrganizationId, input.now, input.now] },
        { sql: "INSERT INTO card_hour_income_accruals(id,organization_id,income_type,source_system,source_id,amount_micros,status,created_at,vested_at) SELECT ?,?,'COMMISSION','HOSTING_V2',?,?,'VESTED',?,? WHERE EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [`chi_${crypto.randomUUID()}`, referrerOrganizationId, input.orderId, commissionMicros, input.now, input.now, eventId] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [commissionMicros, input.now, referrerOrganizationId, eventId] },
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'COMMISSION_INCOME',?,?,'POSTED',?,? WHERE EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [commissionBatchId, referrerOrganizationId, `commission:HOSTING_V2:${input.orderId}`, commissionMicros, JSON.stringify({ buyerOrganizationId: organizationId, orderId: input.orderId }), input.now, eventId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','CREDIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, commissionBatchId, referrerOrganizationId, commissionMicros, input.now, referrerOrganizationId, commissionBatchId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,NULL,'PLATFORM_COMMISSION_EXPENSE','DEBIT',?,NULL,? WHERE EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, commissionBatchId, commissionMicros, input.now, commissionBatchId] },
      );
      const results = await db.batch(statements);
      const updated = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE id=?", [holdId]);
      if (!updated) throw new Error("CARD_HOUR_HOLD_SETTLEMENT_FAILED");
      if (results[0]?.changes !== 1) throw new AccountAuthError("HOSTING_ACCEPTANCE_CONFLICT", 409, "验收窗口、计量凭证或合同状态已经变化。 ");
      return { record: holdRecord(updated), referrerOrganizationId, applied: results[3]?.changes === 1 };
    },

    async releaseHostingOrder(input) {
      const organizationId = input.account.activeOrganization.id;
      const current = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE source_system='HOSTING_V2' AND order_id=? AND organization_id=?", [input.orderId, organizationId]);
      if (!current) throw new AccountAuthError("CARD_HOUR_HOLD_NOT_FOUND", 409, "订单卡时预留不存在。 ");
      if (text(current, "status") === "RELEASED") return { record: holdRecord(current), applied: false };
      if (text(current, "status") !== "HELD") throw new AccountAuthError("CARD_HOUR_HOLD_STATE_CONFLICT", 409, "订单卡时已经结算，不能释放。 ");
      const amountMicros = number(current, "amount_micros");
      const eventId = `chhe_${crypto.randomUUID()}`;
      const results = await db.batch([
        { sql: "INSERT OR IGNORE INTO card_hour_hold_events(id,hold_id,event_type,amount_micros,payload_hash,occurred_at) SELECT ?,?,'RELEASED',?,?,? WHERE EXISTS(SELECT 1 FROM card_hour_order_holds WHERE id=? AND status='HELD')", values: [eventId, text(current, "id"), amountMicros, input.payloadHash, input.now, text(current, "id")] },
        { sql: "UPDATE card_hour_order_holds SET status='RELEASED',updated_at=? WHERE id=? AND status='HELD' AND EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [input.now, text(current, "id"), eventId] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,held_micros=held_micros-?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_hold_events WHERE id=?)", values: [amountMicros, amountMicros, input.now, organizationId, eventId] },
      ]);
      const updated = await db.first<Row>("SELECT * FROM card_hour_order_holds WHERE id=?", [text(current, "id")]);
      if (!updated) throw new Error("CARD_HOUR_HOLD_RELEASE_FAILED");
      return { record: holdRecord(updated), applied: results[0]?.changes === 1 };
    },
    async listTrialGrants(status) {
      const rows = status
        ? await db.all<Row>("SELECT * FROM card_hour_trial_grants WHERE status=? ORDER BY created_at DESC LIMIT 200", [status])
        : await db.all<Row>("SELECT * FROM card_hour_trial_grants ORDER BY created_at DESC LIMIT 200");
      return rows.map(trialGrantRecord);
    },
    async requestTrialGrant(input) {
      if (!input.organizationId.trim() || !input.requestedBy.trim()) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_INVALID", 400, "试运营卡时申请主体无效。 ");
      if (!Number.isSafeInteger(input.amountMicros) || input.amountMicros < 1_000_000) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_INVALID", 400, "试运营卡时每次至少申请 1 KAI 标准卡时。 ");
      const reason = input.reason.trim();
      if (reason.length < 4 || reason.length > 500) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_INVALID", 400, "请填写 4 至 500 字的试运营用途。 ");
      const existing = await db.first<Row>("SELECT * FROM card_hour_trial_grants WHERE requested_by=? AND idempotency_key=?", [input.requestedBy, input.idempotencyKey]);
      if (existing) {
        if (text(existing, "payload_hash") !== input.payloadHash) throw new AccountAuthError("IDEMPOTENCY_CONFLICT", 409, "同一提交标识对应了不同的试运营卡时申请。 ");
        return trialGrantRecord(existing);
      }
      const grantId = `chtg_${crypto.randomUUID()}`;
      await db.batch([{ sql: `INSERT INTO card_hour_trial_grants(id,organization_id,amount_micros,reason,status,requested_by,approved_by,decision_payload_hash,idempotency_key,payload_hash,created_at,updated_at)
        VALUES(?,?,?,?,'REQUESTED',?,NULL,NULL,?,?,?,?)`, values: [grantId, input.organizationId, input.amountMicros, reason, input.requestedBy, input.idempotencyKey, input.payloadHash, input.now, input.now] }]);
      const created = await db.first<Row>("SELECT * FROM card_hour_trial_grants WHERE id=?", [grantId]);
      if (!created) throw new Error("CARD_HOUR_TRIAL_GRANT_CREATE_FAILED");
      return trialGrantRecord(created);
    },
    async decideTrialGrant(input) {
      const current = await db.first<Row>("SELECT * FROM card_hour_trial_grants WHERE id=?", [input.grantId]);
      if (!current) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_NOT_FOUND", 409, "试运营卡时申请不存在。 ");
      if (text(current, "requested_by") === input.approvedBy) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_DUAL_CONTROL_REQUIRED", 409, "申请人与审批人必须是两位不同的管理员。 ");
      const status = text(current, "status");
      if (status !== "REQUESTED") {
        const expected = input.decision === "APPROVE" ? "POSTED" : "REJECTED";
        if (status !== expected || current.decision_payload_hash == null || text(current, "decision_payload_hash") !== input.payloadHash || text(current, "approved_by") !== input.approvedBy) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_STATE_CONFLICT", 409, "该申请已经由其他审批结果处理。 ");
        return trialGrantRecord(current);
      }
      if (input.decision === "REJECT") {
        const results = await db.batch([{ sql: "UPDATE card_hour_trial_grants SET status='REJECTED',approved_by=?,decision_payload_hash=?,updated_at=? WHERE id=? AND status='REQUESTED'", values: [input.approvedBy, input.payloadHash, input.now, input.grantId] }]);
        const updated = await db.first<Row>("SELECT * FROM card_hour_trial_grants WHERE id=?", [input.grantId]);
        if (!updated) throw new Error("CARD_HOUR_TRIAL_GRANT_DECISION_FAILED");
        if (results[0]?.changes !== 1 && (text(updated, "status") !== "REJECTED" || text(updated, "approved_by") !== input.approvedBy || text(updated, "decision_payload_hash") !== input.payloadHash)) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_STATE_CONFLICT", 409, "该申请已经由其他管理员处理。 ");
        return trialGrantRecord(updated);
      }

      const organizationId = text(current, "organization_id");
      const amountMicros = number(current, "amount_micros");
      const batchId = `chb_${crypto.randomUUID()}`;
      const results = await db.batch([
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) SELECT ?,?,'TOPUP',?,?,'POSTED',?,? WHERE EXISTS(SELECT 1 FROM card_hour_trial_grants WHERE id=? AND status='REQUESTED')", values: [batchId, organizationId, `trial-grant:${input.grantId}`, amountMicros, JSON.stringify({ provider: "TRIAL_GRANT", grantId: input.grantId, requestedBy: text(current, "requested_by"), approvedBy: input.approvedBy }), input.now, input.grantId] },
        { sql: "UPDATE card_hour_trial_grants SET status='POSTED',approved_by=?,decision_payload_hash=?,updated_at=? WHERE id=? AND status='REQUESTED' AND EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [input.approvedBy, input.payloadHash, input.now, input.grantId, batchId] },
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId, input.now, input.now] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,lifetime_topup_micros=lifetime_topup_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [amountMicros, amountMicros, input.now, organizationId, batchId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','CREDIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=? AND EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, batchId, organizationId, amountMicros, input.now, organizationId, batchId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,NULL,'PLATFORM_TRIAL_ISSUANCE','DEBIT',?,NULL,? WHERE EXISTS(SELECT 1 FROM card_hour_ledger_batches WHERE id=?)", values: [`che_${crypto.randomUUID()}`, batchId, amountMicros, input.now, batchId] },
      ]);
      const updated = await db.first<Row>("SELECT * FROM card_hour_trial_grants WHERE id=?", [input.grantId]);
      if (!updated) throw new Error("CARD_HOUR_TRIAL_GRANT_DECISION_FAILED");
      if (results[0]?.changes !== 1 && (text(updated, "status") !== "POSTED" || text(updated, "approved_by") !== input.approvedBy || text(updated, "decision_payload_hash") !== input.payloadHash)) throw new AccountAuthError("CARD_HOUR_TRIAL_GRANT_STATE_CONFLICT", 409, "该申请已经由其他管理员处理。 ");
      return trialGrantRecord(updated);
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
