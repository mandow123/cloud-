import assert from "node:assert/strict";
import test from "node:test";

import { bindKaiPublicDevice, syncKaiPublicHeartbeat } from "../lib/server/public-api-agent-bridge.ts";

const client = {
  clientId: "sandbox-client-01",
  secretSha256: "0".repeat(64),
  organizationId: "org-sandbox",
  organizationReference: "kai-sandbox",
  accountId: "acct-sandbox",
  scopes: ["agent:write"],
  webhookUrl: null,
  webhookSecret: null,
};

const device = {
  id: "had_public_bridge_000001",
  organizationId: client.organizationId,
  accountId: client.accountId,
  displayName: "Sandbox GPU",
  deviceKeyId: `sha256:${"1".repeat(64)}`,
  devicePublicKey: "A".repeat(43),
  agentVersion: "1.9.7",
  inventory: {},
  inventoryDigest: `sha256:${"2".repeat(64)}`,
  status: "REGISTERED",
  verificationStatus: "PENDING",
  verificationEvidenceDigest: null,
  verifiedUntil: null,
  lastSequence: 1,
  lastSeenAt: "2026-08-20T06:00:00.000Z",
  version: 1,
  createdAt: "2026-08-20T05:00:00.000Z",
  updatedAt: "2026-08-20T06:00:00.000Z",
};

test("the compatibility bridge is a no-op while the public API is disabled", async () => {
  const publicStore = new Proxy({}, { get: () => () => assert.fail("disabled bridge touched the public store") });
  assert.equal(await bindKaiPublicDevice("hac_disabled", device, device.updatedAt, { enabled: false, clients: [client], publicStore }), null);
  assert.deepEqual(await syncKaiPublicHeartbeat({}, device, device.updatedAt, { enabled: false, clients: [client], publicStore }), []);
});

test("an existing v2 registration is linked only to its owning public client", async () => {
  const calls = [];
  const publicStore = {
    getChallengeBinding: async (clientId, challengeId) => {
      calls.push(["lookup", clientId, challengeId]);
      return clientId === client.clientId ? { verificationId: "kvr_1", resourceReference: "gpu-1", deviceId: null } : null;
    },
    bindDevice: async (clientId, challengeId, deviceId) => {
      calls.push(["bind", clientId, challengeId, deviceId]);
      return { id: "kvr_1" };
    },
  };
  const other = { ...client, clientId: "sandbox-client-02", organizationId: "org-other" };
  const result = await bindKaiPublicDevice("hac_public_1", device, device.updatedAt, { enabled: true, clients: [other, client], publicStore });
  assert.equal(result.id, "kvr_1");
  assert.deepEqual(calls, [
    ["lookup", client.clientId, "hac_public_1"],
    ["bind", client.clientId, "hac_public_1", device.id],
  ]);
});

test("an existing v2 heartbeat advances public verification and queues VERIFY once", async () => {
  const calls = [];
  const verification = { id: "kvr_1", clientId: client.clientId, resourceReference: "gpu-1", deviceId: device.id, challengeId: "hac_1", commandId: null, status: "running", failure: null, version: 1, createdAt: device.createdAt, updatedAt: device.updatedAt };
  const publicStore = {
    syncVerification: async (clientId, deviceId, status) => {
      calls.push(["sync", clientId, deviceId, status]);
      return verification;
    },
    setVerificationCommand: async (clientId, verificationId, commandId) => {
      calls.push(["attach", clientId, verificationId, commandId]);
      return { ...verification, commandId };
    },
  };
  const hostingStore = {
    queueVerification: async (organizationId, deviceId, context) => {
      calls.push(["queue", organizationId, deviceId, context.idempotencyKey]);
      return { id: "hcmd_verify_1" };
    },
  };
  const result = await syncKaiPublicHeartbeat(hostingStore, device, device.updatedAt, { enabled: true, clients: [client], publicStore });
  assert.equal(result[0].commandId, "hcmd_verify_1");
  assert.deepEqual(calls, [
    ["sync", client.clientId, device.id, "running"],
    ["queue", client.organizationId, device.id, "public-verify:kvr_1"],
    ["attach", client.clientId, "kvr_1", "hcmd_verify_1"],
  ]);
});
