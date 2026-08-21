import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createD1CardHourStore } from "../lib/server/card-hour-store-d1.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { createQixiangPayCheckout, qixiangPayReadiness, trustedQixiangClientIp, validateQixiangPayCheckout, verifyQixiangPayNotification } from "../lib/server/qixiang-pay.ts";
import { assertQixiangCardHourSchemaReady, verifyQixiangCardHourDatabase } from "../scripts/ops/verify-qixiang-card-hour-schema.mjs";

const KEY = "fixture-secret-key-1234567890";
const environment = {
  KAI_QIXIANG_PAY_ENABLED: "1", KAI_QIXIANG_PAY_PID: "10086", KAI_QIXIANG_PAY_KEY: KEY,
  KAI_QIXIANG_PAY_CHANNELS: "ALIPAY,WXPAY", KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
  KAI_QIXIANG_PAY_GATEWAY: "https://api.payqixiang.cn/mapi.php", KAI_TRUST_PROXY: "1",
};
const account = {
  account: { id: "acct-qixiang", displayName: "Buyer", primaryEmail: null, status: "ACTIVE" },
  activeOrganization: { id: "org-qixiang", name: "Buyer Org", externalKey: "BUYER", status: "ACTIVE" },
  membership: { id: "mbr-qixiang", accountId: "acct-qixiang", organizationId: "org-qixiang", status: "ACTIVE", roles: [] },
  sessionId: "session-qixiang", authMethod: "EMAIL_OTP",
};

