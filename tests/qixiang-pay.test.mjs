import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createD1CardHourStore } from "../lib/server/card-hour-store-d1.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { confirmQixiangPayNotification, createQixiangPayCheckout, qixiangPayPilotAccess, qixiangPayReadiness, queryQixiangPayOrder, trustedQixiangClientIp, validateQixiangPayCheckout, verifyQixiangPayNotification } from "../lib/server/qixiang-pay.ts";
import { isRevokedQixiangMerchantKeyDigest } from "../lib/server/qixiang-pay-revoked-policy.mjs";
import { assertQixiangCardHourSchemaReady, verifyQixiangCardHourDatabase } from "../scripts/ops/verify-qixiang-card-hour-schema.mjs";

const KEY = "fixture-secret-key-1234567890";
const environment = {
  KAI_QIXIANG_PAY_ENABLED: "1", KAI_QIXIANG_PAY_PID: "10086", KAI_QIXIANG_PAY_KEY: KEY,
  KAI_QIXIANG_PAY_RECONCILIATION_ENABLED: "1",
  KAI_QIXIANG_PAY_APPROVAL_REFERENCE: "KAI-PAY-APPROVAL-20260822",
  KAI_QIXIANG_PAY_CREDENTIAL_VERSION: "merchant-v1",
  KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED: "1",
  KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE: "RISK-KAI-QIXIANG-GET-20260822",
  KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: "QRY-qixiang-production-v1",
  KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION: "query-v1",
  KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS: "org-qixiang", KAI_QIXIANG_PAY_PILOT_CHANNEL: "ALIPAY",
  KAI_QIXIANG_PAY_CHANNELS: "ALIPAY", KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
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
  assert.deepEqual(qixiangPayPilotAccess("org-qixiang", environment), { ready: true, allowed: true, channel: "ALIPAY", cardHours: 5, reason: null });
  assert.equal(qixiangPayPilotAccess("org-not-approved", environment).ready, false);
  assert.equal(trustedQixiangClientIp(new Request("https://cloud.kai.com", { headers: { "x-forwarded-for": "203.0.113.7" } }), environment), "203.0.113.7");
  assert.throws(() => trustedQixiangClientIp(new Request("https://cloud.kai.com", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }), environment), /来源地址无效/u);
  let submitted;
  const result = await createQixiangPayCheckout({ orderId: `KAI_CH_${"a".repeat(32)}`, amountCents: 501, subject: "KAI Cloud 充值 5.00 KAI 标准卡时", channel: "ALIPAY", clientIp: "203.0.113.7", returnPath: `/member/card-hours/topups/KAI_CH_${"a".repeat(32)}/return` }, environment, async (_url, init) => {
    submitted = Object.fromEntries(new URLSearchParams(init.body));
    return new Response(JSON.stringify({ code: 1, payurl: "https://api.payqixiang.cn/pay/submit/fixture-token/" }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  });
  assert.equal(result.channel, "ALIPAY");
  assert.equal(submitted.type, "alipay");
  assert.equal(submitted.clientip, "203.0.113.7");
  assert.match(submitted.return_url, /\/member\/card-hours\/topups\/KAI_CH_/u);
  assert.equal(submitted.sign, signature(submitted));
  assert.doesNotMatch(JSON.stringify(submitted), new RegExp(KEY, "u"));
});

test("Qixiang checkout stays closed without approval and legacy-query compensating controls", () => {
  const unapproved = qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_APPROVAL_REFERENCE: "" });
  assert.equal(unapproved.canCreatePayment, false);
  assert.ok(unapproved.missing.includes("KAI_QIXIANG_PAY_APPROVAL_REFERENCE"));
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_CREDENTIAL_VERSION: "" }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_ACCEPTED: "0" }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_LEGACY_QUERY_RISK_REFERENCE: "" }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: "" }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_QUERY_CREDENTIAL_VERSION: "" }).canCreatePayment, false);
  const wrongGateway = qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_GATEWAY: "https://example.com/mapi.php" });
  assert.equal(wrongGateway.canCreatePayment, false);
  const wrongQueryEndpoint = qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_QUERY_ENDPOINT: "https://example.com/api.php" });
  assert.equal(wrongQueryEndpoint.canCreatePayment, false);
  const placeholderKey = qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_KEY: "replace-with-secret-123456" });
  assert.equal(placeholderKey.canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_CHANNELS: "ALIPAY,WXPAY" }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...environment, KAI_QIXIANG_PAY_PILOT_ORGANIZATIONS: "" }).canCreatePayment, false);
});

