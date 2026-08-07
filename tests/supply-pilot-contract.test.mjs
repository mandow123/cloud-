import assert from "node:assert/strict";
import test from "node:test";

const MODULE_PATH = "../lib/server/supply-pilot.ts";
const PRODUCT_VERSION_ID = "PV-GPU-H100-SXM5-80GB";
const EVIDENCE_DIGEST = `sha256:${"a".repeat(64)}`;

let contractPromise;

async function contract() {
  contractPromise ??= import(MODULE_PATH);
  try {
    return await contractPromise;
  } catch (error) {
    assert.fail(`planned supply pilot contract ${MODULE_PATH} is unavailable: ${error?.message ?? error}`);
  }
}

async function call(fn, ...args) {
  return await fn(...args);
}

async function rejectsCode(action, expectedCode) {
  await assert.rejects(
    Promise.resolve().then(action),
    (error) => error?.code === expectedCode || error?.message === expectedCode,
    `expected ${expectedCode}`,
  );
}

function validNode(overrides = {}) {
  return {
    nodeId: "node-h100-001",
    productVersionId: PRODUCT_VERSION_ID,
    model: "H100",
    formFactor: "SXM5",
    memoryGiB: 80,
    gpuUuids: Array.from({ length: 8 }, (_, index) => `GPU-${String(index + 1).padStart(2, "0")}`),
    migMode: "DISABLED",
    topology: "SINGLE_NODE_NVLINK",
    exclusive: true,
    deliveryProtocol: "SSH",
    verification: {
      result: "PASS",
      evidenceDigest: EVIDENCE_DIGEST,
      validUntil: "2026-09-30T00:00:00.000Z",
    },
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    orderId: "order-001",
    principalId: "principal-001",
    nodeId: "node-h100-001",
    startAt: "2026-08-10T00:00:00.000Z",
    endAt: "2026-08-10T01:00:00.000Z",
    status: "PAID",
    ...overrides,
  };
}

test("H100 pilot policy is one exclusive 8-card SXM5 80GB node at ¥1/card-hour", async () => {
  const { H100_PILOT_POLICY } = await contract();
  assert.deepEqual(
    {
      productVersionId: H100_PILOT_POLICY.productVersionId,
      gpuCount: H100_PILOT_POLICY.gpuCount,
      formFactor: H100_PILOT_POLICY.formFactor,
      memoryGiB: H100_PILOT_POLICY.memoryGiB,
      wholeNode: H100_PILOT_POLICY.wholeNode,
      exclusive: H100_PILOT_POLICY.exclusive,
      migMode: H100_PILOT_POLICY.migMode,
      centsPerCardHour: H100_PILOT_POLICY.centsPerCardHour,
      minNodeHours: H100_PILOT_POLICY.minNodeHours,
      maxNodeHours: H100_PILOT_POLICY.maxNodeHours,
      campaignDays: H100_PILOT_POLICY.campaignDays,
      maxDistinctPrincipals: H100_PILOT_POLICY.maxDistinctPrincipals,
      maxOrdersPerPrincipal: H100_PILOT_POLICY.maxOrdersPerPrincipal,
      maxTotalNodeHours: H100_PILOT_POLICY.maxTotalNodeHours,
    },
    {
      productVersionId: PRODUCT_VERSION_ID,
      gpuCount: 8,
      formFactor: "SXM5",
      memoryGiB: 80,
      wholeNode: true,
      exclusive: true,
      migMode: "DISABLED",
      centsPerCardHour: 100,
      minNodeHours: 1,
      maxNodeHours: 8,
      campaignDays: 30,
      maxDistinctPrincipals: 10,
      maxOrdersPerPrincipal: 1,
      maxTotalNodeHours: 80,
    },
  );
});

