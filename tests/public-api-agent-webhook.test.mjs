import assert from "node:assert/strict";
import test from "node:test";

import { syncKaiPublicHeartbeat } from "../lib/server/public-api-agent-bridge.ts";

test("a public verification heartbeat attempts its queued webhook after state synchronization", async () => {
  const calls = [];
  const client = { clientId: "sandbox-client-01", organizationId: "org-sandbox" };
  const device = {
    id: "had_public_webhook_000001",
    organizationId: client.organizationId,
    status: "VERIFIED",
    verificationStatus: "PASSED",
    verifiedUntil: "2026-08-20T08:00:00.000Z",
    lastSeenAt: "2026-08-20T07:00:00.000Z",
  };
  const verification = { id: "kvr_webhook_1", commandId: "hcmd_verify_1", status: "passed" };
  const publicStore = {
    syncVerification: async (clientId, deviceId, status) => {
      calls.push(["sync", clientId, deviceId, status]);
      return verification;
    },
  };
  const deliverWebhook = async (options) => {
    assert.equal(options.store, publicStore);
    calls.push(["deliver"]);
    return { delivered: true };
  };

  const updates = await syncKaiPublicHeartbeat({}, device, "2026-08-20T07:00:00.000Z", {
    enabled: true,
    clients: [client],
    publicStore,
    deliverWebhook,
  });

  assert.equal(updates[0], verification);
  assert.deepEqual(calls, [
    ["sync", client.clientId, device.id, "passed"],
    ["deliver"],
  ]);
});