test("an explicitly revoked merchant key opens only with a digest-bound user reuse approval", () => {
  const key = "revoked-fixture-key-1234567890";
  const reused = {
    ...environment,
    KAI_QIXIANG_PAY_KEY: key,
    KAI_QIXIANG_PAY_KEY_REUSE_APPROVED: "1",
    KAI_QIXIANG_PAY_KEY_REUSE_APPROVAL_REFERENCE: "RISK-KAI-QIXIANG-KEY-REUSE-20260822",
    KAI_QIXIANG_PAY_KEY_REUSE_APPROVED_AT: "2026-08-22T09:20:00.000Z",
    KAI_QIXIANG_PAY_KEY_REUSE_DIGEST: "48b179abed3a6cbe4f69dfacfeaea8eeec6cc9a405144fb23727fbdb6f37c94b",
  };
  assert.equal(qixiangPayReadiness({ ...reused, KAI_QIXIANG_PAY_KEY_REUSE_APPROVED: "0" }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness({ ...reused, KAI_QIXIANG_PAY_KEY_REUSE_DIGEST: "0".repeat(64) }).canCreatePayment, false);
  assert.equal(qixiangPayReadiness(reused).canCreatePayment, true);
});

test("disabled reconciliation never sends an active order query", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    queryQixiangPayOrder({
      orderId: `KAI_CH_${"c".repeat(32)}`,
      amountCents: 501,
      subject: "KAI Cloud 充值 5.00 KAI 标准卡时",
      paymentType: "alipay",
      merchantParam: `KAI_CH_${"c".repeat(32)}`,
    }, { ...environment, KAI_QIXIANG_PAY_ENABLED: "0", KAI_QIXIANG_PAY_RECONCILIATION_ENABLED: "0" }, async () => {
      fetchCalls += 1;
      return new Response("{}");
    }),
    (error) => error.code === "QIXIANG_PAY_NOT_CONFIGURED",
  );
  assert.equal(fetchCalls, 0);
});

test("stored orders remain reconcilable after new checkout creation is disabled", async () => {
  const orderId = `KAI_CH_${"s".repeat(32)}`;
  const storedOrderEnvironment = {
    ...environment,
    KAI_QIXIANG_PAY_ENABLED: "0",
    KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: "QRY-stored-orders-fixture-v1",
  };
  assert.equal(qixiangPayReadiness(storedOrderEnvironment).canCreatePayment, false);
  const result = await queryQixiangPayOrder({
    orderId,
    amountCents: 501,
    subject: "KAI Cloud 充值 5.00 KAI 标准卡时",
    paymentType: "alipay",
    merchantParam: orderId,
  }, storedOrderEnvironment, async () => new Response(JSON.stringify({
    code: 1,
    status: 1,
    trade_no: "TRADE_stored_order_1",
    out_trade_no: orderId,
    type: "alipay",
    pid: 10086,
    name: "KAI Cloud 充值 5.00 KAI 标准卡时",
    money: "5.01",
    param: orderId,
  }), { headers: { "content-type": "application/json" } }));
  assert.equal(result.providerOrderId, orderId);
  assert.equal(result.fundsMoved, true);
});

