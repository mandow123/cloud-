import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cnyCentsToCardHourMicros, formatCardHourMicros, parseTopupCardHours, topupAmountCents } from "../lib/card-hours.ts";
import { hostingCnyReferenceCents, hostingFeeBreakdown } from "../lib/hosting-v2.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const account = {
  account: { id: "acct-buyer", displayName: "Buyer", primaryEmail: null, status: "ACTIVE" },
  activeOrganization: { id: "org-buyer", name: "Buyer Org", externalKey: "BUYER", status: "ACTIVE" },
  membership: { id: "mbr-buyer", accountId: "acct-buyer", organizationId: "org-buyer", status: "ACTIVE", roles: [] },
  sessionId: "session-buyer",
  authMethod: "EMAIL_OTP",
};

function organizationAccount(id) {
  return {
    account: { id: `acct-${id}`, displayName: id, primaryEmail: null, status: "ACTIVE" },
    activeOrganization: { id: `org-${id}`, name: id, externalKey: id.toUpperCase(), status: "ACTIVE" },
    membership: { id: `mbr-${id}`, accountId: `acct-${id}`, organizationId: `org-${id}`, status: "ACTIVE", roles: [] },
    sessionId: `session-${id}`,
    authMethod: "EMAIL_OTP",
  };
}

test("card-hour conversion is exact at the 5-card-hour RMB boundary", () => {
  assert.equal(parseTopupCardHours("5"), 5_000_000);
  assert.equal(topupAmountCents(5_000_000), 501);
  assert.equal(topupAmountCents(100_000_000), 10_020);
  assert.equal(formatCardHourMicros(cnyCentsToCardHourMicros(501)), "5");
  assert.throws(() => parseTopupCardHours("6"), /CARD_HOUR_TOPUP_INVALID/u);
});

test("CNY references round-trip through upward micro-card-hour conversion without cent drift", () => {
  const micros = cnyCentsToCardHourMicros(3_120);
  assert.equal(micros, 31_137_725);
  assert.equal(hostingCnyReferenceCents(micros), 3_120);

  for (let cents = 1; cents <= 100_000; cents += 1) {
    const converted = cnyCentsToCardHourMicros(cents);
    assert.ok(
      BigInt(converted) * 1002n >= BigInt(cents) * 10n * 1_000_000n,
      `conversion must not undercharge at ${cents} cents`,
    );
    assert.equal(hostingCnyReferenceCents(converted), cents);
  }

  for (const cents of [1, 501, 3_120, 100_000_000]) {
    assert.equal(hostingCnyReferenceCents(cnyCentsToCardHourMicros(cents)), cents);
  }
});

test("hosting referral commission is allocated only within the platform fee", () => {
  const split = hostingFeeBreakdown(1_234_567, 100, 100, true);
  assert.equal(split.supplierIncomeMicros, split.grossMicros - split.platformFeeMicros);
  assert.equal(split.platformNetMicros, split.platformFeeMicros - split.commissionMicros);
  assert.equal(split.grossMicros, split.supplierIncomeMicros + split.commissionMicros + split.platformNetMicros);
  assert.deepEqual(hostingFeeBreakdown(1_234_567, 100, 100, false), { ...split, commissionMicros: 0, platformNetMicros: split.platformFeeMicros });
  assert.throws(() => hostingFeeBreakdown(1_234_567, 100, 101, true), /HOSTING_FEE_RATES_INVALID/u);
});

