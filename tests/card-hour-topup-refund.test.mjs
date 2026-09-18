import assert from "node:assert/strict";
import test from "node:test";

import { executeApprovedTopupRefund } from "../lib/server/card-hour-topup-refund-service.ts";
import { paymentFixture } from "./helpers/payment-fixture.mjs";

async function capturedTopup(fixture, provider = "QIXIANG_PAY", suffix = "one") {
  const created = await fixture.card.createTopup({
    account: fixture.account,
    provider,
    providerMerchantRef: provider === "QIXIANG_PAY" ? "10086" : null,
    providerPaymentType: provider === "QIXIANG_PAY" ? "alipay" : null,
    cardHourMicros: 5_000_000,
    amountCents: 501,
    idempotencyKey: `refund-topup-${suffix}`,
    payloadHash: `refund-topup-hash-${suffix}`,
    now: fixture.input.now,
    expiresAt: new Date(Date.parse(fixture.input.now) + 900_000).toISOString(),
  });
  await fixture.card.applyTopupEvent({
    orderId: created.record.id,
    provider,
    providerEventId: `${provider.toLowerCase()}:notify:refund-${suffix}`,
    providerTransactionId: `trade-refund-${suffix}`,
    eventType: "CAPTURED",
    amountCents: 501,
    payloadDigest: suffix.padEnd(64, "0").slice(0, 64),
    occurredAt: fixture.input.now,
    receivedAt: fixture.input.now,
  });
  return created.record;
}

async function approvedRefund(fixture, orderId, suffix = "one") {
  const requested = await fixture.card.requestTopupRefund({
    orderId,
    requestedBy: "finance-requester",
    reason: "Customer requested a reviewed full top-up refund.",
    payloadHash: `refund-request-hash-${suffix}`,
    now: fixture.input.now,
  });
  return fixture.card.decideTopupRefund({
    refundId: requested.record.id,
    decision: "APPROVE",
    approvedBy: "finance-approver",
    reason: "Independent finance approval after reviewing payment evidence.",
    expectedVersion: 1,
    now: new Date(Date.parse(fixture.input.now) + 1_000).toISOString(),
  });
}

test("Qixiang refund remains held until approved merchant-console evidence is recorded", async () => {
  const fixture = await paymentFixture();
  try {
    const before = fixture.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros;
    const topup = await capturedTopup(fixture);
    assert.equal(fixture.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros, before + 5_000_000);
    const refund = await approvedRefund(fixture, topup.id);
    const waiting = await executeApprovedTopupRefund(fixture.card, refund.id, "finance-approver", { now: () => new Date("2026-08-22T00:02:00.000Z") });
    assert.equal(waiting.record.status, "MANUAL_REQUIRED");
    assert.deepEqual({ ...fixture.db.prepare("SELECT available_micros,held_micros FROM card_hour_wallets").get() }, { available_micros: before, held_micros: 5_000_000 });
    const completed = await fixture.card.confirmManualTopupRefund({
      refundId: refund.id,
      approvedBy: "finance-approver",
      providerTransactionId: "qixiang-refund-proof-001",
      evidenceDigest: "a".repeat(64),
      now: "2026-08-22T00:03:00.000Z",
    });
    assert.equal(completed.status, "SUCCEEDED");
    assert.deepEqual({ ...fixture.db.prepare("SELECT available_micros,held_micros FROM card_hour_wallets").get() }, { available_micros: before, held_micros: 0 });
    assert.equal((await fixture.card.getTopup(topup.id)).status, "CLOSED");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key LIKE 'topup-refund-%'").get().count, 2);
    const replay = await fixture.card.confirmManualTopupRefund({
      refundId: refund.id,
      approvedBy: "finance-approver",
      providerTransactionId: "qixiang-refund-proof-001",
      evidenceDigest: "a".repeat(64),
      now: "2026-08-22T00:04:00.000Z",
    });
    assert.equal(replay.status, "SUCCEEDED");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key LIKE 'topup-refund-%'").get().count, 2);
    await assert.rejects(fixture.card.confirmManualTopupRefund({
      refundId: refund.id,
      approvedBy: "finance-approver",
      providerTransactionId: "different-proof",
      evidenceDigest: "b".repeat(64),
      now: "2026-08-22T00:05:00.000Z",
    }), (error) => error.code === "CARD_HOUR_TOPUP_REFUND_MANUAL_CONFLICT");
  } finally { fixture.db.close(); }
});

