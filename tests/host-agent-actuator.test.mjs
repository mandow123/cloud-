import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanupWorkload, probeSshReadiness, provisionWorkload, startWorkload, stopWorkload } from "../host-agent/src/actuator-client.mjs";
import { enforceExpiredWorkloads, executeCleanup, executeProvision, executeStart, executeStop, parseCleanupRequest, parseProvisionRequest, parseStartRequest, parseStopRequest } from "../host-agent/src/actuator.mjs";
import { processOneCommand } from "../host-agent/src/client.mjs";
import { AgentError, digestJson, generateDeviceIdentity } from "../host-agent/src/protocol.mjs";
import { writeState } from "../host-agent/src/state.mjs";

const image = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`;
const productionWorkloadImage = `ghcr.io/mandow123/kai-cloud-gpu-workload@sha256:${"b".repeat(64)}`;
const publicKey = `ssh-ed25519 ${Buffer.alloc(51, 7).toString("base64")} actuator-test`;

function request(overrides = {}) {
  return {
    protocolVersion: 1,
    operation: "PROVISION",
    commandId: "hcmd_actuator0001",
    contractId: "hctr_actuator0001",
    image,
    publicKey,
    publicHost: "gpu.example.com",
    sshPort: 22_000,
    memoryMiB: 65_536,
    gpuCount: 1,
    reservedSeconds: 3_600,
    ...overrides,
  };
}

test("root actuator accepts only immutable allowlisted KAI images and fixed provision fields", () => {
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image };
  assert.equal(parseProvisionRequest(request(), environment).image, image);
  assert.throws(() => parseProvisionRequest(request({ image: "ghcr.io/kai-cloud/cuda-pytorch:latest" }), environment), (error) => error.code === "IMAGE_NOT_APPROVED");
  assert.throws(() => parseProvisionRequest(request({ image: `ghcr.io/kai-cloud/other@sha256:${"b".repeat(64)}` }), environment), (error) => error.code === "IMAGE_NOT_APPROVED");
  assert.throws(() => parseProvisionRequest(request({ publicKey: `${publicKey}\ncommand=bad` }), environment), (error) => error.code === "PUBLIC_KEY_INVALID");
  assert.throws(() => parseProvisionRequest(request({ operation: "SHELL" }), environment), (error) => error.code === "PROVISION_REQUEST_INVALID");
});

test("root actuator accepts the exact production workload repository but not arbitrary owner images", () => {
  const environment = { KAI_HOSTING_APPROVED_IMAGES: productionWorkloadImage };
  assert.equal(parseProvisionRequest(request({ image: productionWorkloadImage }), environment).image, productionWorkloadImage);
  assert.throws(
    () => parseProvisionRequest(request({ image: `ghcr.io/mandow123/other@sha256:${"b".repeat(64)}` }), environment),
    (error) => error.code === "IMAGE_NOT_APPROVED",
  );
});

test("PROVISION creates one constrained stopped container and replays from a root-owned manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-"));
  const calls = [];
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOST_ACTUATOR_STATE_DIR: directory };
  const runDocker = async (args) => {
    calls.push(args);
    if (args[0] === "image") return { stdout: JSON.stringify([image]) };
    return { stdout: `${"b".repeat(64)}\n` };
  };
  try {
    const result = await executeProvision(request(), { environment, runDocker, changeOwner: async () => undefined, now: () => "2026-08-11T08:00:00.000Z" });
    assert.equal(result.endpointDisplay, "gpu.example.com:22000");
    assert.equal(result.image, image);
    assert.match(result.containerDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(calls.length, 2);
    const create = calls[1];
    for (const required of ["--pull", "never", "--gpus", "device=0", "--read-only", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--restart", "no"]) {
      assert.ok(create.includes(required), `missing constrained Docker argument: ${required}`);
    }
    assert.doesNotMatch(create.join(" "), /(?:^|\s)(?:sh|bash|sudo|--privileged)(?:\s|$)/u);
    assert.doesNotMatch(create.join(" "), /ssh-ed25519/u, "public key must be mounted from a file, not exposed in process arguments");
    assert.equal(create.at(-1), image);

    const replay = await executeProvision(request(), { environment, runDocker, changeOwner: async () => undefined });
    assert.deepEqual(replay, result);
    assert.equal(calls.length, 2, "an acknowledged provision must not create another container");
    await assert.rejects(executeProvision(request({ commandId: "hcmd_actuator0002" }), { environment, runDocker, changeOwner: async () => undefined }), (error) => error.code === "PROVISION_REPLAY_CONFLICT");

    const manifests = await readFile(join(directory, "workloads", create[create.indexOf("--name") + 1], "manifest.json"), "utf8");
    assert.doesNotMatch(manifests, /ssh-ed25519/u);
    assert.match(manifests, /"status": "READY"/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("START opens only the provisioned container and replays one contract-bound command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-start-"));
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOST_ACTUATOR_STATE_DIR: directory };
  const containerId = "b".repeat(64);
  let workloadName = "";
  let running = false;
  const calls = [];
  const runDocker = async (args) => {
    calls.push(args);
    if (args[0] === "image") return { stdout: JSON.stringify([image]) };
    if (args[0] === "container" && args[1] === "create") {
      workloadName = args[args.indexOf("--name") + 1];
      return { stdout: `${containerId}\n` };
    }
    if (args[0] === "container" && args[1] === "inspect") return {
      stdout: JSON.stringify({
        id: containerId,
        image,
        labels: { "kai.cloud.managed": "true", "kai.cloud.contract-digest": digestJson({ contractId: request().contractId }) },
        running,
      }),
    };
    if (args[0] === "container" && args[1] === "start") {
      assert.deepEqual(args, ["container", "start", workloadName]);
      running = true;
      return { stdout: `${workloadName}\n` };
    }
    throw new Error(`unexpected docker operation: ${args.join(" ")}`);
  };
  try {
    await executeProvision(request(), { environment, runDocker, changeOwner: async () => undefined, now: () => "2026-08-11T08:00:00.000Z" });
    const startRequest = { protocolVersion: 1, operation: "START", commandId: "hcmd_start0001", contractId: request().contractId };
    assert.equal(parseStartRequest(startRequest).operation, "START");
    assert.throws(() => parseStartRequest({ ...startRequest, image }), (error) => error.code === "START_REQUEST_INVALID");
    const result = await executeStart(startRequest, { environment, runDocker, now: () => "2026-08-11T08:01:00.000Z" });
    assert.equal(result.contractId, request().contractId);
    assert.match(result.runtimeStateDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "start").length, 1);
    const callCount = calls.length;
    assert.deepEqual(await executeStart(startRequest, { environment, runDocker }), result);
    assert.equal(calls.length, callCount + 1, "an acknowledged start must re-inspect its runtime state");
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "start").length, 1, "a replay must not start an already-running container twice");
    await assert.rejects(executeStart({ ...startRequest, commandId: "hcmd_start0002" }, { environment, runDocker }), (error) => error.code === "START_REPLAY_CONFLICT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("STOP gracefully halts only the running contract container and records bounded runtime evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-stop-"));
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOST_ACTUATOR_STATE_DIR: directory };
  const containerId = "b".repeat(64);
  let workloadName = "";
  let running = false;
  const calls = [];
  const runDocker = async (args) => {
    calls.push(args);
    if (args[0] === "image") return { stdout: JSON.stringify([image]) };
    if (args[0] === "container" && args[1] === "create") {
      workloadName = args[args.indexOf("--name") + 1];
      return { stdout: `${containerId}\n` };
    }
    if (args[0] === "container" && args[1] === "inspect") return {
      stdout: JSON.stringify({ id: containerId, image, labels: { "kai.cloud.managed": "true", "kai.cloud.contract-digest": digestJson({ contractId: request().contractId }) }, running }),
    };
    if (args[0] === "container" && args[1] === "start") { running = true; return { stdout: `${workloadName}\n` }; }
    if (args[0] === "container" && args[1] === "stop") {
      assert.deepEqual(args, ["container", "stop", "--time", "30", workloadName]);
      running = false;
      return { stdout: `${workloadName}\n` };
    }
    throw new Error(`unexpected docker operation: ${args.join(" ")}`);
  };
  try {
    await executeProvision(request(), { environment, runDocker, changeOwner: async () => undefined, now: () => "2026-08-11T08:00:00.000Z" });
    await executeStart({ protocolVersion: 1, operation: "START", commandId: "hcmd_start0001", contractId: request().contractId }, { environment, runDocker, now: () => "2026-08-11T08:01:00.000Z" });
    const stopRequest = { protocolVersion: 1, operation: "STOP", commandId: "hcmd_stop0001", contractId: request().contractId };
    assert.equal(parseStopRequest(stopRequest).operation, "STOP");
    assert.throws(() => parseStopRequest({ ...stopRequest, maximumSeconds: 3_600 }), (error) => error.code === "STOP_REQUEST_INVALID");
    const stopped = await executeStop(stopRequest, { environment, runDocker, now: () => "2026-08-11T08:11:00.000Z" });
    assert.equal(stopped.runtimeSeconds, 600);
    assert.match(stopped.runtimeStateDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "stop").length, 1);
    const callCount = calls.length;
    assert.deepEqual(await executeStop(stopRequest, { environment, runDocker }), stopped);
    assert.equal(calls.length, callCount + 1, "a stop replay must re-inspect the container");
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "stop").length, 1);
    await assert.rejects(executeStop({ ...stopRequest, commandId: "hcmd_stop0002" }, { environment, runDocker }), (error) => error.code === "STOP_REPLAY_CONFLICT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local watchdog persists lease expiry, stops offline workloads once and preserves exact runtime evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-watchdog-"));
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOST_ACTUATOR_STATE_DIR: directory };
  const containerId = "b".repeat(64);
  let workloadName = "";
  let running = false;
  const calls = [];
  const runDocker = async (args) => {
    calls.push(args);
    if (args[0] === "image") return { stdout: JSON.stringify([image]) };
    if (args[0] === "container" && args[1] === "create") {
      workloadName = args[args.indexOf("--name") + 1];
      return { stdout: `${containerId}\n` };
    }
    if (args[0] === "container" && args[1] === "inspect") return {
      stdout: JSON.stringify({ id: containerId, image, labels: { "kai.cloud.managed": "true", "kai.cloud.contract-digest": digestJson({ contractId: request().contractId }) }, running }),
    };
    if (args[0] === "container" && args[1] === "start") { running = true; return { stdout: `${workloadName}\n` }; }
    if (args[0] === "container" && args[1] === "stop") { running = false; return { stdout: `${workloadName}\n` }; }
    throw new Error(`unexpected docker operation: ${args.join(" ")}`);
  };
  try {
    await executeProvision(request({ reservedSeconds: 180 }), { environment, runDocker, changeOwner: async () => undefined, now: () => "2026-08-11T08:00:00.000Z" });
    await executeStart({ protocolVersion: 1, operation: "START", commandId: "hcmd_start0001", contractId: request().contractId }, { environment, runDocker, now: () => "2026-08-11T08:01:00.000Z" });
    assert.deepEqual(await enforceExpiredWorkloads({ environment, runDocker, now: () => "2026-08-11T08:03:59.000Z" }), []);
    assert.equal(running, true);
    const enforced = await enforceExpiredWorkloads({ environment, runDocker, now: () => "2026-08-11T08:04:00.000Z" });
    assert.deepEqual(enforced.map(({ contractId, stoppedAt }) => ({ contractId, stoppedAt })), [{ contractId: request().contractId, stoppedAt: "2026-08-11T08:04:00.000Z" }]);
    assert.equal(running, false);
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "stop").length, 1);
    assert.deepEqual(await enforceExpiredWorkloads({ environment, runDocker, now: () => "2026-08-11T09:04:00.000Z" }), []);
    const stopped = await executeStop({ protocolVersion: 1, operation: "STOP", commandId: "hcmd_stop0001", contractId: request().contractId }, { environment, runDocker, now: () => "2026-08-11T09:04:00.000Z" });
    assert.equal(stopped.stoppedAt, "2026-08-11T08:04:00.000Z");
    assert.equal(stopped.runtimeSeconds, 180);
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "stop").length, 1, "Cloud STOP after recovery must reuse the watchdog stop");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLEANUP removes the stopped container, temporary key and workspace before reuse", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-cleanup-"));
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOST_ACTUATOR_STATE_DIR: directory };
  const containerId = "b".repeat(64);
  let workloadName = "";
  let containerExists = false;
  let running = false;
  const calls = [];
  const runDocker = async (args) => {
    calls.push(args);
    if (args[0] === "image") return { stdout: JSON.stringify([image]) };
    if (args[0] === "container" && args[1] === "create") {
      workloadName = args[args.indexOf("--name") + 1];
      containerExists = true;
      return { stdout: `${containerId}\n` };
    }
    if (args[0] === "container" && args[1] === "inspect") return {
      stdout: JSON.stringify({ id: containerId, image, labels: { "kai.cloud.managed": "true", "kai.cloud.contract-digest": digestJson({ contractId: request().contractId }) }, running }),
    };
    if (args[0] === "container" && args[1] === "start") { running = true; return { stdout: `${workloadName}\n` }; }
    if (args[0] === "container" && args[1] === "stop") { running = false; return { stdout: `${workloadName}\n` }; }
    if (args[0] === "container" && args[1] === "ls") return { stdout: containerExists ? `${containerId}\n` : "" };
    if (args[0] === "container" && args[1] === "rm") {
      assert.deepEqual(args, ["container", "rm", workloadName]);
      containerExists = false;
      return { stdout: `${containerId}\n` };
    }
    throw new Error(`unexpected docker operation: ${args.join(" ")}`);
  };
  try {
    await executeProvision(request(), { environment, runDocker, changeOwner: async () => undefined, now: () => "2026-08-11T08:00:00.000Z" });
    await executeStart({ protocolVersion: 1, operation: "START", commandId: "hcmd_start0001", contractId: request().contractId }, { environment, runDocker, now: () => "2026-08-11T08:01:00.000Z" });
    await executeStop({ protocolVersion: 1, operation: "STOP", commandId: "hcmd_stop0001", contractId: request().contractId }, { environment, runDocker, now: () => "2026-08-11T08:11:00.000Z" });
    const cleanupRequest = { protocolVersion: 1, operation: "CLEANUP", commandId: "hcmd_cleanup0001", contractId: request().contractId };
    assert.equal(parseCleanupRequest(cleanupRequest).operation, "CLEANUP");
    assert.throws(() => parseCleanupRequest({ ...cleanupRequest, removeContainer: true }), (error) => error.code === "CLEANUP_REQUEST_INVALID");
    const cleaned = await executeCleanup(cleanupRequest, { environment, runDocker, now: () => "2026-08-11T08:12:00.000Z" });
    assert.equal(cleaned.containerRemoved, true);
    assert.equal(cleaned.authorizedKeyRemoved, true);
    assert.equal(cleaned.workspaceRemoved, true);
    assert.match(cleaned.cleanupDigest, /^sha256:[a-f0-9]{64}$/u);
    const workloadRoot = join(directory, "workloads", workloadName);
    await assert.rejects(readFile(join(workloadRoot, "authorized_keys"), "utf8"), (error) => error.code === "ENOENT");
    await assert.rejects(readFile(join(workloadRoot, "workspace"), "utf8"), (error) => error.code === "ENOENT");
    assert.match(await readFile(join(workloadRoot, "manifest.json"), "utf8"), /"status": "CLEANED"/u);
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "rm").length, 1);
    assert.deepEqual(await executeCleanup(cleanupRequest, { environment, runDocker }), cleaned);
    assert.equal(calls.filter((args) => args[0] === "container" && args[1] === "rm").length, 1, "cleanup replay must not remove twice");
    await assert.rejects(executeCleanup({ ...cleanupRequest, commandId: "hcmd_cleanup0002" }, { environment, runDocker }), (error) => error.code === "CLEANUP_REPLAY_CONFLICT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLEANUP safely removes a partially provisioned workload before any instance was acknowledged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-failed-provision-"));
  const environment = { KAI_HOSTING_APPROVED_IMAGES: image, KAI_HOST_ACTUATOR_STATE_DIR: directory };
  const containerId = "c".repeat(64);
  let workloadName = "";
  let containerExists = false;
  let running = false;
  const runDocker = async (args) => {
    if (args[0] === "image") return { stdout: JSON.stringify([image]) };
    if (args[0] === "container" && args[1] === "create") {
      workloadName = args[args.indexOf("--name") + 1];
      containerExists = true;
      return { stdout: `${containerId}\n` };
    }
    if (args[0] === "container" && args[1] === "ls") return { stdout: containerExists ? `${containerId}\n` : "" };
    if (args[0] === "container" && args[1] === "inspect") return { stdout: JSON.stringify({ id: containerId, labels: { "kai.cloud.managed": "true", "kai.cloud.contract-digest": digestJson({ contractId: request().contractId }) }, running }) };
    if (args[0] === "container" && args[1] === "stop") { running = false; return { stdout: `${workloadName}\n` }; }
    if (args[0] === "container" && args[1] === "rm") { containerExists = false; return { stdout: `${containerId}\n` }; }
    throw new Error(`unexpected docker operation: ${args.join(" ")}`);
  };
  try {
    let createCalled = false;
    await assert.rejects(executeProvision(request(), {
      environment,
      changeOwner: async () => undefined,
      runDocker: async (args) => {
        if (args[0] === "image") return { stdout: JSON.stringify([image]) };
        if (args[0] === "container" && args[1] === "create") {
          createCalled = true;
          workloadName = args[args.indexOf("--name") + 1];
          containerExists = true;
          return { stdout: "not-a-container-id\n" };
        }
        throw new Error("unexpected");
      },
    }), (error) => error.code === "CONTAINER_ID_INVALID");
    assert.equal(createCalled, true);
    const manifestPath = join(directory, "workloads", workloadName, "manifest.json");
    assert.match(await readFile(manifestPath, "utf8"), /"contractId": "hctr_actuator0001"/u);
    const cleanupRequest = { protocolVersion: 1, operation: "CLEANUP", commandId: "hcmd_cleanupfailed0001", contractId: request().contractId };
    const cleaned = await executeCleanup(cleanupRequest, { environment, runDocker, now: () => "2026-08-11T08:12:00.000Z" });
    assert.deepEqual({ container: cleaned.containerRemoved, key: cleaned.authorizedKeyRemoved, workspace: cleaned.workspaceRemoved }, { container: true, key: true, workspace: true });
    assert.equal(containerExists, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("non-root Host Agent passes PROVISION to the actuator without gaining container arguments", async () => {
  const command = {
    id: "hcmd_actuator0001",
    contractId: "hctr_actuator0001",
    type: "PROVISION",
    payload: { contractId: "hctr_actuator0001", image, publicKey, reservedSeconds: 3_600, gpuCount: 1 },
  };
  const state = { inventory: { publicHost: "gpu.example.com", sshPortStart: 22_000, memoryMiB: 65_536 } };
  let sent = null;
  const details = {
    protocolVersion: 1,
    contractId: command.contractId,
    image,
    endpointDisplay: "gpu.example.com:22000",
    containerDigest: `sha256:${"b".repeat(64)}`,
    workspaceDigest: `sha256:${"c".repeat(64)}`,
    observedAt: "2026-08-11T08:00:00.000Z",
  };
  const result = await provisionWorkload(command, state, { call: async (value) => { sent = value; return details; } });
  assert.equal(sent.operation, "PROVISION");
  assert.deepEqual(Object.keys(sent).sort(), ["commandId", "contractId", "gpuCount", "image", "memoryMiB", "operation", "protocolVersion", "publicHost", "publicKey", "reservedSeconds", "sshPort"].sort());
  assert.equal(result.outcome, "SUCCEEDED");
  assert.equal(result.evidenceDigest, digestJson(details));
  await assert.rejects(provisionWorkload({ ...command, type: "SHELL" }, state, { call: async () => details }), (error) => error.code === "PROVISION_COMMAND_INVALID");
  await assert.rejects(provisionWorkload(command, {}, { call: async () => details }), (error) => error.code === "AGENT_UPGRADE_REQUIRED");
});

test("non-root Host Agent starts by contract and requires a valid SSH protocol banner digest", async () => {
  const command = {
    id: "hcmd_start0001",
    contractId: "hctr_actuator0001",
    type: "START",
    payload: { contractId: "hctr_actuator0001", endpointDisplay: "gpu.example.com:22000" },
  };
  const state = { inventory: { publicHost: "gpu.example.com", sshPortStart: 22_000, sshPortEnd: 22_019 } };
  let sent = null;
  let probed = null;
  const runtime = {
    protocolVersion: 1,
    contractId: command.contractId,
    containerDigest: `sha256:${"b".repeat(64)}`,
    runtimeStateDigest: `sha256:${"c".repeat(64)}`,
    startedAt: "2026-08-11T08:01:00.000Z",
  };
  const result = await startWorkload(command, state, {
    call: async (value) => { sent = value; return runtime; },
    probe: async (endpoint) => { probed = endpoint; return `sha256:${"d".repeat(64)}`; },
    now: () => "2026-08-11T08:01:01.000Z",
  });
  assert.deepEqual(sent, { protocolVersion: 1, operation: "START", commandId: command.id, contractId: command.contractId });
  assert.deepEqual(probed, { host: "gpu.example.com", port: 22_000, display: "gpu.example.com:22000" });
  assert.equal(result.details.runtimeStatus, "RUNNING");
  assert.equal(result.details.sshBannerDigest, `sha256:${"d".repeat(64)}`);
  assert.equal(result.evidenceDigest, digestJson(result.details));
  await assert.rejects(startWorkload({ ...command, payload: { ...command.payload, endpointDisplay: "attacker.example.com:22000" } }, state, { call: async () => runtime }), (error) => error.code === "START_ENDPOINT_INVALID");
});

test("SSH readiness accepts an SSH 2.0 banner and stores only its digest", async () => {
  const server = createServer((socket) => socket.end("SSH-2.0-KAI_Test_1.0\r\n"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const evidence = await probeSshReadiness({ host: "127.0.0.1", port: address.port }, { attempts: 1, timeoutMs: 1_000, waitMs: 0 });
    assert.match(evidence, /^sha256:[a-f0-9]{64}$/u);
    assert.doesNotMatch(evidence, /KAI_Test/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("non-root Host Agent submits stopped runtime evidence without choosing billable seconds", async () => {
  const command = {
    id: "hcmd_stop0001",
    contractId: "hctr_actuator0001",
    type: "STOP",
    payload: { contractId: "hctr_actuator0001", startedAt: "2026-08-11T08:01:00.000Z", maximumSeconds: 3_600 },
  };
  let sent = null;
  const runtime = {
    protocolVersion: 1,
    contractId: command.contractId,
    containerDigest: `sha256:${"b".repeat(64)}`,
    runtimeStateDigest: `sha256:${"c".repeat(64)}`,
    startedAt: "2026-08-11T08:01:00.000Z",
    stoppedAt: "2026-08-11T08:11:00.000Z",
    runtimeSeconds: 600,
  };
  const result = await stopWorkload(command, {}, {
    call: async (value) => { sent = value; return runtime; },
    now: () => "2026-08-11T08:11:01.000Z",
  });
  assert.deepEqual(sent, { protocolVersion: 1, operation: "STOP", commandId: command.id, contractId: command.contractId });
  assert.equal(result.details.runtimeStatus, "STOPPED");
  assert.equal(result.details.runtimeSeconds, 600);
  assert.equal("measuredSeconds" in result.details, false, "the Agent must not label its evidence as the server billing decision");
  assert.equal(result.evidenceDigest, digestJson(result.details));
  await assert.rejects(stopWorkload({ ...command, payload: { ...command.payload, maximumSeconds: 60 } }, {}, { call: async () => runtime }), (error) => error.code === "STOP_COMMAND_INVALID");
});

test("non-root Host Agent accepts cleanup only when every removal proof is true", async () => {
  const command = {
    id: "hcmd_cleanup0001",
    contractId: "hctr_actuator0001",
    type: "CLEANUP",
    payload: { contractId: "hctr_actuator0001", removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true },
  };
  let sent = null;
  const runtime = {
    protocolVersion: 1,
    contractId: command.contractId,
    containerDigest: `sha256:${"b".repeat(64)}`,
    cleanupDigest: `sha256:${"c".repeat(64)}`,
    containerRemoved: true,
    authorizedKeyRemoved: true,
    workspaceRemoved: true,
    cleanedAt: "2026-08-11T08:12:00.000Z",
  };
  const result = await cleanupWorkload(command, {}, { call: async (value) => { sent = value; return runtime; }, now: () => "2026-08-11T08:12:01.000Z" });
  assert.deepEqual(sent, { protocolVersion: 1, operation: "CLEANUP", commandId: command.id, contractId: command.contractId });
  assert.equal(result.details.cleanupStatus, "CLEANED");
  assert.equal(result.evidenceDigest, digestJson(result.details));
  await assert.rejects(cleanupWorkload({ ...command, payload: { ...command.payload, removeWorkspace: false } }, {}, { call: async () => runtime }), (error) => error.code === "CLEANUP_COMMAND_INVALID");
  await assert.rejects(cleanupWorkload(command, {}, { call: async () => ({ ...runtime, authorizedKeyRemoved: false }) }), (error) => error.code === "ACTUATOR_RESULT_INVALID");
});

test("transient actuator failures retry by lease and the final attempt reports a signed failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-actuator-client-"));
  const stateFile = join(directory, "identity.json");
  const identity = await generateDeviceIdentity();
  let attempt = 1;
  let completed = null;
  const command = {
    id: "hcmd_actuator0001",
    deviceId: "had_actuator0001",
    contractId: "hctr_actuator0001",
    type: "PROVISION",
    attempt,
    payload: { contractId: "hctr_actuator0001", image, publicKey, reservedSeconds: 3_600, gpuCount: 1 },
  };
  const post = async (url, body) => {
    if (url.endsWith("/commands/poll")) return { command: { ...command, attempt } };
    completed = body;
    return { command: { id: command.id, status: body.outcome } };
  };
  try {
    await writeState({
      version: 1,
      status: "ACTIVE",
      deviceId: command.deviceId,
      privateKeyPkcs8: identity.privateKeyPkcs8,
      publicKeyRaw: identity.publicKeyRaw,
      apiOrigin: "http://127.0.0.1:3014",
      inventory: { publicHost: "gpu.example.com", sshPortStart: 22_000, memoryMiB: 65_536 },
      inventoryDigest: `sha256:${"d".repeat(64)}`,
      lastSequence: 0,
    }, stateFile);
    const unavailable = async () => { throw new AgentError("ACTUATOR_UNAVAILABLE", "offline"); };
    await assert.rejects(processOneCommand({ stateFile, allowInsecureLocal: true, post, provisioner: unavailable }), (error) => error.code === "ACTUATOR_UNAVAILABLE");
    assert.equal(completed, null);

    attempt = 5;
    const result = await processOneCommand({ stateFile, allowInsecureLocal: true, post, provisioner: unavailable });
    assert.equal(result.result.outcome, "FAILED");
    assert.equal(completed.errorCode, "ACTUATOR_UNAVAILABLE");
    assert.equal(completed.evidenceDigest, digestJson(completed.details));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