test("captured topup credits once and order capture cannot overdraw or replay twice", async () => {
  const store = await createSqliteCardHourStore(":memory:");
  try {
    assert.deepEqual(await store.health(), { schemaVersion: 6, integrity: "ok" });
    const topup = await store.createTopup({ account, cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: "topup-000000000001", payloadHash: "hash-topup", now: "2026-08-10T00:00:00Z", expiresAt: "2026-08-10T00:15:00Z" });
    await store.applyTopupEvent({ orderId: topup.record.id, providerEventId: "event-1", providerTransactionId: "transaction-1", eventType: "CAPTURED", amountCents: 501, payloadDigest: "digest", occurredAt: "2026-08-10T00:01:00Z", receivedAt: "2026-08-10T00:01:01Z" });
    assert.equal((await store.applyTopupEvent({ orderId: topup.record.id, providerEventId: "event-2", providerTransactionId: "transaction-1", eventType: "CAPTURED", amountCents: 501, payloadDigest: "digest", occurredAt: "2026-08-10T00:02:00Z", receivedAt: "2026-08-10T00:02:01Z" })).applied, false);
    const captured = await store.captureOrder({ account, sourceSystem: "SUPPLY_PILOT", orderId: "order-1", amountMicros: 4_000_000, cnyReferenceCents: 401, idempotencyKey: "capture-0000000001", payloadHash: "hash-capture", now: "2026-08-10T00:03:00Z" });
    assert.equal(captured.replayed, false);
    assert.equal((await store.captureOrder({ account, sourceSystem: "SUPPLY_PILOT", orderId: "order-1", amountMicros: 4_000_000, cnyReferenceCents: 401, idempotencyKey: "capture-0000000001", payloadHash: "hash-capture", now: "2026-08-10T00:03:00Z" })).replayed, true);
    await assert.rejects(store.captureOrder({ account, sourceSystem: "SUPPLY_PILOT", orderId: "order-2", amountMicros: 2_000_000, cnyReferenceCents: 201, idempotencyKey: "capture-0000000002", payloadHash: "hash-overdraw", now: "2026-08-10T00:04:00Z" }), (error) => error.code === "CARD_HOUR_BALANCE_INSUFFICIENT");
    const dashboard = await store.dashboard(account.activeOrganization.id, "2026-08-10T00:05:00Z");
    assert.equal(dashboard.balance.availableMicros, 1_000_000);
    assert.equal(dashboard.balance.lifetimeTopupMicros, 5_000_000);
    assert.equal(dashboard.balance.lifetimeSpentMicros, 4_000_000);
    assert.equal(dashboard.ledger.length, 2);
  } finally { store.close(); }
});

test("a closed topup cannot be credited by a later conflicting capture event", async () => {
  const store = await createSqliteCardHourStore(":memory:");
  try {
    const topup = await store.createTopup({ account, cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: "topup-closed-000001", payloadHash: "hash-closed", now: "2026-08-10T00:00:00Z", expiresAt: "2026-08-10T00:15:00Z" });
    assert.equal((await store.applyTopupEvent({ orderId: topup.record.id, providerEventId: "event-closed", providerTransactionId: "transaction-closed", eventType: "CLOSED", amountCents: 501, payloadDigest: "digest-closed", occurredAt: "2026-08-10T00:01:00Z", receivedAt: "2026-08-10T00:01:01Z" })).applied, true);
    assert.equal((await store.applyTopupEvent({ orderId: topup.record.id, providerEventId: "event-conflict", providerTransactionId: "transaction-conflict", eventType: "CAPTURED", amountCents: 501, payloadDigest: "digest-conflict", occurredAt: "2026-08-10T00:02:00Z", receivedAt: "2026-08-10T00:02:01Z" })).applied, false);
    const dashboard = await store.dashboard(account.activeOrganization.id, "2026-08-10T00:03:00Z");
    assert.equal(dashboard.balance.availableMicros, 0);
    assert.equal(dashboard.ledger.length, 0);
  } finally { store.close(); }
});