test("active order query rate limit and circuit breaker stop requests before fetch", async () => {
  const orderId = `KAI_CH_${"r".repeat(32)}`;
  const expected = { orderId, amountCents: 501, subject: "KAI Cloud 充值 5.00 KAI 标准卡时", paymentType: "alipay", merchantParam: orderId };
  let rateFetchCalls = 0;
  const rateEnvironment = { ...environment, KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: "QRY-rate-limit-fixture-v1" };
  for (let index = 0; index < 12; index += 1) {
    await assert.rejects(queryQixiangPayOrder(expected, rateEnvironment, async () => {
      rateFetchCalls += 1;
      return new Response(JSON.stringify({ code: 1, status: 0 }), { headers: { "content-type": "application/json" } });
    }), (error) => error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN");
  }
  await assert.rejects(queryQixiangPayOrder(expected, rateEnvironment, async () => { rateFetchCalls += 1; return new Response("{}"); }), /过于频繁/u);
  assert.equal(rateFetchCalls, 12);

  let breakerFetchCalls = 0;
  const breakerEnvironment = { ...environment, KAI_QIXIANG_PAY_QUERY_CREDENTIAL_ID: "QRY-circuit-breaker-fixture-v1" };
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(queryQixiangPayOrder(expected, breakerEnvironment, async () => { breakerFetchCalls += 1; throw new Error("network"); }), (error) => error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN");
  }
  await assert.rejects(queryQixiangPayOrder(expected, breakerEnvironment, async () => { breakerFetchCalls += 1; return new Response("{}"); }), /熔断/u);
  assert.equal(breakerFetchCalls, 3);
});

test("revoked merchant-key policy has one shared fail-closed source and query URLs are never logged", () => {
  const source = readFileSync(new URL("../lib/server/qixiang-pay.ts", import.meta.url), "utf8");
  const configurator = readFileSync(new URL("../scripts/ops/configure-qixiang-pay-env.mjs", import.meta.url), "utf8");
  assert.equal(isRevokedQixiangMerchantKeyDigest("4d81683f5583c963560a31d39b8fcadfd7fa686b97519e26d9feaa6b7d523956"), true);
  assert.equal(isRevokedQixiangMerchantKeyDigest("0".repeat(64)), false);
  assert.match(source, /isRevokedQixiangMerchantKey\(key\)/u);
  assert.match(configurator, /isRevokedQixiangMerchantKey\(key\)/u);
  assert.doesNotMatch(source, /[0-9a-f]{64}/u);
  assert.doesNotMatch(configurator, /[0-9a-f]{64}/u);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)[^\n]*(?:queryUrl|orderQuery)/u);
  assert.match(source, /redirect: "error"/u);
});

test("signed callbacks remain verifiable after checkout is disabled and reject protocol extensions", async () => {
  const fields = {
    pid: "10086", trade_no: "TRADE_fixture_1234", out_trade_no: `KAI_CH_${"b".repeat(32)}`, type: "alipay",
    name: "KAI Cloud 充值 5.00 KAI 标准卡时", money: "5.01", trade_status: "TRADE_SUCCESS", param: `KAI_CH_${"b".repeat(32)}`, sign_type: "MD5",
  };
  fields.sign = signature(fields);
  const query = new URLSearchParams(fields);
  const notification = await verifyQixiangPayNotification(query, query.toString(), { ...environment, KAI_QIXIANG_PAY_ENABLED: "0", KAI_QIXIANG_PAY_CHANNELS: "" });
  assert.equal(notification.amountCents, 501);
  assert.equal(notification.productName, fields.name);
  assert.equal(notification.merchantParam, fields.param);
  assert.equal(Object.hasOwn(notification, "fundsMoved"), false);
  const extended = new URLSearchParams(query); extended.set("unexpected", "1"); extended.set("sign", signature(Object.fromEntries(extended)));
  await assert.rejects(verifyQixiangPayNotification(extended, extended.toString(), environment), (error) => error.code === "QIXIANG_PAY_NOTIFICATION_INVALID");
  const duplicate = new URLSearchParams(query); duplicate.append("money", "5.01");
  await assert.rejects(verifyQixiangPayNotification(duplicate, duplicate.toString(), environment), (error) => error.code === "QIXIANG_PAY_NOTIFICATION_INVALID");
});

