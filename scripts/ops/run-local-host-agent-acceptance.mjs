#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { heartbeat, pairDevice, processOneCommand } from "../../host-agent/src/client.mjs";
import { digestJson } from "../../host-agent/src/protocol.mjs";
import { readState } from "../../host-agent/src/state.mjs";

if (process.env.NODE_ENV === "production"
  || process.env.KAI_ENVIRONMENT !== "LOCAL"
  || process.env.KAI_HOSTING_LOCAL_ACCEPTANCE !== "1") {
  throw new Error("LOCAL_HOST_AGENT_ACCEPTANCE_FORBIDDEN");
}

async function stdinJson() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 16 * 1024) throw new Error("PAIRING_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertLocalBundle(bundle) {
  const endpoint = new URL(bundle?.registerEndpoint ?? "");
  if (endpoint.protocol !== "http:"
    || endpoint.hostname !== "supplier.localhost"
    || endpoint.pathname !== "/api/v2/agent/register"
    || endpoint.username
    || endpoint.password
    || endpoint.hash) {
    throw new Error("LOCAL_PAIRING_ENDPOINT_FORBIDDEN");
  }
}

const fixtureInventory = Object.freeze({
  hostnameDigest: `sha256:${"1".repeat(64)}`,
  gpuModel: "RTX_4090",
  gpuUuidDigest: `sha256:${"2".repeat(64)}`,
  gpuMemoryMiB: 24_576,
  driverVersion: "LOCAL-QA",
  cudaVersion: "LOCAL-QA",
  cpuModel: "Local acceptance fixture — not a real GPU",
  memoryMiB: 65_536,
  storageGiB: 2_048,
  publicHost: "local-qa.invalid",
  sshPortStart: 27_000,
  sshPortEnd: 27_019,
});

function assertLocalStateFile(value) {
  if (!isAbsolute(value) || !/^\/(?:private\/)?tmp\/kai-cloud-local-agent-state-[A-Za-z0-9._-]+\.json$/u.test(value)) {
    throw new Error("LOCAL_AGENT_STATE_FILE_FORBIDDEN");
  }
}

const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const observedAt = () => new Date().toISOString();