test("topup appeals enforce expiry, paginate for admins, and expose organization-scoped unread progress", async () => {
  const store = await createSqliteCardHourStore(":memory:");
  try {
    const topup = await store.createTopup({ account, cardHourMicros: 5_000_000, amountCents: 501, idempotencyKey: "appeal-topup-000001", payloadHash: "appeal-topup-hash", now: "2026-08-22T00:00:00Z", expiresAt: "2026-08-22T00:15:00Z" });
    const base = { account, orderId: topup.record.id, reason: "PENDING_TIMEOUT", description: "支付结果长时间没有更新，请平台按付款单人工核对。", idempotencyKey: "appeal-case-000001", payloadHash: "appeal-case-hash" };
    await assert.rejects(store.createTopupAppeal({ ...base, now: "2026-08-22T00:14:59Z" }), (error) => error.code === "CARD_HOUR_TOPUP_APPEAL_TOO_EARLY" && error.message.includes("2026-08-22T00:15:00Z"));
    const appeal = await store.createTopupAppeal({ ...base, now: "2026-08-22T00:15:00Z" });
    assert.equal(appeal.record.unread, false);
    const page = await store.listTopupAppeals({ page: 1, pageSize: 1, status: "OPEN", orderId: String(topup.record.id).slice(-8), organizationId: account.activeOrganization.id });
    assert.deepEqual({ count: page.records.length, total: page.total, totalPages: page.totalPages }, { count: 1, total: 1, totalPages: 1 });
    const review = await store.transitionTopupAppeal({ appealId: appeal.record.id, action: "START_REVIEW", expectedVersion: 1, adminPrincipalId: "admin-payment", payloadHash: "appeal-review-hash", now: "2026-08-22T00:16:00Z" });
    assert.equal(review.record.unread, true);
    assert.equal((await store.dashboard(account.activeOrganization.id, "2026-08-22T00:16:01Z")).unreadAppealCount, 1);
    assert.equal((await store.dashboard("other-organization", "2026-08-22T00:16:01Z")).appealNotifications.length, 0);
    await assert.rejects(store.acknowledgeTopupAppeal({ organizationId: "other-organization", orderId: String(topup.record.id), now: "2026-08-22T00:16:02Z" }), (error) => error.code === "CARD_HOUR_TOPUP_APPEAL_NOT_FOUND");
    const acknowledged = await store.acknowledgeTopupAppeal({ organizationId: account.activeOrganization.id, orderId: String(topup.record.id), now: "2026-08-22T00:16:03Z" });
    assert.equal(acknowledged.unread, false);
    assert.equal((await store.dashboard(account.activeOrganization.id, "2026-08-22T00:16:04Z")).unreadAppealCount, 0);
  } finally { store.close(); }
});

