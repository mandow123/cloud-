import assert from "node:assert/strict";
import test from "node:test";

import { cnyCentsToCardHourMicros, formatCardHourMicros, parseTopupCardHours, topupAmountCents } from "../lib/card-hours.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";

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

test("captured topup credits once and order capture cannot overdraw or replay twice", async () => {
  const store = await createSqliteCardHourStore(":memory:");
  try {
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

test("hosting order hold settles actual usage once and vests rental and referral income", async () => {
  const store = await createSqliteCardHourStore(":memory:");
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

    const settlement = { account: buyer, orderId: "hosting-contract-1", settledMicros: 6_000_000, supplierOrganizationId: supplier.activeOrganization.id, supplierIncomeMicros: 5_000_000, commissionMicros: 300_000, payloadHash: "hosting-settlement-hash", now: "2026-08-11T01:04:00Z" };
    assert.equal((await store.settleHostingOrder(settlement)).applied, true);
    assert.equal((await store.settleHostingOrder(settlement)).applied, false);

    const buyerDashboard = await store.dashboard(buyer.activeOrganization.id, "2026-08-11T01:04:01Z");
    const supplierDashboard = await store.dashboard(supplier.activeOrganization.id, "2026-08-11T01:04:01Z");
    const referrerDashboard = await store.dashboard(referrer.activeOrganization.id, "2026-08-11T01:04:01Z");
    assert.deepEqual(buyerDashboard.balance, { availableMicros: 4_000_000, heldMicros: 0, lifetimeTopupMicros: 10_000_000, lifetimeSpentMicros: 6_000_000 });
    assert.equal(supplierDashboard.balance.availableMicros, 5_000_000);
    assert.equal(supplierDashboard.income.rentalVestedMicros, 5_000_000);
    assert.equal(referrerDashboard.balance.availableMicros, 300_000);
    assert.equal(referrerDashboard.income.commissionVestedMicros, 300_000);
  } finally { store.close(); }
});