test("a signed Qixiang notification credits only after an exact active order query", async () => {
  const orderId = `KAI_CH_${"d".repeat(32)}`;
  const subject = "KAI Cloud 充值 5.00 KAI 标准卡时";
  const fields = {
    pid: "10086", trade_no: "TRADE_query_fixture_1", out_trade_no: orderId, type: "alipay",
    name: subject, money: "5.01", trade_status: "TRADE_SUCCESS", param: orderId, sign_type: "MD5",
  };
  fields.sign = signature(fields);
  const query = new URLSearchParams(fields);
  const notification = await verifyQixiangPayNotification(query, query.toString(), environment);
  let requestedUrl;
  let requestedInit;
  const confirmed = await confirmQixiangPayNotification(notification, {
    orderId, amountCents: 501, subject, paymentType: "alipay", merchantParam: orderId,
  }, environment, async (url, init) => {
    requestedUrl = new URL(url);
    requestedInit = init;
    return new Response(JSON.stringify({
      code: 1, msg: "查询订单号成功！", trade_no: fields.trade_no, out_trade_no: orderId,
      api_trade_no: "ALIPAY_fixture_1", type: "alipay", pid: 10086, addtime: "2026-08-22 00:00:00",
      endtime: "2026-08-22 00:00:03", name: subject, money: "5.01", status: 1, param: orderId, buyer: "fixture",
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(requestedUrl.origin, "https://api.payqixiang.cn");
  assert.equal(requestedUrl.pathname, "/api.php");
  assert.equal(requestedUrl.searchParams.get("act"), "order");
  assert.equal(requestedUrl.searchParams.get("pid"), "10086");
  assert.equal(requestedUrl.searchParams.get("out_trade_no"), orderId);
  assert.equal(requestedUrl.searchParams.get("key"), KEY);
  assert.equal(requestedInit.method, "GET");
  assert.equal(requestedInit.redirect, "error");
  assert.equal(confirmed.fundsMoved, true);
  assert.equal(confirmed.verificationMethod, "QIXIANG_MD5_NOTIFY_AND_ORDER_QUERY");
  assert.equal(confirmed.providerTransactionId, fields.trade_no);

  await assert.rejects(queryQixiangPayOrder({ orderId, amountCents: 501, subject, paymentType: "alipay", merchantParam: orderId }, environment, async () => new Response(JSON.stringify({
    code: 1, trade_no: fields.trade_no, out_trade_no: orderId, type: "alipay", pid: 10086,
    name: subject, money: "5.02", status: 1, param: orderId,
  }), { status: 200 })), (error) => error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN");

  await assert.rejects(queryQixiangPayOrder({ orderId, amountCents: 501, subject, paymentType: "alipay", merchantParam: orderId }, environment, async () => new Response(JSON.stringify({
    code: 1, trade_no: fields.trade_no, out_trade_no: orderId, type: "alipay", pid: 10086,
    name: subject, money: "5.01", status: 0, param: orderId,
  }), { status: 200 })), (error) => error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN");
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
  const concurrentKey = `qixiang-concurrent-${crypto.randomUUID()}`;
  const concurrentInput = { account, provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "alipay", cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: concurrentKey, payloadHash: "qixiang-concurrent-payload", now: "2026-08-20T23:00:00Z", expiresAt: "2026-08-20T23:15:00Z" };
  const concurrent = await Promise.all([store.createTopup(concurrentInput), store.createTopup(concurrentInput)]);
  assert.equal(new Set(concurrent.map((entry) => entry.record.id)).size, 1);
  assert.equal(concurrent.filter((entry) => entry.replayed).length, 1);

  const created = await store.createTopup({ account, provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "alipay", cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: `qixiang-${crypto.randomUUID()}`, payloadHash: "qixiang-payload", now: "2026-08-21T00:00:00Z", expiresAt: "2026-08-21T00:15:00Z" });
  const reconciliationRequestKey = `qixiang-reconcile-${crypto.randomUUID()}`;
  const reconciliationRequest = { organizationId: "org-qixiang", orderId: created.record.id, idempotencyKey: reconciliationRequestKey, payloadHash: "qixiang-reconcile-payload", now: "2026-08-21T00:00:00Z" };
  const reconciliationRequests = await Promise.all([
    store.registerTopupReconciliationRequest(reconciliationRequest),
    store.registerTopupReconciliationRequest(reconciliationRequest),
  ]);
  assert.equal(reconciliationRequests.filter((entry) => entry.replayed).length, 1);
  await assert.rejects(store.registerTopupReconciliationRequest({ ...reconciliationRequest, payloadHash: "different-reconciliation-payload" }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  const claim = await store.claimTopupCheckout({ organizationId: "org-qixiang", orderId: created.record.id, now: "2026-08-21T00:00:01Z" });
  assert.equal(claim.claimed, true);
  const attached = await store.attachTopupCheckout({ organizationId: "org-qixiang", orderId: created.record.id, checkoutUrl: "https://api.payqixiang.cn/cashier/private-token", now: "2026-08-21T00:00:02Z" });
  assert.equal(attached.record.checkoutUrl, "https://api.payqixiang.cn/cashier/private-token");
  const reconciliationClaims = await Promise.all([
    store.claimTopupReconciliation({ organizationId: "org-qixiang", orderId: created.record.id, now: "2026-08-21T00:00:03Z", staleBefore: "2026-08-20T23:58:03Z", nextEligibleAt: "2026-08-21T00:00:33Z" }),
    store.claimTopupReconciliation({ organizationId: "org-qixiang", orderId: created.record.id, now: "2026-08-21T00:00:03Z", staleBefore: "2026-08-20T23:58:03Z", nextEligibleAt: "2026-08-21T00:00:33Z" }),
  ]);
  assert.equal(reconciliationClaims.filter((entry) => entry.claimed).length, 1);
  const reconciliationClaim = reconciliationClaims.find((entry) => entry.claimed);
  await store.releaseTopupReconciliation({ organizationId: "org-qixiang", orderId: created.record.id, claimToken: reconciliationClaim.claimToken, now: "2026-08-21T00:00:04Z", nextEligibleAt: "2026-08-21T00:00:34Z" });
  assert.equal((await store.claimTopupReconciliation({ organizationId: "org-qixiang", orderId: created.record.id, now: "2026-08-21T00:00:20Z", staleBefore: "2026-08-20T23:58:20Z", nextEligibleAt: "2026-08-21T00:00:50Z" })).claimed, false);
  const dueClaim = await store.claimTopupReconciliation({ organizationId: "org-qixiang", orderId: created.record.id, now: "2026-08-21T00:00:35Z", staleBefore: "2026-08-20T23:58:35Z", nextEligibleAt: "2026-08-21T00:01:05Z" });
  assert.equal(dueClaim.claimed, true);
  await store.releaseTopupReconciliation({ organizationId: "org-qixiang", orderId: created.record.id, claimToken: dueClaim.claimToken, now: "2026-08-21T00:00:36Z", nextEligibleAt: "2026-08-21T00:01:06Z" });
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

  const appealTopup = await store.createTopup({ account, provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "alipay", cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: `qixiang-appeal-${crypto.randomUUID()}`, payloadHash: "qixiang-appeal-topup", now: "2026-08-21T03:00:00Z", expiresAt: "2026-08-21T03:15:00Z" });
  const appealInput = { account, orderId: appealTopup.record.id, reason: "PENDING_TIMEOUT", description: "付款后长时间没有确认结果，请平台按付款单人工核对。", idempotencyKey: `qixiang-appeal-case-${crypto.randomUUID()}`, payloadHash: "qixiang-appeal-case", now: "2026-08-21T03:20:00Z" };
  await assert.rejects(store.createTopupAppeal({ ...appealInput, idempotencyKey: `qixiang-appeal-early-${crypto.randomUUID()}`, payloadHash: "qixiang-appeal-early", now: "2026-08-21T03:05:00Z" }), (error) => error.code === "CARD_HOUR_TOPUP_APPEAL_TOO_EARLY" && error.message.includes("2026-08-21T03:15:00Z"));
  const appeal = await store.createTopupAppeal(appealInput);
  assert.equal(appeal.record.topupOrderId, appealTopup.record.id);
  assert.equal(appeal.record.status, "OPEN");
  assert.equal(appeal.record.unread, false);
  assert.equal((await store.createTopupAppeal(appealInput)).replayed, true);
  assert.equal((await store.getTopupAppealForOrganization("other-org", appealTopup.record.id)), null);
  const page = await store.listTopupAppeals({ page: 1, pageSize: 1, status: "OPEN", orderId: appealTopup.record.id.slice(-10), organizationId: "org-qixiang" });
  assert.equal(page.records.length, 1);
  assert.deepEqual({ page: page.page, pageSize: page.pageSize, total: page.total, totalPages: page.totalPages }, { page: 1, pageSize: 1, total: 1, totalPages: 1 });
  const review = await store.transitionTopupAppeal({ appealId: appeal.record.id, action: "START_REVIEW", expectedVersion: 1, adminPrincipalId: "admin-finance", payloadHash: "appeal-review", now: "2026-08-21T03:21:00Z" });
  assert.equal(review.record.status, "UNDER_REVIEW");
  assert.equal(review.record.unread, true);
  assert.equal((await store.dashboard("org-qixiang", "2026-08-21T03:21:30Z")).unreadAppealCount, 1);
  await assert.rejects(store.acknowledgeTopupAppeal({ organizationId: "other-org", orderId: appealTopup.record.id, now: "2026-08-21T03:21:40Z" }), (error) => error.code === "CARD_HOUR_TOPUP_APPEAL_NOT_FOUND");
  assert.equal((await store.acknowledgeTopupAppeal({ organizationId: "org-qixiang", orderId: appealTopup.record.id, now: "2026-08-21T03:21:50Z" })).unread, false);
  assert.equal((await store.dashboard("org-qixiang", "2026-08-21T03:21:55Z")).unreadAppealCount, 0);
  const resolved = await store.transitionTopupAppeal({ appealId: appeal.record.id, action: "RESOLVE", expectedVersion: 2, resolutionNote: "已核对付款单与支付通知，按人工流程联系用户处理。", adminPrincipalId: "admin-finance", payloadHash: "appeal-resolve", now: "2026-08-21T03:22:00Z" });
  assert.equal(resolved.record.status, "RESOLVED");
  assert.equal(resolved.record.unread, true);
  const closed = await store.transitionTopupAppeal({ appealId: appeal.record.id, action: "CLOSE", expectedVersion: 3, adminPrincipalId: "admin-finance", payloadHash: "appeal-close", now: "2026-08-21T03:23:00Z" });
  assert.equal(closed.record.status, "CLOSED");
  assert.equal((await store.getTopupForOrganization("org-qixiang", appealTopup.record.id)).status, "PENDING", "appeal handling must not mutate payment state");
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

test("0036 mirrors the additive topup appeal sidecar without payment mutation SQL", () => {
  const sqliteMigration = readFileSync(new URL("../drizzle/0036_card_hour_topup_appeals.sql", import.meta.url), "utf8");
  const d1Migration = readFileSync(new URL("../.openai/drizzle/0036_card_hour_topup_appeals.sql", import.meta.url), "utf8");
  assert.equal(sqliteMigration, d1Migration);
  assert.match(sqliteMigration, /card_hour_topup_appeals/u);
  assert.match(sqliteMigration, /card_hour_topup_appeal_events/u);
  assert.match(sqliteMigration, /VALUES\(4,datetime\('now'\)\)/u);
  assert.doesNotMatch(sqliteMigration, /UPDATE card_hour_topup_orders|UPDATE card_hour_wallets|INSERT INTO card_hour_ledger/u);
});

test("0037 mirrors organization-scoped appeal read receipts without payment mutation SQL", () => {
  const sqliteMigration = readFileSync(new URL("../drizzle/0037_card_hour_topup_appeal_reads.sql", import.meta.url), "utf8");
  const d1Migration = readFileSync(new URL("../.openai/drizzle/0037_card_hour_topup_appeal_reads.sql", import.meta.url), "utf8");
  assert.equal(sqliteMigration, d1Migration);
  assert.match(sqliteMigration, /card_hour_topup_appeal_member_reads/u);
  assert.match(sqliteMigration, /VALUES\(5,datetime\('now'\)\)/u);
  assert.doesNotMatch(sqliteMigration, /UPDATE card_hour_topup_orders|UPDATE card_hour_wallets|INSERT INTO card_hour_ledger/u);
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