test("hosting order hold settles actual usage once and vests rental and referral income", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-card-hour-hosting-"));
  const path = join(directory, "hosting.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const store = await createSqliteCardHourStore(path);
  const buyer = organizationAccount("hosting-buyer");
  const supplier = organizationAccount("hosting-supplier");
  const referrer = organizationAccount("hosting-referrer");
  try {
    const grant = await store.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 10_000_000, reason: "内部真实机器闭环验收", requestedBy: "admin-requester", idempotencyKey: "trial-grant-000001", payloadHash: "trial-request-hash", now: "2026-08-11T01:00:00Z" });
    await assert.rejects(store.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "admin-requester", payloadHash: "self-approval", now: "2026-08-11T01:00:01Z" }), (error) => error.code === "CARD_HOUR_TRIAL_GRANT_DUAL_CONTROL_REQUIRED");
    await store.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "admin-approver", payloadHash: "trial-approval-hash", now: "2026-08-11T01:00:02Z" });

    const referral = await store.dashboard(referrer.activeOrganization.id, "2026-08-11T01:00:03Z");
    await store.attachReferral({ account: buyer, code: referral.referral.code, now: "2026-08-11T01:00:04Z" });
    const held = await store.holdHostingOrder({ account: buyer, orderId: "hosting-contract-1", amountMicros: 8_000_000, idempotencyKey: "hosting-hold-000001", payloadHash: "hosting-hold-hash", now: "2026-08-11T01:01:00Z" });
    assert.equal(held.replayed, false);
    assert.deepEqual((await store.dashboard(buyer.activeOrganization.id, "2026-08-11T01:01:01Z")).balance, { availableMicros: 2_000_000, heldMicros: 8_000_000, lifetimeTopupMicros: 10_000_000, lifetimeSpentMicros: 0 });

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    const snapshot = { title: "Card hour settlement", gpuModel: "RTX_4090", region: "Test", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300, acceptanceWindowSeconds: 1_800 };
    db.prepare("INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,measured_seconds,held_micros,status,stopped_at,idempotency_key,payload_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("hosting-contract-1", "offer-card-hours", "device-card-hours", buyer.activeOrganization.id, buyer.account.id, supplier.activeOrganization.id, "fee-card-hours", JSON.stringify(snapshot), 8_000, 6_000, 8_000_000, "AWAITING_ACCEPTANCE", "2026-08-11T00:34:00Z", "seed-card-hours", "seed-card-hours-hash", "2026-08-11T00:00:00Z", "2026-08-11T01:04:00Z");
    db.prepare("INSERT INTO hosting_v2_metering_proofs(id,contract_id,command_id,container_digest,runtime_state_digest,agent_started_at,agent_stopped_at,agent_runtime_seconds,server_measured_seconds,evidence_digest,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("proof-card-hours", "hosting-contract-1", "command-card-hours", `sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`, "2026-08-10T22:54:00Z", "2026-08-11T00:34:00Z", 6_000, 6_000, `sha256:${"3".repeat(64)}`, "2026-08-11T00:34:00Z");
    db.close();
    const settlement = { buyerOrganizationId: buyer.activeOrganization.id, orderId: "hosting-contract-1", measuredSeconds: 6_000, settledMicros: 6_000_000, supplierOrganizationId: supplier.activeOrganization.id, supplierIncomeMicros: 5_000_000, commissionMicros: 300_000, acceptanceMode: "BUYER", acceptanceDeadlineAt: "2026-08-11T01:04:00.000Z", acceptanceActorId: buyer.account.id, acceptancePayloadHash: "hosting-acceptance-hash", payloadHash: "hosting-settlement-hash", now: "2026-08-11T01:04:00Z" };
    assert.equal((await store.settleHostingOrder(settlement)).applied, true);
    assert.equal((await store.settleHostingOrder(settlement)).applied, false);

    const auditDb = new DatabaseSync(path);
    const volumeAudit = auditDb.prepare(`SELECT supplier_organization_id,contract_id,event_type,amount_micros,payload_digest,occurred_at
      FROM hosting_v2_supplier_fee_volume_events WHERE contract_id='hosting-contract-1'`).get();
    auditDb.close();
    assert.deepEqual({ ...volumeAudit }, {
      supplier_organization_id: supplier.activeOrganization.id,
      contract_id: "hosting-contract-1",
      event_type: "SETTLEMENT",
      amount_micros: 6_000_000,
      payload_digest: "hosting-settlement-hash",
      occurred_at: "2026-08-11T01:04:00Z",
    });

    const buyerDashboard = await store.dashboard(buyer.activeOrganization.id, "2026-08-11T01:04:01Z");
    const supplierDashboard = await store.dashboard(supplier.activeOrganization.id, "2026-08-11T01:04:01Z");
    const referrerDashboard = await store.dashboard(referrer.activeOrganization.id, "2026-08-11T01:04:01Z");
    assert.deepEqual(buyerDashboard.balance, { availableMicros: 4_000_000, heldMicros: 0, lifetimeTopupMicros: 10_000_000, lifetimeSpentMicros: 6_000_000 });
    assert.deepEqual(buyerDashboard.purchases, [{
      id: held.record.id,
      sourceSystem: "HOSTING_V2",
      orderId: "hosting-contract-1",
      amountMicros: 6_000_000,
      cnyReferenceCents: 601,
      status: "SETTLED",
      createdAt: "2026-08-11T01:01:00Z",
      updatedAt: "2026-08-11T01:04:00Z",
    }]);
    assert.deepEqual({ ...buyerDashboard.ledger.find((item) => item.business_key === "order:HOSTING_V2:hosting-contract-1") }, {
      operation: "ORDER_CAPTURE", business_key: "order:HOSTING_V2:hosting-contract-1", account_code: "USER_HELD",
      side: "DEBIT", amount_micros: 6_000_000, balance_after_micros: 0, created_at: "2026-08-11T01:04:00Z",
    });
    assert.equal(supplierDashboard.balance.availableMicros, 5_000_000);
    assert.equal(supplierDashboard.income.rentalVestedMicros, 5_000_000);
    assert.equal(referrerDashboard.balance.availableMicros, 300_000);
    assert.equal(referrerDashboard.income.commissionVestedMicros, 300_000);
  } finally { store.close(); hosting.close(); rmSync(directory, { recursive: true, force: true }); }
});