function verificationResult(command, state, inventory) {
  const challengeDigest = digestJson({
    protocolVersion: 1,
    deviceId: state.deviceId,
    commandId: command.id,
    publicHost: inventory.publicHost,
    publicPort: inventory.sshPortStart,
    challenge: command.payload.reachabilityChallenge,
  });
  const summaries = {
    GPU_IDENTITY: { gpuModel: inventory.gpuModel, gpuMemoryMiB: inventory.gpuMemoryMiB, inventoryDigest: state.inventoryDigest },
    CUDA_SMOKE: { method: "LOCAL_ACCEPTANCE_ONLY", probeDigest: sha("local-cuda") },
    MEMORY: { hostMemoryMiB: inventory.memoryMiB, gpuMemoryMiB: inventory.gpuMemoryMiB },
    STORAGE: { availableGiB: inventory.storageGiB, writeProbeBytes: 1_048_576 },
    NETWORK: { apiFamily: 4, publicHostFamily: 4, mode: "LOCAL_ACCEPTANCE_ONLY" },
    WORKLOAD_IMAGE: { protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images: command.payload.approvedImages, allPresent: true },
    PORT_REACHABILITY: { port: inventory.sshPortStart, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest },
  };
  const tests = command.payload.tests.map((name) => ({
    name,
    status: "PASSED",
    evidenceDigest: digestJson({ name, summary: summaries[name] }),
    summary: summaries[name],
  }));
  const details = { protocolVersion: 1, inventoryDigest: state.inventoryDigest, observedAt: observedAt(), tests };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

function provisionResult(command, inventory) {
  const details = {
    protocolVersion: 1,
    contractId: command.contractId,
    image: command.payload.image,
    endpointDisplay: `${inventory.publicHost}:${inventory.sshPortStart}`,
    containerDigest: sha(`container:${command.contractId}`),
    workspaceDigest: sha(`workspace:${command.contractId}`),
    observedAt: observedAt(),
  };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

function startResult(command) {
  const now = observedAt();
  const details = {
    protocolVersion: 1,
    contractId: command.contractId,
    endpointDisplay: command.payload.endpointDisplay,
    containerDigest: sha(`container:${command.contractId}`),
    runtimeStateDigest: sha(`running:${command.contractId}`),
    runtimeStatus: "RUNNING",
    sshBannerDigest: sha(`ssh:${command.contractId}`),
    startedAt: now,
    observedAt: now,
  };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

function stopResult(command) {
  const stoppedAt = observedAt();
  const runtimeSeconds = Math.max(0, Math.ceil((Date.parse(stoppedAt) - Date.parse(command.payload.startedAt)) / 1_000));
  const details = {
    protocolVersion: 1,
    contractId: command.contractId,
    containerDigest: sha(`container:${command.contractId}`),
    runtimeStateDigest: sha(`stopped:${command.contractId}:${runtimeSeconds}`),
    runtimeStatus: "STOPPED",
    startedAt: command.payload.startedAt,
    stoppedAt,
    runtimeSeconds,
    observedAt: stoppedAt,
  };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

function cleanupResult(command) {
  const cleanedAt = observedAt();
  const details = {
    protocolVersion: 1,
    contractId: command.contractId,
    containerDigest: sha(`container:${command.contractId}`),
    cleanupDigest: sha(`cleanup:${command.contractId}`),
    containerRemoved: true,
    authorizedKeyRemoved: true,
    workspaceRemoved: true,
    cleanedAt,
    cleanupStatus: "CLEANED",
    observedAt: cleanedAt,
  };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

const configuredStateFile = process.env.KAI_HOSTING_LOCAL_STATE_FILE?.trim() || null;
let directory = null;
let stateFile;
let inventory;
let pairingBundle = null;
if (configuredStateFile) {
  assertLocalStateFile(configuredStateFile);
  stateFile = configuredStateFile;
  const state = await readState(stateFile);
  if (state.status !== "ACTIVE" || !state.inventory || !String(state.inventory.cpuModel).includes("not a real GPU")) {
    throw new Error("LOCAL_AGENT_STATE_INVALID");
  }
  inventory = Object.freeze(state.inventory);
} else {
  pairingBundle = await stdinJson();
  assertLocalBundle(pairingBundle);
  directory = await mkdtemp(join(tmpdir(), "kai-local-host-agent-"));
  stateFile = join(directory, "identity.json");
  inventory = fixtureInventory;
}
let stopping = false;
process.once("SIGINT", () => { stopping = true; });
process.once("SIGTERM", () => { stopping = true; });

try {
  if (configuredStateFile) {
    const state = await readState(stateFile);
    process.stdout.write(`${JSON.stringify({ event: "local_agent.resumed", deviceId: state.deviceId, simulation: true })}\n`);
  } else {
    const paired = await pairDevice({
      bundle: pairingBundle,
      displayName: "LOCAL ACCEPTANCE · 非真实 GPU",
      publicHost: inventory.publicHost,
      sshPortStart: String(inventory.sshPortStart),
      sshPortEnd: String(inventory.sshPortEnd),
      stateFile,
      allowInsecureLocal: true,
      inventoryCollector: async () => inventory,
    });
    process.stdout.write(`${JSON.stringify({ event: "local_agent.paired", deviceId: paired.deviceId, simulation: true })}\n`);
  }
  let nextHeartbeatAt = 0;
  let lastConnectionError = null;
  while (!stopping) {
    try {
      if (Date.now() >= nextHeartbeatAt) {
        const beat = await heartbeat({ stateFile, allowInsecureLocal: true, inventoryCollector: async () => inventory });
        process.stdout.write(`${JSON.stringify({ event: "local_agent.heartbeat", sequence: beat.state.lastSequence })}\n`);
        nextHeartbeatAt = Date.now() + 10_000;
      }
      const processed = await processOneCommand({
        stateFile,
        allowInsecureLocal: true,
        verifier: (command, state) => verificationResult(command, state, inventory),
        provisioner: (command) => provisionResult(command, inventory),
        starter: startResult,
        stopper: stopResult,
        cleaner: cleanupResult,
      });
      if (processed) process.stdout.write(`${JSON.stringify({ event: "local_agent.command", type: processed.command.type, outcome: processed.result.outcome })}\n`);
      if (lastConnectionError) process.stdout.write(`${JSON.stringify({ event: "local_agent.reconnected" })}\n`);
      lastConnectionError = null;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "LOCAL_AGENT_LOOP_FAILED";
      if (code !== lastConnectionError) process.stderr.write(`${JSON.stringify({ event: "local_agent.retrying", code })}\n`);
      lastConnectionError = code;
      nextHeartbeatAt = 0;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
