import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPPLY_OFFER_RESOURCE_TYPES,
  SUPPLY_OFFER_SUPPLIER_TYPES,
  parseCreateSupplyOffer,
} from "../lib/server/supply-domain.ts";
import { createSqliteSupplyStore } from "../lib/server/supply-store-sqlite.ts";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

const resourceCases = [
  ["GPU_CARD", "CARD", "CARD_HOUR"],
  ["GPU_SERVER", "NODE", "NODE_HOUR"],
  ["CPU_SERVER", "SERVER", "SERVER_HOUR"],
  ["MAC_COMPUTE", "NODE", "NODE_HOUR"],
  ["TOKEN_CAPACITY", "M_TOKENS_PER_HOUR", "TOKEN_CAPACITY_HOUR"],
  ["MODEL_INSTANCE", "MODEL_INSTANCE", "MODEL_INSTANCE_HOUR"],
  ["NAS_STORAGE", "TIB", "TIB_HOUR"],
  ["RACK_CAPACITY", "RACK", "RACK_MONTH"],
  ["CLOUD_RESOURCE", "QUOTA_UNIT", "QUOTA_HOUR"],
];

function offer(overrides = {}) {
  return {
    supplierType: "COMPANY",
    resourceType: "GPU_CARD",
    quantity: 1,
    quantityUnit: "CARD",
    pricingUnit: "CARD_HOUR",
    productName: "Audited general supply",
    specification: "A supplier-declared resource that still requires platform verification",
    region: "cn-east",
    deliveryForm: "controlled account delivery",
    notes: null,
    ...overrides,
  };
}

test("all nine general resource types and all four public supplier identities pass their exact unit contracts", () => {
  assert.deepEqual([...SUPPLY_OFFER_RESOURCE_TYPES], resourceCases.map(([resourceType]) => resourceType));
  assert.deepEqual([...SUPPLY_OFFER_SUPPLIER_TYPES], ["INDIVIDUAL", "COMPANY", "IDC", "CLOUD_VENDOR"]);

  for (const supplierType of SUPPLY_OFFER_SUPPLIER_TYPES) {
    for (const [resourceType, quantityUnit, pricingUnit] of resourceCases) {
      const parsed = parseCreateSupplyOffer(offer({ supplierType, resourceType, quantityUnit, pricingUnit }));
      assert.equal(parsed.supplierType, supplierType);
      assert.equal(parsed.resourceType, resourceType);
      assert.equal(parsed.quantityUnit, quantityUnit);
      assert.equal(parsed.pricingUnit, pricingUnit);
    }
  }
});

test("KAI_SELF is preset-only and cannot be declared through the general offer contract", () => {
  assert.throws(
    () => parseCreateSupplyOffer(offer({ supplierType: "KAI_SELF" })),
    (error) => error?.status === 400 && /supplierType/u.test(error.message),
  );
});

test("zero, negative, fractional and over-limit quantities are rejected server-side", () => {
  for (const quantity of [0, -1, 1.5, 100_001]) {
    assert.throws(
      () => parseCreateSupplyOffer(offer({ quantity })),
      (error) => error?.status === 400,
      `quantity ${quantity} must be rejected`,
    );
  }
  assert.equal(parseCreateSupplyOffer(offer({ quantity: 100_000 })).quantity, 100_000);
});

test("every general resource type rejects a mismatched quantity/pricing unit pair", () => {
  for (const [resourceType, quantityUnit, pricingUnit] of resourceCases) {
    const mismatched = resourceType === "GPU_CARD"
      ? { quantityUnit: "NODE", pricingUnit: "NODE_HOUR" }
      : { quantityUnit: "CARD", pricingUnit: "CARD_HOUR" };
    assert.throws(
      () => parseCreateSupplyOffer(offer({ resourceType, quantityUnit, pricingUnit, ...mismatched })),
      (error) => error?.status === 422 && /不兼容/u.test(error.message),
      `${resourceType} accepted a mismatched unit pair`,
    );
  }
});

test("optional availability accepts both endpoints absent, rejects one-sided and reversed windows", () => {
  const parsed = parseCreateSupplyOffer(offer());
  assert.equal(parsed.availabilityStartAt, null);
  assert.equal(parsed.availabilityEndAt, null);

  assert.throws(() => parseCreateSupplyOffer(offer({ availabilityStartAt: "2026-08-10T00:00:00.000Z" })));
  assert.throws(() => parseCreateSupplyOffer(offer({
    availabilityStartAt: "2026-08-11T00:00:00.000Z",
    availabilityEndAt: "2026-08-10T00:00:00.000Z",
  })));
});

test("general offers persist privately, replay idempotently, conflict on changed payload and never become market promotions", async () => {
  const store = await createSqliteSupplyStore(":memory:");
  const input = parseCreateSupplyOffer(offer({
    supplierType: "CLOUD_VENDOR",
    resourceType: "CLOUD_RESOURCE",
    quantity: 20,
    quantityUnit: "QUOTA_UNIT",
    pricingUnit: "QUOTA_HOUR",
  }));
  const context = { actorId: "general-supplier-a", idempotencyKey: "general-offer-audit-001", payloadHash: DIGEST_A };
  const created = await store.createOffer(context, input);
  assert.equal(created.record.status, "SUBMITTED");
  assert.equal(created.record.supplierActorId, "general-supplier-a");
  assert.equal((await store.createOffer(context, input)).replayed, true);

  await assert.rejects(
    store.createOffer({ ...context, payloadHash: DIGEST_B }, { ...input, quantity: 21 }),
    (error) => error?.name === "ExchangeIdempotencyConflictError" && error?.message === "IDEMPOTENCY_CONFLICT",
  );

  assert.deepEqual(await store.listOffers("general-supplier-b"), [], "another supplier must not read tenant A records");
  const tenantB = await store.createOffer(
    { actorId: "general-supplier-b", idempotencyKey: context.idempotencyKey, payloadHash: DIGEST_A },
    { ...input, productName: "Tenant B private offer" },
  );
  assert.equal(tenantB.record.supplierActorId, "general-supplier-b");
  assert.equal((await store.listOffers("general-supplier-a")).length, 1);
  assert.equal((await store.listOffers("general-supplier-b")).length, 1);

  assert.deepEqual(await store.listPromotions(), [], "general offers must not appear in public promotional inventory");
  await assert.rejects(
    store.createTrialOrder(
      { actorId: "general-buyer", idempotencyKey: "generic-checkout-audit-01", payloadHash: DIGEST_A },
      { promotionId: created.record.id, startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-01T01:00:00.000Z" },
    ),
    (error) => error?.code === "SUPPLY_NOT_FOUND",
    "a generic offer id must not be accepted as an H100 promotion id",
  );
});
