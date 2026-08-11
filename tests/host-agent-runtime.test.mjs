import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pairDevice, heartbeat } from "../host-agent/src/client.mjs";
import { parseNvidiaInventory } from "../host-agent/src/inventory.mjs";
import { assertHttpsEndpoint, canonicalJson, digestJson, generateDeviceIdentity, signPayload } from "../host-agent/src/protocol.mjs";
import { readState } from "../host-agent/src/state.mjs";
import { hostingAgentCanonicalJson, hostingAgentDigest, verifyHostingAgentSignature } from "../lib/server/hosting-agent-crypto.ts";

const inventory = {
  hostnameDigest: `sha256:${"1".repeat(64)}`,
  gpuModel: "RTX_4090",
  gpuUuidDigest: `sha256:${"2".repeat(64)}`,
  gpuMemoryMiB: 24_576,
  driverVersion: "580.10",
  cudaVersion: "13.0",
  cpuModel: "AMD Ryzen 9 9950X",
  memoryMiB: 65_536,
  storageGiB: 2_048,
  publicHost: "gpu-4090.example.com",
  sshPortStart: 22_000,
  sshPortEnd: 22_019,
};

test("runtime canonical JSON, digest and Ed25519 signatures match the server protocol", async () => {
  const value = { z: [3, { beta: true, alpha: "中" }], a: { n: 2, m: 1 } };
  assert.equal(canonicalJson(value), hostingAgentCanonicalJson(value));
  assert.equal(digestJson(value), await hostingAgentDigest(value));

  const identity = await generateDeviceIdentity();
  assert.match(identity.publicKeyRaw, /^[A-Za-z0-9_-]{43}$/u);
  const payload = { operation: "TEST", value };
  const signature = await signPayload(identity.privateKeyPkcs8, payload);
  assert.match(signature, /^[A-Za-z0-9_-]{86}$/u);
  await assert.doesNotReject(verifyHostingAgentSignature(identity.publicKeyRaw, payload, signature));
  await assert.rejects(verifyHostingAgentSignature(identity.publicKeyRaw, { ...payload, changed: true }, signature), (error) => error.code === "AGENT_SIGNATURE_INVALID");
  assert.throws(() => assertHttpsEndpoint("http://cloud.kai.com/api/v2/agent/register"), (error) => error.code === "HTTPS_REQUIRED");
  assert.equal(assertHttpsEndpoint("https://cloud.kai.com/api/v2/agent/register").protocol, "https:");
});

test("NVIDIA inventory parser accepts one supported GPU and rejects ambiguous hosts", () => {
  assert.deepEqual(
    parseNvidiaInventory("GPU-uuid, NVIDIA GeForce RTX 4090, 24576, 580.10\n", "NVIDIA-SMI 580.10 CUDA Version: 13.0"),
    { uuid: "GPU-uuid", gpuModel: "RTX_4090", gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0" },
  );
  assert.equal(parseNvidiaInventory("GPU-h100, NVIDIA H100 80GB HBM3, 81559, 580.10", "CUDA Version: 13.0").gpuModel, "H100_80GB");
  assert.throws(() => parseNvidiaInventory("GPU-a, RTX 4090, 24576, 580.10\nGPU-b, RTX 4090, 24576, 580.10", "CUDA Version: 13.0"), (error) => error.code === "GPU_COUNT_UNSUPPORTED");
  assert.throws(() => parseNvidiaInventory("GPU-a, RTX 3090, 24576, 580.10", "CUDA Version: 13.0"), (error) => error.code === "GPU_MODEL_UNSUPPORTED");
});

test("pairing and heartbeat persist a private 0600 identity and send server-verifiable proofs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-host-agent-"));
  const stateFile = join(directory, "identity.json");
  let publicKey = "";
  let registeredDeviceId = "";
  try {
    const post = async (url, body, options) => {
      assert.equal(options.allowInsecureLocal, true);
      if (url.endsWith("/api/v2/agent/register")) {
        assert.match(options.idempotencyKey, /^kai-agent:register:/u);
        const { signature, ...payload } = body;
        publicKey = body.devicePublicKey;
        await verifyHostingAgentSignature(publicKey, payload, signature);
        assert.equal(body.inventoryDigest, await hostingAgentDigest(inventory));
        registeredDeviceId = "had_runtime_test_device_000001";
        return { record: { id: registeredDeviceId, inventoryDigest: body.inventoryDigest, lastSequence: 0 } };
      }
      assert.match(url, new RegExp(`/devices/${registeredDeviceId}/heartbeat$`, "u"));
      const { signature, issuedAt, expiresAt, sequence, inventoryDigest, capacityState, observedAt } = body;
      await verifyHostingAgentSignature(publicKey, { operation: "HEARTBEAT", deviceId: registeredDeviceId, sequence, inventoryDigest, capacityState, observedAt, issuedAt, expiresAt }, signature);
      return { record: { id: registeredDeviceId } };
    };

    const paired = await pairDevice({
      bundle: {
        version: 1,
        registerEndpoint: "http://127.0.0.1:3014/api/v2/agent/register",
        challengeId: "hac_runtime_challenge_000001",
        nonce: "runtimeNonceValue000001",
        minimumAgentVersion: "1.0.0",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
      displayName: "4090 工作站 01",
      publicHost: inventory.publicHost,
      sshPortStart: inventory.sshPortStart,
      sshPortEnd: inventory.sshPortEnd,
      stateFile,
      allowInsecureLocal: true,
      inventoryCollector: async () => inventory,
      post,
    });
    assert.equal(paired.deviceId, registeredDeviceId);
    const metadata = await stat(stateFile);
    assert.equal(metadata.mode & 0o077, 0);
    const stored = await readState(stateFile);
    assert.equal(stored.status, "ACTIVE");
    assert.equal(stored.deviceId, registeredDeviceId);
    assert.equal("registrationBody" in stored, false);
    assert.equal("nonce" in stored, false);

    const beat = await heartbeat({ stateFile, allowInsecureLocal: true, inventoryCollector: async () => inventory, post });
    assert.equal(beat.state.lastSequence, 1);
    assert.equal((await readState(stateFile)).lastSequence, 1);

    await chmod(stateFile, 0o644);
    await assert.rejects(readState(stateFile), (error) => error.code === "STATE_PERMISSIONS_INVALID");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installer is offline, non-root at runtime and systemd-hardened", async () => {
  const installer = await readFile("host-agent/install.sh", "utf8");
  const service = await readFile("host-agent/kai-host-agent.service", "utf8");
  const runtime = await readFile("host-agent/src/cli.mjs", "utf8");
  const packageJson = JSON.parse(await readFile("host-agent/package.json", "utf8"));

  assert.doesNotMatch(installer, /curl|wget|apt-get|npm install|docker group/u);
  assert.match(installer, /useradd --system/u);
  assert.match(installer, /ID=ubuntu/u);
  assert.match(service, /^User=kai-host-agent$/mu);
  assert.match(service, /^NoNewPrivileges=true$/mu);
  assert.match(service, /^ProtectSystem=strict$/mu);
  assert.match(service, /^ProtectHome=true$/mu);
  assert.match(service, /^ReadWritePaths=\/var\/lib\/kai-host-agent$/mu);
  assert.doesNotMatch(runtime, /privateKeyPkcs8|registrationBody|nonce/u);
  assert.equal(packageJson.dependencies, undefined);
});