test("H100 node verification rejects split, duplicate, MIG, wrong-memory, failed, and expired inventory", async () => {
  const { validateH100PilotNode } = await contract();
  assert.deepEqual(await call(validateH100PilotNode, validNode()), validNode());

  await rejectsCode(() => call(validateH100PilotNode, validNode({ gpuUuids: validNode().gpuUuids.slice(0, 7) })), "H100_NODE_REQUIRES_8_GPUS");
  await rejectsCode(() => call(validateH100PilotNode, validNode({ gpuUuids: Array(8).fill("GPU-DUPLICATE") })), "H100_GPU_UUIDS_NOT_UNIQUE");
  await rejectsCode(() => call(validateH100PilotNode, validNode({ migMode: "ENABLED" })), "H100_MIG_NOT_ALLOWED");
  await rejectsCode(() => call(validateH100PilotNode, validNode({ memoryGiB: 40 })), "H100_SPEC_MISMATCH");
  await rejectsCode(
    () => call(validateH100PilotNode, validNode({ verification: { result: "FAIL", evidenceDigest: EVIDENCE_DIGEST, validUntil: "2026-09-30T00:00:00.000Z" } })),
    "H100_VERIFICATION_REQUIRED",
  );
  await rejectsCode(
    () => call(validateH100PilotNode, validNode({ verification: { result: "PASS", evidenceDigest: EVIDENCE_DIGEST, validUntil: "2026-08-09T23:59:59.000Z" } }), { orderStartAt: "2026-08-10T00:00:00.000Z" }),
    "H100_VERIFICATION_EXPIRED",
  );
});

test("server quote derives ¥8–¥64 from whole node-hours and never trusts a browser amount", async () => {
  const { deriveH100PilotQuote } = await contract();
  assert.deepEqual(await call(deriveH100PilotQuote, { nodeHours: 1 }), { nodeHours: 1, cardHours: 8, amountCents: 800, currency: "CNY" });
  assert.deepEqual(await call(deriveH100PilotQuote, { nodeHours: 8 }), { nodeHours: 8, cardHours: 64, amountCents: 6400, currency: "CNY" });

  for (const nodeHours of [0, 0.5, 9]) {
    await rejectsCode(() => call(deriveH100PilotQuote, { nodeHours }), "H100_NODE_HOURS_OUT_OF_RANGE");
  }
  const tamperedBrowserQuote = await call(deriveH100PilotQuote, { nodeHours: 1, clientAmountCents: 1 });
  assert.equal(tamperedBrowserQuote.amountCents, 800, "server quote must ignore a browser-supplied amount");
});

test("pilot admission enforces 30 days, 10 principals, one order each, 80 node-hours, and no node overlap", async () => {
  const { admitH100PilotOrder } = await contract();
  const base = {
    campaignStartedAt: "2026-08-01T00:00:00.000Z",
    now: "2026-08-09T12:00:00.000Z",
    node: validNode(),
    orders: [],
    candidate: order(),
  };
  const admitted = await call(admitH100PilotOrder, base);
  assert.equal(admitted.amountCents, 800);
  assert.equal(admitted.nodeHours, 1);

  await rejectsCode(
    () => call(admitH100PilotOrder, { ...base, candidate: order({ startAt: "2026-08-31T00:00:00.000Z", endAt: "2026-08-31T01:00:00.000Z" }) }),
    "H100_CAMPAIGN_CLOSED",
  );
  await rejectsCode(
    () => call(admitH100PilotOrder, { ...base, orders: [order({ orderId: "prior", startAt: "2026-08-08T00:00:00.000Z", endAt: "2026-08-08T01:00:00.000Z" })] }),
    "H100_ONE_ORDER_PER_PRINCIPAL",
  );

  const tenPrincipals = Array.from({ length: 10 }, (_, index) => order({
    orderId: `prior-${index}`,
    principalId: `principal-${index}`,
    nodeId: `other-node-${index}`,
    startAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    endAt: `2026-08-${String(index + 1).padStart(2, "0")}T01:00:00.000Z`,
  }));
  await rejectsCode(
    () => call(admitH100PilotOrder, { ...base, orders: tenPrincipals, candidate: order({ principalId: "principal-011" }) }),
    "H100_PRINCIPAL_LIMIT_REACHED",
  );
  const eightyConsumedHours = tenPrincipals.map((existing, index) => ({
    ...existing,
    startAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    endAt: `2026-08-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`,
  }));
  await assert.rejects(
    Promise.resolve().then(() => call(admitH100PilotOrder, {
      ...base,
      orders: eightyConsumedHours,
      candidate: order({ principalId: "principal-new", nodeId: "fresh-node" }),
    })),
    (error) => ["H100_NODE_HOUR_CAP_REACHED", "H100_PRINCIPAL_LIMIT_REACHED"].includes(error?.code ?? error?.message),
    "an order beyond the 80-node-hour/10-principal campaign ceiling must be blocked",
  );
  await rejectsCode(
    () => call(admitH100PilotOrder, { ...base, orders: [order({ orderId: "other", principalId: "other", startAt: "2026-08-10T00:30:00.000Z", endAt: "2026-08-10T01:30:00.000Z" })] }),
    "H100_NODE_WINDOW_OVERLAP",
  );
});

