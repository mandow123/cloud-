import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { kaiPublicVerificationState } from "../lib/server/public-api-service.ts";

const verifiedDevice = {
  id: "had_review_device",
  organizationId: "org-review",
  accountId: "acct-review",
  displayName: "Review GPU",
  deviceKeyId: "key",
  devicePublicKey: "A".repeat(43),
  agentVersion: "1.9.7",
  inventory: {},
  inventoryDigest: `sha256:${"1".repeat(64)}`,
  status: "VERIFIED",
  verificationStatus: "PASSED",
  verificationEvidenceDigest: null,
  verifiedUntil: "2026-08-20T08:00:00.000Z",
  lastSequence: 1,
  lastSeenAt: "2026-08-20T06:00:00.000Z",
  version: 1,
  createdAt: "2026-08-20T05:00:00.000Z",
  updatedAt: "2026-08-20T06:00:00.000Z",
};

test("a stale heartbeat can never retain a passed public verification", () => {
  const state = kaiPublicVerificationState(verifiedDevice, new Date("2026-08-20T06:02:00.001Z"));
  assert.equal(state.status, "failed");
  assert.equal(state.failure.code, "DEVICE_OFFLINE");
});

test("public device reads require a client-bound verification before returning the device", () => {
  const source = readFileSync("app/api/public/v1/devices/[deviceId]/route.ts", "utf8");
  assert.match(source, /const verification = await publicStore\.syncVerification/u);
  assert.match(source, /if \(!verification\).*RESOURCE_NOT_FOUND/u);
});

test("the direct public registration path enforces the challenge minimum Agent version", () => {
  const source = readFileSync("app/api/public/v1/devices/register/route.ts", "utf8");
  assert.match(source, /agentVersionAtLeast\(agentVersion, challenge\.minimumAgentVersion\)/u);
  assert.match(source, /AGENT_VERSION_UNSUPPORTED/u);
});
