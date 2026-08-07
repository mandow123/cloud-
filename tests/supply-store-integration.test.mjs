import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { parseCreateSupplyOffer, parseMacInventoryBatch } from "../lib/server/supply-domain.ts";
import { createD1SupplyStore } from "../lib/server/supply-store-d1.ts";
import { createSqliteSupplyStore } from "../lib/server/supply-store-sqlite.ts";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
let command = 0;

function context(actorId, prefix = "supply") {
  command += 1;
  return {
    actorId,
    idempotencyKey: `${prefix}:${String(command).padStart(12, "0")}`,
    payloadHash: command % 2 ? DIGEST_A : DIGEST_B,
  };
}

function addHours(value, hours) {
  return new Date(Date.parse(value) + hours * 3_600_000).toISOString();
}

function addDays(value, days) {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

function nextWholeHour() {
  const value = new Date(Date.now() + 3 * 3_600_000);
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

class FakeD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new FakeD1Statement(this.database, this.sql, values);
  }

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

class FakeD1Database {
  constructor() {
    this.database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  }

  prepare(sql) {
    return new FakeD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.execute("run"));
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function buildVerifiedH100(store) {
  const supplier = "supplier-kai-owned";
  const specDigest = `sha256:${"1".repeat(64)}`;
  const poolResult = await store.createPool(context(supplier, "pool"), {
    externalRef: "kai-h100-node-001",
    assetKind: "H100_8X_NODE",
    name: "KAI 自有 8×H100 SXM5 80GB",
    region: "中国香港",
    deliveryForm: "DEDICATED_SSH",
    specDigest,
  });
  const pool = poolResult.record.pool;
  const memberResult = await store.batchMembers(pool.id, context(supplier, "members"), [{
    externalRef: "h100-physical-node-001",
    serialDigest: `sha256:${"2".repeat(64)}`,
    hardwareUuidDigest: `sha256:${"3".repeat(64)}`,
    specDigest,
  }]);
  const member = memberResult.record.items[0];
  await store.batchComponents(member.id, context(supplier, "components"), Array.from({ length: 8 }, (_, index) => ({
    componentType: "GPU",
    identityDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    model: "NVIDIA H100 SXM5",
    memoryGiB: 80,
    topologyGroup: "NVSWITCH-NODE-001",
    specs: { migMode: "DISABLED", gpuIndex: index },
  })));
  const job = (await store.createVerificationJob(context(supplier, "verify-job"), member.id)).record;
  for (const evidenceType of ["GPU_INVENTORY", "GPU_TOPOLOGY", "GPU_BURN_IN", "SSH_CONNECTIVITY"]) {
    await store.addVerificationEvidence(job.id, context("ops-kai", "evidence"), {
      evidenceType,
      payloadDigest: DIGEST_A,
      summary: `${evidenceType} passed on the KAI-owned node`,
      observedAt: new Date().toISOString(),
    });
  }
  const mainStart = nextWholeHour();
  const mainEnd = addHours(mainStart, 12);
  const distantStart = addDays(mainStart, 31);
  const distantEnd = addHours(distantStart, 40);
  await store.completeVerification(job.id, context("ops-kai", "verify-complete"), {
    decision: "PASS",
    validUntil: addDays(distantEnd, 2),
  });
  const windows = (await store.batchAvailability(pool.id, context(supplier, "windows"), [
    { memberId: member.id, startAt: mainStart, endAt: mainEnd },
    { memberId: member.id, startAt: distantStart, endAt: distantEnd },
  ])).record.items;
  return { supplier, pool, member, mainStart, mainEnd, windows };
}

test("SQLite supply store executes the H100 verification, promotion, order, payment, refund and cleanup-safe inventory rules", async () => {
  const store = await createSqliteSupplyStore(":memory:");
  const fixture = await buildVerifiedH100(store);

  const spreadPreview = await store.previewPromotion(fixture.supplier, fixture.pool.id, fixture.windows.map((item) => item.id));
  assert.equal(spreadPreview.publishable, false);
  assert.ok(spreadPreview.blockers.includes("CAMPAIGN_30_DAY_WINDOW_EXCEEDED"));

  const preview = await store.previewPromotion(fixture.supplier, fixture.pool.id, [fixture.windows[0].id]);
  assert.equal(preview.publishable, true);
  assert.equal(preview.candidateNodeHours, 12);
  const promotion = (await store.commitPromotion(
    fixture.pool.id,
    context(fixture.supplier, "promotion"),
    [fixture.windows[0].id],
  )).record.promotions[0];
  const secondPool = (await store.createPool(context(fixture.supplier, "pool-secondary"), {
    externalRef: "kai-h100-node-002",
    assetKind: "H100_8X_NODE",
    name: "KAI secondary H100 pool",
    region: "中国香港",
    deliveryForm: "DEDICATED_SSH",
    specDigest: `sha256:${"9".repeat(64)}`,
  })).record.pool;
  const secondPoolPreview = await store.previewPromotion(fixture.supplier, secondPool.id, ["missing-window"]);
  assert.ok(secondPoolPreview.blockers.includes("H100_PILOT_SINGLE_POOL_ONLY"), "a second H100 pool must not duplicate pilot quotas");

  const firstOrder = (await store.createTrialOrder(context("buyer-00", "order"), {
    promotionId: promotion.id,
    startAt: fixture.mainStart,
    endAt: addHours(fixture.mainStart, 1),
  })).record;
  assert.equal(firstOrder.gpuCount, 8);
  assert.equal(firstOrder.amountCents, 800);
  await store.ensureTrialPayment(firstOrder.id, context("buyer-00", "payment"), {
    provider: "ALIPAY",
    providerOrderRef: firstOrder.id,
  });
  const capture = {
    provider: "ALIPAY",
    providerEventRef: "notify-h100-001",
    providerTransactionRef: "2026080622000000000001",
    eventType: "CAPTURED",
    amountCents: 800,
    payloadDigest: DIGEST_A,
    outcome: "APPLIED",
    occurredAt: new Date().toISOString(),
    toStatus: "CAPTURED",
  };
  const captured = await store.applyTrialPaymentEvent(firstOrder.id, context("alipay-notify", "capture"), capture);
  assert.equal(captured.record.payment.status, "CAPTURED");
  const duplicate = await store.applyTrialPaymentEvent(firstOrder.id, context("alipay-notify", "capture-redelivery"), capture);
  assert.equal(duplicate.replayed, true);

  const partial = await store.applyTrialPaymentEvent(firstOrder.id, context("ops-kai", "refund-part"), {
    ...capture,
    providerEventRef: "refund-h100-001-part",
    eventType: "REFUNDED_PARTIAL",
    amountCents: 100,
    toStatus: "REFUNDED",
  });
  assert.equal(partial.record.payment.status, "CAPTURED");
  const full = await store.applyTrialPaymentEvent(firstOrder.id, context("ops-kai", "refund-rest"), {
    ...capture,
    providerEventRef: "refund-h100-001-rest",
    eventType: "REFUNDED_FULL",
    amountCents: 700,
    toStatus: "REFUNDED",
  });
  assert.equal(full.record.payment.status, "REFUNDED");
  const refundedDetail = await store.getTrialOrder("buyer-00", firstOrder.id, "buyer");
  assert.equal(refundedDetail.order.status, "REFUNDED");
  assert.equal(refundedDetail.allocation.status, "CANCELLED");

  const sameBuyerContext = context("buyer-00", "second-order");
  const secondAttempt = () => store.createTrialOrder(sameBuyerContext, {
    promotionId: promotion.id,
    startAt: addHours(fixture.mainStart, 10),
    endAt: addHours(fixture.mainStart, 11),
  });
  await assert.rejects(secondAttempt, (error) => error?.message.includes("额度") || error?.message.includes("主体"));
  await assert.rejects(secondAttempt, (error) => error?.message.includes("额度") || error?.message.includes("主体"));

  const activeOrders = [];
  for (let index = 1; index < 10; index += 1) {
    const created = await store.createTrialOrder(context(`buyer-${String(index).padStart(2, "0")}`, "order"), {
      promotionId: promotion.id,
      startAt: addHours(fixture.mainStart, index),
      endAt: addHours(fixture.mainStart, index + 1),
    });
    assert.equal(created.record.amountCents, 800);
    activeOrders.push(created.record);
  }
  await assert.rejects(
    store.createTrialOrder(context("buyer-10", "order-limit"), {
      promotionId: promotion.id,
      startAt: addHours(fixture.mainStart, 10),
      endAt: addHours(fixture.mainStart, 11),
    }),
    (error) => error?.message.includes("主体") || error?.message.includes("额度"),
  );

  const serviceOrder = activeOrders[0];
  await store.ensureTrialPayment(serviceOrder.id, context("buyer-01", "payment"), { provider: "ALIPAY", providerOrderRef: serviceOrder.id });
  await store.applyTrialPaymentEvent(serviceOrder.id, context("alipay-notify", "capture-service"), {
    ...capture,
    providerEventRef: "notify-h100-service-001",
    providerTransactionRef: "2026080622000000000002",
  });
  let serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  await store.transitionTrialOrder(serviceOrder.id, context("buyer-01", "provision-order"), {
    expectedVersion: serviceDetail.order.version,
    toStatus: "PROVISIONING",
    reason: "public key accepted",
  });
  let delivery = await store.updateTrialDelivery(serviceOrder.id, context("buyer-01", "provision-delivery"), {
    expectedVersion: serviceDetail.delivery.version,
    toStatus: "PROVISIONING",
    buyerPublicKeyFingerprint: "SHA256:BuyerPublicKeyFingerprintExample",
  });
  delivery = await store.updateTrialDelivery(serviceOrder.id, context("ops-kai", "ready-delivery"), {
    expectedVersion: delivery.record.version,
    toStatus: "READY",
    secureEndpointRef: "secure-ref:h100-order-service-001",
    hostKeyFingerprint: "SHA256:HostKeyFingerprintExample",
    credentialExpiresAt: addDays(serviceOrder.endAt, 1),
  });
  serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  await store.transitionTrialOrder(serviceOrder.id, context("ops-kai", "deliver-order"), {
    expectedVersion: serviceDetail.order.version,
    toStatus: "DELIVERED",
    reason: "SSH ready",
  });
  await store.recordTrialConnectionCheck(serviceOrder.id, context("ops-kai", "connection"), {
    status: "PASSED",
    diagnosticCode: "SSH_AND_8GPU_READY",
    evidenceDigest: DIGEST_A,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });
  delivery = await store.updateTrialDelivery(serviceOrder.id, context("ops-kai", "service-delivery"), {
    expectedVersion: delivery.record.version,
    toStatus: "IN_SERVICE",
  });
  serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  await store.transitionTrialOrder(serviceOrder.id, context("ops-kai", "service-order"), {
    expectedVersion: serviceDetail.order.version,
    toStatus: "IN_SERVICE",
    reason: "connection passed",
  });
  const serviceRefund = await store.applyTrialPaymentEvent(serviceOrder.id, context("ops-kai", "refund-in-service"), {
    ...capture,
    providerEventRef: "refund-h100-service-full",
    providerTransactionRef: "2026080622000000000002",
    eventType: "REFUNDED_FULL",
    amountCents: serviceOrder.amountCents,
    toStatus: "REFUNDED",
  });
  assert.equal(serviceRefund.record.payment.status, "REFUNDED");
  serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  assert.equal(serviceDetail.order.status, "IN_SERVICE", "a financial refund must not bypass the delivery lifecycle");
  assert.equal(serviceDetail.allocation.status, "IN_SERVICE", "refunded in-service capacity remains locked until cleanup evidence exists");
  delivery = await store.updateTrialDelivery(serviceOrder.id, context("ops-kai", "cleaning-delivery"), {
    expectedVersion: delivery.record.version,
    toStatus: "CLEANING",
  });
  serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  await store.transitionTrialOrder(serviceOrder.id, context("ops-kai", "complete-order"), {
    expectedVersion: serviceDetail.order.version,
    toStatus: "COMPLETED",
    reason: "service window complete",
  });
  serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  assert.equal(serviceDetail.allocation.status, "LOCKED", "capacity must remain locked before cleanup evidence exists");
  await store.updateTrialDelivery(serviceOrder.id, context("ops-kai", "cleanup-delivery"), {
    expectedVersion: delivery.record.version,
    toStatus: "COMPLETED",
    cleanupEvidenceDigest: DIGEST_B,
  });
  serviceDetail = await store.getTrialOrder("buyer-01", serviceOrder.id, "buyer");
  assert.equal(serviceDetail.allocation.status, "RELEASED");
  assert.equal(serviceDetail.delivery.status, "COMPLETED");
});

test("300 Mac mini records import idempotently into deterministic inventory-only groups", async () => {
  const store = await createSqliteSupplyStore(":memory:");
  const supplier = "supplier-mac-kai";
  const items = Array.from({ length: 300 }, (_, index) => {
    const pro = index >= 200;
    return {
      externalRef: `mac-mini-${String(index + 1).padStart(3, "0")}`,
      serialDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
      hardwareUuidDigest: null,
      model: "Mac mini",
      chip: pro ? "M4 Pro" : "M4",
      memoryGiB: pro ? 24 : 16,
      storageGiB: 512,
      region: "中国香港",
      networkProfile: "10GbE",
      deliveryForm: "MACOS_SSH_CI",
      specDigest: pro ? `sha256:${"e".repeat(64)}` : `sha256:${"d".repeat(64)}`,
    };
  });
  await assert.rejects(
    parseMacInventoryBatch({ items: [...items, { ...items[0], externalRef: "mac-mini-301", serialDigest: `sha256:${"f".repeat(64)}` }] }),
    (error) => error?.status === 400 || error?.message.includes("300"),
  );
  const importContext = context(supplier, "mac-import");
  const first = await store.importMacInventory(importContext, items);
  assert.equal(first.record.groups.length, 2);
  assert.deepEqual(first.record.groups.map((group) => group.items.length).sort((a, b) => b - a), [200, 100]);
  assert.ok(first.record.groups.every((group) => group.policy.publicationMode === "INVENTORY_ONLY"));
  const replay = await store.importMacInventory(importContext, items);
  assert.equal(replay.replayed, true);
  await store.importMacInventory(context(supplier, "mac-reimport"), items);
  const pools = await store.listPools(supplier);
  assert.equal(pools.length, 2);
  const memberCount = (await Promise.all(pools.map((entry) => store.listMembers(supplier, entry.pool.id))))
    .reduce((sum, members) => sum + members.length, 0);
  assert.equal(memberCount, 300);
});

test("D1 adapter executes the same H100 guards and payment state machine as SQLite", async () => {
  const store = await createD1SupplyStore(new FakeD1Database());
  const fixture = await buildVerifiedH100(store);
  const spread = await store.previewPromotion(fixture.supplier, fixture.pool.id, fixture.windows.map((item) => item.id));
  assert.equal(spread.publishable, false);
  assert.ok(spread.blockers.includes("CAMPAIGN_30_DAY_WINDOW_EXCEEDED"));
  const promotion = (await store.commitPromotion(
    fixture.pool.id,
    context(fixture.supplier, "d1-promotion"),
    [fixture.windows[0].id],
  )).record.promotions[0];
  const order = (await store.createTrialOrder(context("d1-buyer", "d1-order"), {
    promotionId: promotion.id,
    startAt: fixture.mainStart,
    endAt: addHours(fixture.mainStart, 1),
  })).record;
  assert.equal(order.amountCents, 800);
  await store.ensureTrialPayment(order.id, context("d1-buyer", "d1-payment"), { provider: "ALIPAY", providerOrderRef: order.id });
  await store.applyTrialPaymentEvent(order.id, context("alipay-notify", "d1-capture"), {
    provider: "ALIPAY",
    providerEventRef: "d1-notify-h100-001",
    providerTransactionRef: "2026080622000000000099",
    eventType: "CAPTURED",
    amountCents: 800,
    payloadDigest: DIGEST_A,
    outcome: "APPLIED",
    occurredAt: new Date().toISOString(),
    toStatus: "CAPTURED",
  });
  const detail = await store.getTrialOrder("d1-buyer", order.id, "buyer");
  assert.equal(detail.order.status, "PAID");
  assert.equal(detail.payment.status, "CAPTURED");
  assert.equal(detail.delivery.status, "AWAITING_KEY");
  assert.equal(detail.allocation.status, "LOCKED");
});

test("generic supply offers validate unit contracts, remain private and behave identically on SQLite and D1", async () => {
  const startAt = nextWholeHour();
  const endAt = addDays(startAt, 7);
  const cases = [
    ["GPU_CARD", "CARD", "CARD_HOUR"], ["GPU_SERVER", "NODE", "NODE_HOUR"],
    ["CPU_SERVER", "SERVER", "SERVER_HOUR"], ["MAC_COMPUTE", "NODE", "NODE_HOUR"],
    ["TOKEN_CAPACITY", "M_TOKENS_PER_HOUR", "TOKEN_CAPACITY_HOUR"],
    ["MODEL_INSTANCE", "MODEL_INSTANCE", "MODEL_INSTANCE_HOUR"], ["NAS_STORAGE", "TIB", "TIB_HOUR"],
    ["RACK_CAPACITY", "RACK", "RACK_MONTH"], ["RACK_CAPACITY", "KW", "KW_MONTH"],
    ["CLOUD_RESOURCE", "QUOTA_UNIT", "QUOTA_HOUR"],
  ];
  for (const [resourceType, quantityUnit, pricingUnit] of cases) {
    const parsed = parseCreateSupplyOffer({ supplierType: "COMPANY", resourceType, quantity: 2, quantityUnit, pricingUnit,
      productName: `${resourceType} product`, specification: "auditable general supply specification", region: "cn-east",
      deliveryForm: "contract delivery", availabilityStartAt: startAt, availabilityEndAt: endAt });
    assert.equal(parsed.resourceType, resourceType);
  }
  const withoutWindow = parseCreateSupplyOffer({ supplierType: "INDIVIDUAL", resourceType: "GPU_CARD", quantity: 1,
    quantityUnit: "CARD", pricingUnit: "CARD_HOUR", productName: "single GPU", specification: "80GB accelerator",
    region: "cn-east", deliveryForm: "remote access" });
  assert.equal(withoutWindow.availabilityStartAt, null);
  assert.equal(withoutWindow.availabilityEndAt, null);
  assert.throws(() => parseCreateSupplyOffer({ ...withoutWindow, supplierType: "KAI_SELF" }));
  assert.throws(() => parseCreateSupplyOffer({ ...withoutWindow, resourceType: "NAS_STORAGE" }));
  assert.throws(() => parseCreateSupplyOffer({ ...withoutWindow, quantity: 1.5 }));
  assert.throws(() => parseCreateSupplyOffer({ ...withoutWindow, availabilityStartAt: startAt }));
  assert.throws(() => parseCreateSupplyOffer({ ...withoutWindow, availabilityStartAt: endAt, availabilityEndAt: startAt }));

  for (const store of [await createSqliteSupplyStore(":memory:"), await createD1SupplyStore(new FakeD1Database())]) {
    const input = parseCreateSupplyOffer({ supplierType: "IDC", resourceType: "RACK_CAPACITY", quantity: 8,
      quantityUnit: "KW", pricingUnit: "KW_MONTH", productName: "East DC power capacity", specification: "A/B feed, metered power",
      region: "cn-east", deliveryForm: "rack power allocation", notes: "verification required before publication" });
    const commandContext = context("offer-supplier-a", "generic-offer");
    const created = await store.createOffer(commandContext, input);
    assert.equal(created.record.status, "SUBMITTED");
    assert.equal(created.record.supplierActorId, "offer-supplier-a");
    assert.equal((await store.createOffer(commandContext, input)).replayed, true);
    await store.createOffer(context("offer-supplier-b", "generic-offer"), { ...input, productName: "Private supplier B offer" });
    const own = await store.listOffers("offer-supplier-a");
    assert.equal(own.length, 1);
    assert.equal(own[0].productName, input.productName);
    assert.ok(own.every((item) => item.status !== "PUBLISHED"));
  }
});