function signature(parameters) {
  const canonical = Object.entries(parameters).filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}=${value}`).join("&");
  return createHash("md5").update(`${canonical}${KEY}`, "utf8").digest("hex");
}

test("Qixiang checkout requires an explicit enabled channel and trusted proxy IP", async () => {
  assert.equal(qixiangPayReadiness(environment).canCreatePayment, true);
  assert.equal(trustedQixiangClientIp(new Request("https://cloud.kai.com", { headers: { "x-forwarded-for": "203.0.113.7" } }), environment), "203.0.113.7");
  assert.throws(() => trustedQixiangClientIp(new Request("https://cloud.kai.com", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }), environment), /来源地址无效/u);
  let submitted;
  const result = await createQixiangPayCheckout({ orderId: `KAI_CH_${"a".repeat(32)}`, amountCents: 501, subject: "KAI Cloud 充值 5.00 KAI 标准卡时", channel: "WXPAY", clientIp: "203.0.113.7", returnPath: `/member/card-hours/topups/KAI_CH_${"a".repeat(32)}/return` }, environment, async (_url, init) => {
    submitted = Object.fromEntries(new URLSearchParams(init.body));
    return new Response(JSON.stringify({ code: 1, payurl: "https://api.payqixiang.cn/cashier/fixture-token" }), { status: 200 });
  });
  assert.equal(result.channel, "WXPAY");
  assert.equal(submitted.type, "wxpay");
  assert.equal(submitted.clientip, "203.0.113.7");
  assert.match(submitted.return_url, /\/member\/card-hours\/topups\/KAI_CH_/u);
  assert.equal(submitted.sign, signature(submitted));
  assert.doesNotMatch(JSON.stringify(submitted), new RegExp(KEY, "u"));
});

test("signed callbacks remain verifiable after checkout is disabled and reject protocol extensions", async () => {
  const fields = {
    pid: "10086", trade_no: "TRADE_fixture_1234", out_trade_no: `KAI_CH_${"b".repeat(32)}`, type: "alipay",
    name: "KAI Cloud 充值 5.00 KAI 标准卡时", money: "5.01", trade_status: "TRADE_SUCCESS", param: `KAI_CH_${"b".repeat(32)}`, sign_type: "MD5",
  };
  fields.sign = signature(fields);
  const query = new URLSearchParams(fields);
  const event = await verifyQixiangPayNotification(query, query.toString(), { ...environment, KAI_QIXIANG_PAY_ENABLED: "0", KAI_QIXIANG_PAY_CHANNELS: "" });
  assert.equal(event.amountCents, 501);
  assert.equal(event.productName, fields.name);
  assert.equal(event.merchantParam, fields.param);
  const extended = new URLSearchParams(query); extended.set("unexpected", "1"); extended.set("sign", signature(Object.fromEntries(extended)));
  await assert.rejects(verifyQixiangPayNotification(extended, extended.toString(), environment), (error) => error.code === "QIXIANG_PAY_NOTIFICATION_INVALID");
  const duplicate = new URLSearchParams(query); duplicate.append("money", "5.01");
  await assert.rejects(verifyQixiangPayNotification(duplicate, duplicate.toString(), environment), (error) => error.code === "QIXIANG_PAY_NOTIFICATION_INVALID");
});

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  execute(mode) {
    const statement = this.database.prepare(this.sql);
    if (mode === "first") return statement.get(...this.values) ?? null;
    if (mode === "all") return statement.all(...this.values);
    const result = statement.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute("run"); }
  async all() { return { results: this.execute("all"), success: true, meta: { changes: 0 } }; }
  async first() { return this.execute("first"); }
}
class D1Database {
  constructor() { this.database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true }); }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try { const results = statements.map((statement) => statement.execute("run")); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

async function assertIdempotentQixiangCredit(store) {
  const created = await store.createTopup({ account, provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "alipay", cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: `qixiang-${crypto.randomUUID()}`, payloadHash: "qixiang-payload", now: "2026-08-21T00:00:00Z", expiresAt: "2026-08-21T00:15:00Z" });
  const claim = await store.claimTopupCheckout({ organizationId: "org-qixiang", orderId: created.record.id, now: "2026-08-21T00:00:01Z" });
  assert.equal(claim.claimed, true);
  const attached = await store.attachTopupCheckout({ organizationId: "org-qixiang", orderId: created.record.id, checkoutUrl: "https://api.payqixiang.cn/cashier/private-token", now: "2026-08-21T00:00:02Z" });
  assert.equal(attached.record.checkoutUrl, "https://api.payqixiang.cn/cashier/private-token");
  const event = { orderId: created.record.id, provider: "QIXIANG_PAY", providerEventId: "notify:trade-one:TRADE_SUCCESS", providerTransactionId: "trade-one", eventType: "CAPTURED", amountCents: 501, payloadDigest: "sha256:fixture", occurredAt: "2026-08-21T00:01:00Z", receivedAt: "2026-08-21T00:01:01Z" };
  const outcomes = await Promise.all([store.applyTopupEvent(event), store.applyTopupEvent(event)]);
  assert.equal(outcomes.filter((entry) => entry.applied).length, 1);
  const dashboard = await store.dashboard("org-qixiang", "2026-08-21T00:02:00Z");
  assert.equal(dashboard.balance.availableMicros, 5_000_000);
  assert.equal(dashboard.balance.lifetimeTopupMicros, 5_000_000);
  assert.doesNotMatch(JSON.stringify(dashboard), /private-token/u);
  const detail = await store.getTopupForOrganization("org-qixiang", created.record.id);
  assert.equal(detail.credited, true);
  assert.equal(Object.hasOwn(detail, "checkoutUrl"), false);
  assert.doesNotMatch(JSON.stringify(detail), /private-token/u);
  assert.equal(await store.getTopupForOrganization("other-org", created.record.id), null);

  const stranded = await store.createTopup({ account, provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "wxpay", cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: `qixiang-stranded-${crypto.randomUUID()}`, payloadHash: "qixiang-stranded-payload", now: "2026-08-21T01:00:00Z", expiresAt: "2026-08-21T01:15:00Z" });
  assert.equal((await store.claimTopupCheckout({ organizationId: "org-qixiang", orderId: stranded.record.id, now: "2026-08-21T01:00:01Z" })).claimed, true);
  const stale = await store.claimTopupCheckout({ organizationId: "org-qixiang", orderId: stranded.record.id, now: "2026-08-21T01:03:01Z" });
  assert.equal(stale.record.status, "RECONCILIATION_REQUIRED");
  const recoveredEvent = { orderId: stranded.record.id, provider: "QIXIANG_PAY", providerEventId: "notify:trade-recovered:TRADE_SUCCESS", providerTransactionId: "trade-recovered", eventType: "CAPTURED", amountCents: 501, payloadDigest: "sha256:recovered", occurredAt: "2026-08-21T01:04:00Z", receivedAt: "2026-08-21T01:04:01Z" };
  const recovered = await Promise.all([store.applyTopupEvent(recoveredEvent), store.applyTopupEvent(recoveredEvent)]);
  assert.equal(recovered.filter((entry) => entry.applied).length, 1);
  const afterRecovery = await store.dashboard("org-qixiang", "2026-08-21T01:05:00Z");
  assert.equal(afterRecovery.balance.availableMicros, 10_000_000);
  assert.equal(afterRecovery.balance.lifetimeTopupMicros, 10_000_000);

  const timeoutIdempotencyKey = `qixiang-timeout-${crypto.randomUUID()}`;
  const timeoutInput = { account, provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "alipay", cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: timeoutIdempotencyKey, payloadHash: "qixiang-timeout-payload", now: "2026-08-21T02:00:00Z", expiresAt: "2026-08-21T02:15:00Z" };
  const timeoutTopup = await store.createTopup(timeoutInput);
  const checkoutInput = { orderId: timeoutTopup.record.id, amountCents: 501, subject: "KAI Cloud 充值 5.00 KAI 标准卡时", channel: "ALIPAY", clientIp: "203.0.113.7", returnPath: `/member/card-hours/topups/${timeoutTopup.record.id}/return` };
  validateQixiangPayCheckout(checkoutInput, environment);
  assert.equal((await store.claimTopupCheckout({ organizationId: "org-qixiang", orderId: timeoutTopup.record.id, now: "2026-08-21T02:00:01Z" })).claimed, true);
  let providerRequests = 0;
  await assert.rejects(createQixiangPayCheckout(checkoutInput, environment, async () => {
    providerRequests += 1;
    throw new Error("provider accepted request but response timed out");
  }), (error) => error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN");
  await store.markTopupReconciliationRequired({ organizationId: "org-qixiang", orderId: timeoutTopup.record.id, now: "2026-08-21T02:00:10Z" });

  const replay = await store.createTopup(timeoutInput);
  assert.equal(replay.replayed, true);
  const replayClaim = await store.claimTopupCheckout({ organizationId: "org-qixiang", orderId: timeoutTopup.record.id, now: "2026-08-21T02:00:11Z" });
  assert.equal(replayClaim.claimed, false);
  assert.equal(replayClaim.record.status, "RECONCILIATION_REQUIRED");
  assert.equal(providerRequests, 1);

  const timeoutCapturedEvent = { orderId: timeoutTopup.record.id, provider: "QIXIANG_PAY", providerEventId: "notify:trade-timeout-recovered:TRADE_SUCCESS", providerTransactionId: "trade-timeout-recovered", eventType: "CAPTURED", amountCents: 501, payloadDigest: "sha256:timeout-recovered", occurredAt: "2026-08-21T02:01:00Z", receivedAt: "2026-08-21T02:01:01Z" };
  const timeoutRecovered = await Promise.all([store.applyTopupEvent(timeoutCapturedEvent), store.applyTopupEvent(timeoutCapturedEvent)]);
  assert.equal(timeoutRecovered.filter((entry) => entry.applied).length, 1);
  const afterTimeoutRecovery = await store.dashboard("org-qixiang", "2026-08-21T02:02:00Z");
  assert.equal(afterTimeoutRecovery.balance.availableMicros, 15_000_000);
  assert.equal(afterTimeoutRecovery.balance.lifetimeTopupMicros, 15_000_000);
}

test("Qixiang top-up checkout and ledger credit are idempotent in SQLite and D1 adapters", async () => {
  const sqlite = await createSqliteCardHourStore(":memory:");
  const d1Database = new D1Database();
  const d1 = await createD1CardHourStore(d1Database);
  try { await assertIdempotentQixiangCredit(sqlite); await assertIdempotentQixiangCredit(d1); }
  finally { sqlite.close(); d1Database.close(); }
});

test("0033 preserves ALIPAY rows and event foreign keys while adding Qixiang snapshots", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  db.exec(`CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO card_hour_schema_migrations VALUES(3,'2026-08-20T00:00:00Z');
    CREATE TABLE card_hour_topup_orders(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,card_hour_micros INTEGER NOT NULL,amount_cents INTEGER NOT NULL,currency TEXT NOT NULL,provider TEXT NOT NULL CHECK(provider='ALIPAY'),status TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_hash TEXT NOT NULL,provider_transaction_id TEXT,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(organization_id,idempotency_key),UNIQUE(provider,provider_transaction_id));
    CREATE INDEX card_hour_topups_org_time_idx ON card_hour_topup_orders(organization_id,created_at DESC);
    CREATE TABLE card_hour_topup_events(id TEXT PRIMARY KEY,topup_order_id TEXT NOT NULL,provider_event_id TEXT NOT NULL UNIQUE,provider_transaction_id TEXT NOT NULL,event_type TEXT NOT NULL,amount_cents INTEGER NOT NULL,payload_digest TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,FOREIGN KEY(topup_order_id) REFERENCES card_hour_topup_orders(id));
    INSERT INTO card_hour_topup_orders VALUES('KAI_CH_OLDALIPAY00000001','org-old','acct-old',5000000,501,'CNY','ALIPAY','CAPTURED','idem-old','hash-old','trade-old','2026-08-20T00:15:00Z','2026-08-20T00:00:00Z','2026-08-20T00:01:00Z');
    INSERT INTO card_hour_topup_events VALUES('evt-old','KAI_CH_OLDALIPAY00000001','event-old','trade-old','CAPTURED',501,'digest-old','2026-08-20T00:01:00Z','2026-08-20T00:01:01Z');`);
  assert.throws(() => assertQixiangCardHourSchemaReady(db), /QIXIANG_CARD_HOUR_SCHEMA_NOT_READY/u);
  db.exec(readFileSync(new URL("../drizzle/0033_qixiang_pay_card_hour_topups.sql", import.meta.url), "utf8"));
  assert.equal(assertQixiangCardHourSchemaReady(db).ready, true);
  assert.deepEqual({ ...db.prepare("SELECT id,provider,status,provider_transaction_id FROM card_hour_topup_orders").get() }, { id: "KAI_CH_OLDALIPAY00000001", provider: "ALIPAY", status: "CAPTURED", provider_transaction_id: "trade-old" });
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(db.prepare("SELECT MAX(version) version FROM card_hour_schema_migrations").get().version, 3);
  db.prepare("INSERT INTO card_hour_topup_orders(id,organization_id,account_id,card_hour_micros,amount_cents,currency,provider,provider_merchant_ref,provider_payment_type,status,idempotency_key,payload_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,'CNY','QIXIANG_PAY','10086','wxpay','PENDING',?,?,?, ?, ?)").run(`KAI_CH_${"c".repeat(32)}`, "org-new", "acct-new", 5_000_000, 501, "idem-new", "hash-new", "2026-08-21T00:15:00Z", "2026-08-21T00:00:00Z", "2026-08-21T00:00:00Z");
  assert.equal(db.prepare("SELECT provider FROM card_hour_topup_orders WHERE organization_id='org-new'").get().provider, "QIXIANG_PAY");
  db.close();
});

test("checkout route validates before claiming and never retries an uncertain provider outcome", () => {
  const source = readFileSync(new URL("../app/api/v1/member/card-hours/topups/route.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("validateQixiangPayCheckout(providerCheckoutInput)") < source.indexOf("store.claimTopupCheckout"));
  assert.match(source, /store\.markTopupReconciliationRequired/u);
  assert.doesNotMatch(source, /releaseTopupCheckoutClaim/u);
});

test("0033 uses separate SQLite and D1-safe transaction semantics", () => {
  const sqliteMigration = readFileSync(new URL("../drizzle/0033_qixiang_pay_card_hour_topups.sql", import.meta.url), "utf8");
  const d1Migration = readFileSync(new URL("../.openai/drizzle/0033_qixiang_pay_card_hour_topups.sql", import.meta.url), "utf8");
  assert.match(sqliteMigration, /PRAGMA foreign_keys\s*=\s*OFF/u);
  assert.match(sqliteMigration, /BEGIN IMMEDIATE/u);
  assert.match(d1Migration, /PRAGMA defer_foreign_keys\s*=\s*ON/u);
  assert.doesNotMatch(d1Migration, /PRAGMA foreign_keys\s*=\s*OFF/u);
  assert.doesNotMatch(d1Migration, /\bBEGIN\b|\bCOMMIT\b/u);
});

test("0033 predeploy gate allows only wholly uninitialized shared databases", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-qixiang-gate-"));
  const path = join(directory, "shared.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE unrelated_business_table(id TEXT PRIMARY KEY)");
    assert.equal(verifyQixiangCardHourDatabase({ databasePath: path, allowUninitialized: true }).cardHourInitialized, false);
    db.exec("CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)");
    assert.throws(() => verifyQixiangCardHourDatabase({ databasePath: path, allowUninitialized: true }), /QIXIANG_CARD_HOUR_SCHEMA_PARTIAL/u);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