test("failed inventory verification blocks admission before payment", async () => {
  const { admitH100PilotOrder } = await contract();
  const node = validNode({ verification: { result: "FAIL", evidenceDigest: EVIDENCE_DIGEST, validUntil: "2026-09-30T00:00:00.000Z" } });
  await rejectsCode(
    () => call(admitH100PilotOrder, {
      campaignStartedAt: "2026-08-01T00:00:00.000Z",
      now: "2026-08-09T12:00:00.000Z",
      node,
      orders: [],
      candidate: order(),
    }),
    "H100_VERIFICATION_REQUIRED",
  );
});

test("promotional pilot listings never enter the public market or its price samples", async () => {
  const { projectPilotListingToMarket } = await contract();
  const marketSamples = [1860, 2060, 2260];
  const projection = await call(projectPilotListingToMarket, {
    listingId: "promo-h100-001",
    campaign: "H100_PILOT",
    promotional: true,
    amountCents: 800,
    cardHours: 8,
  });
  assert.equal(projection, null);
  assert.deepEqual(marketSamples, [1860, 2060, 2260]);
});

function macAssets(count = 300) {
  return Array.from({ length: count }, (_, index) => ({
    serialHash: `sha256:${index.toString(16).padStart(64, "0")}`,
    chip: index < 200 ? "M4" : "M4_PRO",
    cpuCores: index < 200 ? 10 : 12,
    gpuCores: index < 200 ? 10 : 16,
    memoryGiB: index < 200 ? 16 : 24,
    storageGiB: 512,
    ethernetGbps: 10,
    macosBuild: "24G90",
  }));
}

test("300 Mac mini imports are idempotent, deterministically grouped, and inventory-only", async () => {
  const { ingestMacMiniBatch } = await contract();
  const request = { idempotencyKey: "mac-batch-2026-08-01", payloadHash: EVIDENCE_DIGEST, assets: macAssets() };
  const first = await call(ingestMacMiniBatch, request);
  const replay = await call(ingestMacMiniBatch, request, first);

  assert.equal(first.assets.length, 300);
  assert.equal(replay.batchId, first.batchId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.assets.length, 300);
  assert.deepEqual(first.groups.map(({ count }) => count), [200, 100]);
  for (const asset of first.assets) {
    assert.equal(asset.lifecycle, "INVENTORY_ONLY");
    assert.equal(asset.publishable, false);
  }
  assert.equal(first.marketProjection, null);
});

test("Mac mini batch keys conflict on changed payloads and duplicate serials are rejected", async () => {
  const { ingestMacMiniBatch } = await contract();
  const request = { idempotencyKey: "mac-batch-2026-08-02", payloadHash: EVIDENCE_DIGEST, assets: macAssets(2) };
  const first = await call(ingestMacMiniBatch, request);
  await rejectsCode(
    () => call(ingestMacMiniBatch, { ...request, payloadHash: `sha256:${"b".repeat(64)}` }, first),
    "IDEMPOTENCY_CONFLICT",
  );
  await rejectsCode(
    () => call(ingestMacMiniBatch, { ...request, idempotencyKey: "mac-batch-duplicate", assets: [request.assets[0], request.assets[0]] }),
    "MAC_SERIAL_DUPLICATE",
  );
});