test("refund cannot enter the merchant-console step when credited card-hours are unavailable", async () => {
  const fixture = await paymentFixture();
  try {
    const topup = await capturedTopup(fixture, "QIXIANG_PAY", "spent");
    const refund = await approvedRefund(fixture, topup.id, "spent");
    fixture.db.prepare("UPDATE card_hour_wallets SET available_micros=0 WHERE organization_id=?").run(fixture.account.activeOrganization.id);
    await assert.rejects(executeApprovedTopupRefund(fixture.card, refund.id, "finance-approver"));
    assert.equal((await fixture.card.getTopupRefund(refund.id)).status, "APPROVED");
  } finally { fixture.db.close(); }
});

test("the same Qixiang merchant refund proof cannot settle two topups", async () => {
  const fixture = await paymentFixture();
  try {
    const firstTopup = await capturedTopup(fixture, "QIXIANG_PAY", "proof-one");
    const secondTopup = await capturedTopup(fixture, "QIXIANG_PAY", "proof-two");
    const firstRefund = await approvedRefund(fixture, firstTopup.id, "proof-one");
    const secondRefund = await approvedRefund(fixture, secondTopup.id, "proof-two");
    await executeApprovedTopupRefund(fixture.card, firstRefund.id, "finance-approver", { now: () => new Date("2026-08-22T00:02:00.000Z") });
    await executeApprovedTopupRefund(fixture.card, secondRefund.id, "finance-approver", { now: () => new Date("2026-08-22T00:02:00.000Z") });
    await fixture.card.confirmManualTopupRefund({
      refundId: firstRefund.id,
      approvedBy: "finance-approver",
      providerTransactionId: "unique-qixiang-refund",
      evidenceDigest: "c".repeat(64),
      now: "2026-08-22T00:03:00.000Z",
    });
    await assert.rejects(fixture.card.confirmManualTopupRefund({
      refundId: secondRefund.id,
      approvedBy: "finance-approver",
      providerTransactionId: "unique-qixiang-refund",
      evidenceDigest: "d".repeat(64),
      now: "2026-08-22T00:04:00.000Z",
    }), (error) => error.code === "CARD_HOUR_TOPUP_REFUND_MANUAL_CONFLICT");
    assert.equal((await fixture.card.getTopupRefund(secondRefund.id)).status, "MANUAL_REQUIRED");
  } finally { fixture.db.close(); }
});

test("refund request replay is idempotent and changed input conflicts", async () => {
  const fixture = await paymentFixture();
  try {
    const topup = await capturedTopup(fixture, "QIXIANG_PAY", "request-replay");
    const input = {
      orderId: topup.id,
      requestedBy: "finance-requester",
      reason: "Customer requested a reviewed full top-up refund.",
      payloadHash: "refund-request-replay",
      now: fixture.input.now,
    };
    const first = await fixture.card.requestTopupRefund(input);
    const replay = await fixture.card.requestTopupRefund(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.record.id, first.record.id);
    await assert.rejects(fixture.card.requestTopupRefund({ ...input, payloadHash: "refund-request-changed" }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  } finally { fixture.db.close(); }
});

test("the refund requester cannot approve their own request", async () => {
  const fixture = await paymentFixture();
  try {
    const topup = await capturedTopup(fixture, "QIXIANG_PAY", "dual");
    const requested = await fixture.card.requestTopupRefund({ orderId: topup.id, requestedBy: "same-admin", reason: "A valid refund request requiring independent approval.", payloadHash: "dual-control", now: fixture.input.now });
    await assert.rejects(fixture.card.decideTopupRefund({ refundId: requested.record.id, decision: "APPROVE", approvedBy: "same-admin", reason: "Attempting to approve the same refund request.", expectedVersion: 1, now: fixture.input.now }), (error) => error.code === "CARD_HOUR_TOPUP_REFUND_DUAL_CONTROL");
  } finally { fixture.db.close(); }
});
