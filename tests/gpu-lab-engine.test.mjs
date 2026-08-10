import assert from "node:assert/strict";
import test from "node:test";
import { GpuLabEngine, KAI_CNY_REFERENCE_RATE } from "../lib/server/gpu-lab-engine.ts";

test("local GPU lab completes a real persisted 4090 supply and rental state machine without moving funds", async () => {
  const engine = new GpuLabEngine(":memory:", Date.now());
  const initial = await engine.snapshot();
  const product = initial.products.find((item) => item.id === "PV-GPU-RTX4090-PCIE-24GB");
  assert.ok(product, "RTX 4090 must be present in the controlled GPU catalog");

  const published = await engine.publish({
    commandId: "test-publish-4090-001",
    supplierName: "个人 4090 主机",
    productVersionId: product.id,
    gpuCount: 1,
    region: "上海",
    sourceType: "PERSONAL",
    priceKaiPerGpuHour: 0.88,
  });
  assert.equal(published.snapshot.listings.length, 1);
  assert.ok(published.proof.resourceAssetId);
  assert.ok(published.proof.verificationRunId);
  assert.ok(published.proof.capacityLotId);
  assert.ok(published.proof.listingVersionId);

  const checkedOut = await engine.checkout({
    commandId: "test-checkout-4090-001",
    listingVersionId: published.proof.listingVersionId,
    durationHours: 1,
  });
  assert.equal(checkedOut.order.status, "FULFILLING");
  assert.equal(checkedOut.order.payment?.status, "CAPTURED");
  assert.equal(checkedOut.order.payment?.environment, "TEST");
  assert.equal(checkedOut.order.delivery?.package?.status, "CLAIMED");
  assert.equal(checkedOut.order.delivery?.package?.latestConnectionCheck?.status, "PASSED");
  assert.equal(checkedOut.order.metering?.status, "SCHEDULED");

  const started = await engine.start(checkedOut.order.id);
  assert.equal(started.order.metering?.status, "ACTIVE");
  const completed = await engine.complete(checkedOut.order.id);
  assert.equal(completed.order.status, "AWAITING_ACCEPTANCE");
  assert.equal(completed.order.metering?.status, "FINAL");
  const accepted = await engine.accept(checkedOut.order.id);
  assert.equal(accepted.order.acceptance?.status, "ACCEPTED");
  assert.equal(accepted.order.settlement?.status, "ELIGIBLE");
  const settled = await engine.settle(checkedOut.order.id);
  assert.equal(settled.order.status, "COMPLETED");
  assert.equal(settled.settlement.status, "TEST_RECORDED");
  assert.equal(settled.settlement.fundsMoved, false);
  assert.equal(settled.snapshot.kaiReferenceRate, KAI_CNY_REFERENCE_RATE);
});
