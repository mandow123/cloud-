import assert from "node:assert/strict";
import test from "node:test";

import { hostingSupplierDeviceWorkspaceView } from "../lib/server/hosting-v2-api.ts";

const NOW = "2026-08-14T10:00:00.000Z";

function device(id, overrides = {}) {
  return {
    id,
    organizationId: "org-supplier",
    accountId: "acct-supplier",
    displayName: id,
    deviceKeyId: `key-${id}`,
    devicePublicKey: "A".repeat(43),
    agentVersion: "2.0.0",
    inventory: {
      hostnameDigest: `sha256:${"1".repeat(64)}`,
      gpuModel: "RTX_4090",
      gpuUuidDigest: `sha256:${"2".repeat(64)}`,
      gpuMemoryMiB: 24_576,
      driverVersion: "580.0",
      cudaVersion: "13.0",
      cpuModel: "Test CPU",
      memoryMiB: 65_536,
      storageGiB: 1_024,
      publicHost: "gpu.example.com",
      sshPortStart: 24_000,
      sshPortEnd: 24_100,
    },
    inventoryDigest: `sha256:${"3".repeat(64)}`,
    status: "VERIFIED",
    verificationStatus: "PASSED",
    verificationEvidenceDigest: `sha256:${"4".repeat(64)}`,
    verifiedUntil: "2026-08-15T10:00:00.000Z",
    lastSequence: 10,
    lastSeenAt: "2026-08-14T09:59:30.000Z",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function offer(deviceId, overrides = {}) {
  return {
    id: `offer-${deviceId}`,
    organizationId: "org-supplier",
    deviceId,
    feeScheduleId: "fee-1",
    title: "4090",
    gpuModel: "RTX_4090",
    region: "CN-SH",
    cardHourMicrosPerGpuHour: 1_000_000,
    minRentalSeconds: 180,
    maxRentalSeconds: 3_600,
    availableFrom: NOW,
    availableUntil: "2026-08-15T10:00:00.000Z",
    approvedImage: "registry.example.com/kai/gpu@sha256:abc",
    termsVersion: "KAI_HOSTING_TERMS_2026_08",
    status: "PUBLISHED",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function contract(deviceId, status, overrides = {}) {
  return {
    id: `contract-${deviceId}-${status}`,
    offerId: `offer-${deviceId}`,
    deviceId,
    buyerOrganizationId: "org-buyer",
    buyerAccountId: "acct-buyer",
    supplierOrganizationId: "org-supplier",
    feeScheduleId: "fee-1",
    snapshot: {
      title: "4090",
      gpuModel: "RTX_4090",
      region: "CN-SH",
      cardHourMicrosPerGpuHour: 1_000_000,
      approvedImage: "registry.example.com/kai/gpu@sha256:abc",
      termsVersion: "KAI_HOSTING_TERMS_2026_08",
      platformFeeBps: 100,
      referralRewardBps: 20,
      acceptanceWindowSeconds: 1_800,
    },
    reservedSeconds: 3_600,
    measuredSeconds: null,
    heldMicros: 1_000_000,
    settledMicros: null,
    supplierIncomeMicros: null,
    commissionMicros: null,
    status,
    sshPublicKeyFingerprint: null,
    endpointDisplay: null,
    startedAt: null,
    stoppedAt: null,
    acceptedAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("supplier device workspace derives one compact presentation state from real lifecycle facts", () => {
  const devices = [
    device("available"),
    device("deploying", { status: "BUSY" }),
    device("operating", { status: "BUSY" }),
    device("cleaning", { status: "DRAINING" }),
    device("failed", { status: "DRAINING" }),
    device("offline", { status: "OFFLINE", lastSeenAt: "2026-08-14T09:50:00.000Z" }),
    device("disabled", { status: "REVOKED" }),
  ];
  const offers = devices.map((item) => offer(item.id));
  const contracts = [
    contract("deploying", "PROVISIONING"),
    contract("operating", "IN_SERVICE"),
    contract("cleaning", "CLEANING"),
    contract("failed", "FAILED"),
  ];

  const workspace = hostingSupplierDeviceWorkspaceView(devices, offers, contracts, "org-supplier", NOW);
  const byId = new Map(workspace.records.map((record) => [record.id, record]));
  assert.equal(byId.get("available").state, "AVAILABLE");
  assert.equal(byId.get("deploying").state, "DEPLOYING");
  assert.equal(byId.get("operating").state, "OPERATING");
  assert.equal(byId.get("cleaning").state, "DEPLOYING");
  assert.equal(byId.get("cleaning").stateLabel, "清理中");
  assert.equal(byId.get("failed").state, "ACTION_REQUIRED");
  assert.equal(byId.get("offline").state, "OFFLINE");
  assert.equal(byId.get("offline").stateLabel, "离线");
  assert.equal(byId.get("disabled").state, "DISABLED");
  assert.equal(workspace.tasks.find((item) => item.deviceId === "failed").priority, "P0");
});

test("workspace treats stale heartbeat and invalid verification as actions without inventing commercial events", () => {
  const workspace = hostingSupplierDeviceWorkspaceView([
    device("stale", { lastSeenAt: "2026-08-14T09:55:00.000Z" }),
    device("unverified", { status: "ONLINE", verificationStatus: "NOT_RUN", verifiedUntil: null }),
  ], [], [], "org-supplier", NOW);

  assert.equal(workspace.records.find((item) => item.id === "stale").state, "OFFLINE");
  assert.equal(workspace.records.find((item) => item.id === "unverified").state, "ACTION_REQUIRED");
  assert.deepEqual(workspace.tasks.map((item) => item.priority), ["P1", "P1"]);
  assert.equal(workspace.historyCapabilities.renewal.enabled, false);
  assert.equal(workspace.historyCapabilities.buyback.enabled, false);
  assert.equal(workspace.historyCapabilities.decommission.enabled, false);
});

test("workspace ignores buyer-side contracts and never leaks them into supplier device state", () => {
  const buyerOnly = contract("available", "IN_SERVICE", { supplierOrganizationId: "org-other", buyerOrganizationId: "org-supplier" });
  const workspace = hostingSupplierDeviceWorkspaceView([device("available")], [offer("available")], [buyerOnly], "org-supplier", NOW);
  assert.equal(workspace.records[0].state, "AVAILABLE");
  assert.equal(workspace.records[0].activeContractId, null);
});
