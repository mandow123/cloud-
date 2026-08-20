import assert from "node:assert/strict";
import test from "node:test";

import { createSqliteKaiPublicApiStore } from "../lib/server/public-api-store-sqlite.ts";

function context(overrides = {}) {
  return {
    clientId: "zod-sandbox-backend",
    organizationId: "org_sandbox_supplier",
    organizationReference: "zod_org_sandbox",
    actorId: "oauth:zod-sandbox-backend",
    idempotencyKey: "verification:create:0001",
    payloadHash: "payload-hash-0001",
    now: "2026-08-20T06:00:00.000Z",
    ...overrides,
  };
}

const input = {
  resourceReference: "zod_resource_001",
  productCode: "GPU_COMPUTE",
  region: "cn-north-sandbox",
  specifications: { gpuModel: "RTX_4090", gpuMemoryMiB: 24576 },
};

test("public verification store is durable, tenant-bound and idempotent", async () => {
  const store = await createSqliteKaiPublicApiStore(":memory:");
  try {
    const created = await store.createVerification(context(), input);
    assert.equal(created.replayed, false);
    assert.equal(created.record.status, "pending");
    const replay = await store.createVerification(context(), input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.record.id, created.record.id);
    await assert.rejects(store.createVerification(context({ payloadHash: "different-payload" }), input), (error) => error.name === "ExchangeIdempotencyConflictError");
    assert.equal(await store.getVerification("other-client", created.record.id), null);
    assert.equal((await store.getCurrentVerification(context().clientId, input.resourceReference)).id, created.record.id);

    const running = await store.bindChallenge(context({ idempotencyKey: "challenge:create:0001", payloadHash: "challenge-hash", now: "2026-08-20T06:01:00.000Z" }), input.resourceReference, "hac_public_test_001");
    assert.equal(running.status, "running");
    assert.equal(running.version, 2);
    assert.equal((await store.getChallengeBinding(context().clientId, "hac_public_test_001")).verificationId, created.record.id);

    const bound = await store.bindDevice(context().clientId, "hac_public_test_001", "had_public_test_001", "2026-08-20T06:02:00.000Z");
    assert.equal(bound.deviceId, "had_public_test_001");
    const command = await store.setVerificationCommand(context().clientId, created.record.id, "hcmd_public_test_001", "2026-08-20T06:03:00.000Z");
    assert.equal(command.commandId, "hcmd_public_test_001");

    const passed = await store.syncVerification(context().clientId, "had_public_test_001", "passed", null, "2026-08-20T06:04:00.000Z");
    assert.equal(passed.status, "passed");
    assert.equal(passed.version, 3);
    const offline = await store.syncVerification(context().clientId, "had_public_test_001", "failed", { code: "DEVICE_OFFLINE", message: "The verification device is offline." }, "2026-08-20T06:05:00.000Z");
    assert.equal(offline.status, "failed");
    assert.equal(offline.failure.code, "DEVICE_OFFLINE");

    const revoked = await store.revokeVerification(context({ idempotencyKey: "verification:revoke:0001", payloadHash: "revoke-hash", now: "2026-08-20T06:06:00.000Z" }), created.record.id);
    assert.equal(revoked.record.status, "revoked");
    const revokeReplay = await store.revokeVerification(context({ idempotencyKey: "verification:revoke:0001", payloadHash: "revoke-hash", now: "2026-08-20T06:07:00.000Z" }), created.record.id);
    assert.equal(revokeReplay.replayed, true);
    assert.equal(revokeReplay.record.version, revoked.record.version);

    let deliveryCount = 0;
    while (true) {
      const delivery = await store.nextWebhook("2026-08-20T07:00:00.000Z");
      if (!delivery) break;
      assert.equal(delivery.clientId, context().clientId);
      assert.equal(delivery.payload.type, "resource.verification.updated");
      await store.completeWebhook(delivery.deliveryId, "2026-08-20T07:00:00.000Z");
      deliveryCount += 1;
    }
    assert.equal(deliveryCount, 5);
  } finally {
    store.close();
  }
});

test("challenge and verification ownership cannot cross clients", async () => {
  const store = await createSqliteKaiPublicApiStore(":memory:");
  try {
    await store.createVerification(context(), input);
    await assert.rejects(store.bindChallenge(context({ clientId: "other-client", organizationId: "org_other", organizationReference: "other_org", idempotencyKey: "challenge:other:001", payloadHash: "other-hash" }), input.resourceReference, "hac_other_001"), (error) => error.code === "EXCHANGE_NOT_FOUND");
  } finally {
    store.close();
  }
});
