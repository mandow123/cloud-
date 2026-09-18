import assert from "node:assert/strict";
import test from "node:test";

import { paymentFixture } from "./helpers/payment-fixture.mjs";

test("direct Alipay checkout claim, attachment and callback credit are atomic and idempotent", async () => {
  const fixture = await paymentFixture();
  try {
    const created = await fixture.card.createTopup({
      account: fixture.account,
      provider: "ALIPAY",
      providerMerchantRef: null,
      providerPaymentType: null,
      cardHourMicros: 5_000_000,
      amountCents: 501,
      idempotencyKey: "alipay-direct-topup-0001",
      payloadHash: "alipay-direct-payload-0001",
      now: fixture.input.now,
      expiresAt: new Date(Date.parse(fixture.input.now) + 15 * 60_000).toISOString(),
    });
    assert.equal(created.record.provider, "ALIPAY");
    assert.equal(created.record.channel, "ALIPAY");
    const claimed = await fixture.card.claimTopupCheckout({
      organizationId: fixture.account.activeOrganization.id,
      orderId: created.record.id,
      now: new Date(Date.parse(fixture.input.now) + 1_000).toISOString(),
    });
    assert.equal(claimed.claimed, true);
    const checkoutUrl = "https://openapi.alipay.com/gateway.do?synthetic=1";
    await fixture.card.attachTopupCheckout({
      organizationId: fixture.account.activeOrganization.id,
      orderId: created.record.id,
      checkoutUrl,
      now: new Date(Date.parse(fixture.input.now) + 2_000).toISOString(),
    });
    assert.equal((await fixture.card.getTopup(created.record.id)).checkoutUrl, checkoutUrl);
    const before = fixture.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros;
    const event = {
      orderId: created.record.id,
      provider: "ALIPAY",
      providerEventId: "notify-alipay-direct-0001",
      providerTransactionId: "2026091822000000000001",
      eventType: "CAPTURED",
      amountCents: 501,
      payloadDigest: "a".repeat(64),
      occurredAt: new Date(Date.parse(fixture.input.now) + 3_000).toISOString(),
      receivedAt: new Date(Date.parse(fixture.input.now) + 4_000).toISOString(),
    };
    assert.equal((await fixture.card.applyTopupEvent(event)).applied, true);
    assert.equal((await fixture.card.applyTopupEvent(event)).applied, false);
    assert.equal(fixture.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros, before + 5_000_000);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE operation='TOPUP'").get().count, 1);
  } finally {
    fixture.db.close();
  }
});

test("provider-namespaced event ids let both rails credit even when transaction references match", async () => {
  const fixture = await paymentFixture();
  try {
    const inputs = [
      { provider: "ALIPAY", providerMerchantRef: null, providerPaymentType: null, key: "direct" },
      { provider: "QIXIANG_PAY", providerMerchantRef: "10086", providerPaymentType: "alipay", key: "qixiang" },
    ];
    const created = [];
    for (const input of inputs) created.push((await fixture.card.createTopup({
      account: fixture.account,
      provider: input.provider,
      providerMerchantRef: input.providerMerchantRef,
      providerPaymentType: input.providerPaymentType,
      cardHourMicros: 5_000_000,
      amountCents: 501,
      idempotencyKey: `cross-provider-${input.key}`,
      payloadHash: `cross-provider-hash-${input.key}`,
      now: fixture.input.now,
      expiresAt: new Date(Date.parse(fixture.input.now) + 15 * 60_000).toISOString(),
    })).record);
    const before = fixture.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros;
    for (let index = 0; index < created.length; index += 1) {
      const provider = inputs[index].provider;
      const applied = await fixture.card.applyTopupEvent({
        orderId: created[index].id,
        provider,
        providerEventId: `${provider === "ALIPAY" ? "alipay" : "qixiang"}:query:shared-trade:TRADE_SUCCESS`,
        providerTransactionId: "shared-trade-reference",
        eventType: "CAPTURED",
        amountCents: 501,
        payloadDigest: String(index).repeat(64),
        occurredAt: fixture.input.now,
        receivedAt: fixture.input.now,
      });
      assert.equal(applied.applied, true);
    }
    assert.equal(fixture.db.prepare("SELECT available_micros FROM card_hour_wallets").get().available_micros, before + 10_000_000);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE operation='TOPUP'").get().count, 2);
  } finally { fixture.db.close(); }
});
