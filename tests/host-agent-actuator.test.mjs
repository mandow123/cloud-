import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { provisionWorkload } from "../host-agent/src/actuator-client.mjs";
import { executeProvision, parseProvisionRequest } from "../host-agent/src/actuator.mjs";
import { processOneCommand } from "../host-agent/src/client.mjs";
import { AgentError, digestJson, generateDeviceIdentity } from "../host-agent/src/protocol.mjs";
import { writeState } from "../host-agent/src/state.mjs";

const image = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`;
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
  assert.deepEqual(Object.keys(sent).sort(), ["commandId", "contractId", "gpuCount", "image", "memoryMiB", "operation", "protocolVersion", "publicHost", "publicKey", "sshPort"].sort());
  assert.equal(result.outcome, "SUCCEEDED");
  assert.equal(result.evidenceDigest, digestJson(details));
  await assert.rejects(provisionWorkload({ ...command, type: "SHELL" }, state, { call: async () => details }), (error) => error.code === "PROVISION_COMMAND_INVALID");
  await assert.rejects(provisionWorkload(command, {}, { call: async () => details }), (error) => error.code === "AGENT_UPGRADE_REQUIRED");
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
