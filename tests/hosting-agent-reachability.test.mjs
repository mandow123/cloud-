import assert from "node:assert/strict";
import test from "node:test";

import { verifyControlPlaneReachability } from "../lib/server/hosting-agent-reachability.ts";

const challenge = "a".repeat(32);
const device = {
  id: "had_local_qa_device",
  inventory: { publicHost: "local-qa.invalid", sshPortStart: 27_000 },
};
const command = { id: "hcmd_local_qa_verify", payload: { reachabilityChallenge: challenge } };
const localEnvironment = { NODE_ENV: "development", KAI_ENVIRONMENT: "LOCAL", KAI_HOSTING_LOCAL_REACHABILITY_SIMULATION: "1" };

test("explicit local QA mode simulates only the control-plane reachability digest", async () => {
  const digest = await verifyControlPlaneReachability(device, command, {
    environment: localEnvironment,
    resolveAddresses: async () => { throw new Error("network must not be touched in local QA mode"); },
  });
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
});

test("production never accepts the local reachability simulation switch", async () => {
  await assert.rejects(verifyControlPlaneReachability(device, command, {
    environment: { ...localEnvironment, NODE_ENV: "production" },
    resolveAddresses: async () => { throw new Error("real public resolution required"); },
  }), /real public resolution required/u);
});

test("local QA simulation is pinned to the non-routable fixture hostname", async () => {
  await assert.rejects(verifyControlPlaneReachability({ ...device, inventory: { ...device.inventory, publicHost: "gpu.example.com" } }, command, {
    environment: localEnvironment,
    resolveAddresses: async () => { throw new Error("real public resolution required"); },
  }), /real public resolution required/u);
});
