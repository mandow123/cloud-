import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkConnection, heartbeat, pairDevice, processOneCommand } from "../host-agent/src/client.mjs";
import { doctorActuator, verifyWorkloadImages } from "../host-agent/src/actuator-client.mjs";
import { runDoctor } from "../host-agent/src/doctor.mjs";
import { parseNvidiaInventory } from "../host-agent/src/inventory.mjs";
import { AgentError, assertHttpsEndpoint, canonicalJson, digestJson, generateDeviceIdentity, signPayload } from "../host-agent/src/protocol.mjs";
import { readPairingFile, readState } from "../host-agent/src/state.mjs";
import { defaultVerificationRunners, runVerification, VERIFY_TESTS } from "../host-agent/src/verify.mjs";
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
  assert.equal(assertHttpsEndpoint("http://supplier.localhost:3014/api/v2/agent/register", { allowInsecureLocal: true }).hostname, "supplier.localhost");
  assert.throws(() => assertHttpsEndpoint("http://attacker.localhost:3014/api/v2/agent/register", { allowInsecureLocal: true }), (error) => error.code === "HTTPS_REQUIRED");
  assert.throws(() => assertHttpsEndpoint("http://supplier.localhost.example.com/api/v2/agent/register", { allowInsecureLocal: true }), (error) => error.code === "HTTPS_REQUIRED");
});

test("NVIDIA inventory parser accepts one supported GPU and requires an exact UUID on multi-GPU hosts", () => {
  assert.deepEqual(
    parseNvidiaInventory("GPU-uuid, NVIDIA GeForce RTX 4090, 24576, 580.10\n", "NVIDIA-SMI 580.10 CUDA Version: 13.0"),
    { uuid: "GPU-uuid", gpuModel: "RTX_4090", gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0" },
  );
  assert.equal(parseNvidiaInventory("GPU-h100, NVIDIA H100 80GB HBM3, 81559, 580.10", "CUDA Version: 13.0").gpuModel, "H100_80GB");
  assert.equal(parseNvidiaInventory("GPU-h100-nvl, NVIDIA H100 NVL, 95830, 580.10", "CUDA Version: 13.0").gpuModel, "H100_94GB");
  const multiGpu = "GPU-card-a, NVIDIA H100 80GB HBM3, 81559, 580.10\nGPU-card-b, NVIDIA H100 80GB HBM3, 95830, 580.10";
  assert.throws(() => parseNvidiaInventory(multiGpu, "CUDA Version: 13.0"), (error) => error.code === "GPU_SELECTION_REQUIRED");
  assert.equal(parseNvidiaInventory(multiGpu, "CUDA Version: 13.0", "GPU-card-b").uuid, "GPU-card-b");
  assert.equal(parseNvidiaInventory(multiGpu, "CUDA Version: 13.0", "GPU-card-b").gpuMemoryMiB, 95_830);
  assert.throws(() => parseNvidiaInventory(multiGpu, "CUDA Version: 13.0", "GPU-missing"), (error) => error.code === "GPU_UUID_NOT_FOUND");
  assert.throws(() => parseNvidiaInventory("GPU-card-a, RTX 3090, 24576, 580.10", "CUDA Version: 13.0"), (error) => error.code === "GPU_MODEL_UNSUPPORTED");
});

test("pairing files must be absolute private regular files and never symbolic links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-host-agent-pairing-file-"));
  const pairingFile = join(directory, "pairing.json");
  const pairingLink = join(directory, "pairing-link.json");
  try {
    await writeFile(pairingFile, '{"version":1}\n', { mode: 0o600 });
    assert.deepEqual(await readPairingFile(pairingFile), { version: 1 });
    await chmod(pairingFile, 0o640);
    await assert.rejects(readPairingFile(pairingFile), (error) => error.code === "PAIRING_FILE_PERMISSIONS_INVALID");
    await chmod(pairingFile, 0o600);
    await symlink(pairingFile, pairingLink);
    await assert.rejects(readPairingFile(pairingLink), (error) => error.code === "PAIRING_FILE_SYMLINK_FORBIDDEN");
    await assert.rejects(readPairingFile("pairing.json"), (error) => error.code === "PAIRING_FILE_INVALID");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("doctor fails closed unless Docker, NVIDIA runtime, capacity and the managed port are ready", async () => {
  const calls = [];
  const result = await runDoctor({ publicHost: inventory.publicHost }, {
    inventoryCollector: async () => inventory,
    runtimeChecker: async () => ({ protocolVersion: 1, dockerVersion: "28.0.4", nvidiaRuntime: true }),
    portChecker: async (port) => calls.push(port),
  });
  assert.equal(result.inventory.gpuModel, "RTX_4090");
  assert.equal(result.runtime.nvidiaRuntime, true);
  assert.deepEqual(calls, [22_000]);

  await assert.rejects(runDoctor({}, {
    inventoryCollector: async () => ({ ...inventory, storageGiB: 39 }),
    runtimeChecker: async () => ({ protocolVersion: 1, dockerVersion: "28.0.4", nvidiaRuntime: true }),
    portChecker: async () => undefined,
  }), (error) => error.code === "STORAGE_CAPACITY_LOW");
  await assert.rejects(runDoctor({}, {
    inventoryCollector: async () => ({ ...inventory, memoryMiB: 8_191 }),
    runtimeChecker: async () => ({ protocolVersion: 1, dockerVersion: "28.0.4", nvidiaRuntime: true }),
    portChecker: async () => undefined,
  }), (error) => error.code === "HOST_MEMORY_LOW");
});

test("doctor obtains Docker readiness only through the constrained root actuator", async () => {
  let request = null;
  const result = await doctorActuator({ call: async (value) => {
    request = value;
    return { protocolVersion: 1, dockerVersion: "28.0.4", nvidiaRuntime: true };
  } });
  assert.deepEqual(request, { protocolVersion: 1, operation: "DOCTOR" });
  assert.equal(result.nvidiaRuntime, true);
  await assert.rejects(doctorActuator({ call: async () => ({ protocolVersion: 1, dockerVersion: "28.0.4", nvidiaRuntime: false }) }), (error) => error.code === "ACTUATOR_RESULT_INVALID");
});

test("non-root verification accepts only exact image evidence from the root actuator", async () => {
  const images = [process.env.KAI_HOSTING_APPROVED_IMAGES];
  let request = null;
  const result = await verifyWorkloadImages(images, { call: async (value) => {
    request = value;
    return { protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images, allPresent: true };
  } });
  assert.deepEqual(request, { protocolVersion: 1, operation: "VERIFY_IMAGES", images });
  assert.equal(result.allPresent, true);
  await assert.rejects(verifyWorkloadImages(images, { call: async () => ({ protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images: [], allPresent: true }) }), (error) => error.code === "ACTUATOR_RESULT_INVALID");
});

test("CUDA verification queries only the GPU UUID bound during pairing", async () => {
  const calls = [];
  const state = { inventoryConfig: { gpuUuid: "GPU-selected-card" } };
  const runners = defaultVerificationRunners(state, async () => inventory, async (file, args) => {
    calls.push([file, ...args]);
    return { stdout: "Default, P0, 31\n" };
  });
  const result = await runners.CUDA_SMOKE();
  assert.equal(result.method, "NVIDIA_SMI_COMPUTE_MODE");
  assert.deepEqual(calls, [["nvidia-smi", "--id", "GPU-selected-card", "--query-gpu=compute_mode,pstate,temperature.gpu", "--format=csv,noheader,nounits"]]);
});

test("VERIFY runs only the fixed seven probes and binds every result to signed evidence", async () => {
  const state = { inventoryDigest: await hostingAgentDigest(inventory) };
  const command = { id: "cmd_runtime_verify_000001", type: "VERIFY", payload: { expectedInventoryDigest: state.inventoryDigest, tests: [...VERIFY_TESTS], approvedImages: [process.env.KAI_HOSTING_APPROVED_IMAGES] } };
  const runners = Object.fromEntries(VERIFY_TESTS.map((name) => [name, async () => ({ probe: name, ok: true })]));
  const result = await runVerification(command, state, { runners });
  assert.equal(result.outcome, "SUCCEEDED");
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.details.tests.map((item) => item.name), VERIFY_TESTS);
  assert.ok(result.details.tests.every((item) => item.status === "PASSED" && /^sha256:[a-f0-9]{64}$/u.test(item.evidenceDigest)));
  assert.equal(result.evidenceDigest, await hostingAgentDigest(result.details));

  const failed = await runVerification(command, state, { runners: { ...runners, NETWORK: async () => { throw new AgentError("NETWORK_PROBE_FAILED", "offline"); } } });
  assert.equal(failed.outcome, "FAILED");
  assert.equal(failed.errorCode, "VERIFICATION_FAILED");
  assert.equal(failed.details.tests.find((item) => item.name === "NETWORK").errorCode, "NETWORK_PROBE_FAILED");
  await assert.rejects(runVerification({ ...command, payload: { ...command.payload, tests: [...VERIFY_TESTS, "SHELL"] } }, state, { runners }), (error) => error.code === "VERIFY_TEST_SET_INVALID");
});

test("reachability verification exposes only the one-time challenge window", async () => {
  const port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
  const challenge = "a".repeat(32);
  const state = {
    deviceId: "had_runtime_reachability_000001",
    inventoryConfig: { publicHost: "gpu.example.com", sshPortStart: port },
  };
  const command = { id: "hcmd_runtime_reachability_000001", payload: { reachabilityChallenge: challenge } };
  const probe = await defaultVerificationRunners(state).PORT_REACHABILITY(command);
  const response = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { body += chunk; });
    socket.once("end", () => resolve(body));
    socket.once("error", reject);
  });
  assert.equal(response, `KAI-HOST-VERIFY/1 ${challenge}\n`);
  assert.equal(probe.summary.scope, "CONTROL_PLANE_CHALLENGE");
  assert.match(probe.summary.challengeDigest, /^sha256:[a-f0-9]{64}$/u);
  await probe.close();
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  }));
});

test("pairing and heartbeat persist a private 0600 identity and send server-verifiable proofs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-host-agent-"));
  const stateFile = join(directory, "identity.json");
  let publicKey = "";
  let registeredDeviceId = "";
  let completedCommand = null;
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
      if (url.endsWith(`/devices/${registeredDeviceId}/heartbeat`)) {
        const { signature, issuedAt, expiresAt, sequence, inventoryDigest, capacityState, observedAt } = body;
        await verifyHostingAgentSignature(publicKey, { operation: "HEARTBEAT", deviceId: registeredDeviceId, sequence, inventoryDigest, capacityState, observedAt, issuedAt, expiresAt }, signature);
        return { record: { id: registeredDeviceId } };
      }
      if (url.endsWith(`/devices/${registeredDeviceId}/commands/poll`)) {
        const { signature, issuedAt, expiresAt, requestNonce } = body;
        await verifyHostingAgentSignature(publicKey, { operation: "POLL_COMMAND", deviceId: registeredDeviceId, requestNonce, issuedAt, expiresAt }, signature);
        return { command: { id: "cmd_runtime_verify_000001", type: "VERIFY", payload: { expectedInventoryDigest: await hostingAgentDigest(inventory), tests: [...VERIFY_TESTS], approvedImages: [process.env.KAI_HOSTING_APPROVED_IMAGES] } } };
      }
      if (url.endsWith(`/devices/${registeredDeviceId}/commands/cmd_runtime_verify_000001/complete`)) {
        const { signature, issuedAt, expiresAt, outcome, evidenceDigest, errorCode, details } = body;
        await verifyHostingAgentSignature(publicKey, { operation: "COMPLETE_COMMAND", deviceId: registeredDeviceId, commandId: "cmd_runtime_verify_000001", outcome, evidenceDigest, errorCode, details, issuedAt, expiresAt }, signature);
        assert.equal(evidenceDigest, await hostingAgentDigest(details));
        completedCommand = body;
        return { command: { id: "cmd_runtime_verify_000001", status: outcome } };
      }
      throw new Error(`Unexpected Agent endpoint: ${url}`);
    };

    const paired = await pairDevice({
      bundle: {
        version: 1,
        registerEndpoint: "http://127.0.0.1:3014/api/v2/agent/register",
        challengeId: "hac_runtime_challenge_000001",
        nonce: "runtimeNonceValue000001",
        minimumAgentVersion: "1.11.0",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
      displayName: "4090 工作站 01",
      publicHost: inventory.publicHost.toUpperCase(),
      sshPortStart: inventory.sshPortStart,
      sshPortEnd: inventory.sshPortEnd,
      gpuUuid: "GPU-real",
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
    assert.equal(stored.inventoryConfig.publicHost, inventory.publicHost);
    assert.equal("registrationBody" in stored, false);
    assert.equal("nonce" in stored, false);

    const beat = await heartbeat({ stateFile, allowInsecureLocal: true, inventoryCollector: async () => inventory, post });
    assert.equal(beat.state.lastSequence, 1);
    assert.equal((await readState(stateFile)).lastSequence, 1);

    const connection = await checkConnection({ stateFile, allowInsecureLocal: true, inventoryCollector: async () => inventory, post });
    assert.equal(connection.state.lastSequence, 2);
    assert.equal(connection.capacityState, "OFFLINE");

    const processed = await processOneCommand({
      stateFile,
      allowInsecureLocal: true,
      post,
      verifier: async (command, state) => {
        const details = { protocolVersion: 1, inventoryDigest: state.inventoryDigest, observedAt: new Date().toISOString(), tests: VERIFY_TESTS.map((name, index) => ({ name, status: "PASSED", evidenceDigest: `sha256:${String(index + 1).repeat(64)}` })) };
        return { outcome: "SUCCEEDED", evidenceDigest: await hostingAgentDigest(details), errorCode: null, details };
      },
    });
    assert.equal(processed.command.type, "VERIFY");
    assert.equal(completedCommand.outcome, "SUCCEEDED");

    await chmod(stateFile, 0o644);
    await assert.rejects(readState(stateFile), (error) => error.code === "STATE_PERMISSIONS_INVALID");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("installer is offline, non-root at runtime and systemd-hardened", async () => {
  const installer = await readFile("host-agent/install.sh", "utf8");
  const service = await readFile("host-agent/kai-host-agent.service", "utf8");
  const actuatorService = await readFile("host-agent/kai-host-actuator.service", "utf8");
  const actuator = await readFile("host-agent/src/actuator.mjs", "utf8");
  const actuatorClient = await readFile("host-agent/src/actuator-client.mjs", "utf8");
  const runtime = await readFile("host-agent/src/cli.mjs", "utf8");
  const verifier = await readFile("host-agent/src/verify.mjs", "utf8");
  const doctor = await readFile("host-agent/src/doctor.mjs", "utf8");
  const packageJson = JSON.parse(await readFile("host-agent/package.json", "utf8"));

  assert.doesNotMatch(installer, /curl|wget|apt-get|npm install|docker group/u);
  assert.match(installer, /useradd --system/u);
  assert.match(installer, /\^ID=\(ubuntu\|"ubuntu"\)\$/u);
  assert.match(installer, /NODE_BINARY=\$\(command -v node\)/u);
  assert.match(installer, /\/usr\/bin\/node\|\/usr\/local\/bin\/node/u);
  assert.match(installer, /sed -i .*ExecStart/u);
  assert.match(installer, /release-manifest\.json/u);
  assert.match(installer, /createHash\("sha256"\)/u);
  assert.match(installer, /const requiredFiles = \[/u);
  assert.match(installer, /new Set\(manifestPaths\)\.size !== requiredFiles\.length/u);
  assert.match(installer, /manifest is incomplete or contains duplicate\/unexpected files/u);
  assert.match(installer, /systemctl stop kai-host-agent\.service/u);
  assert.match(installer, /mv -Tf .*\/opt\/kai-host-agent\/current/u);
  assert.match(installer, /PREVIOUS_RELEASE/u);
  assert.match(installer, /AGENT_WAS_ENABLED/u);
  assert.match(installer, /ACTUATOR_WAS_ACTIVE/u);
  assert.match(installer, /kai-host-actuator\.service.*\/etc\/systemd\/system\/kai-host-actuator\.service/u);
  assert.match(installer, /kai-host-agent-cli.*\/usr\/local\/bin\/kai-host-agent/u);
  assert.match(installer, /rm -f -- "\$LOCK_DIR\/kai-host-actuator\.service"/u);
  assert.match(service, /^User=kai-host-agent$/mu);
  assert.match(service, /^NoNewPrivileges=true$/mu);
  assert.match(service, /^ProtectSystem=strict$/mu);
  assert.match(service, /^ProtectHome=true$/mu);
  assert.match(service, /^ReadWritePaths=\/var\/lib\/kai-host-agent$/mu);
  assert.match(actuatorService, /^User=root$/mu);
  assert.match(actuatorService, /^Group=kai-host-agent$/mu);
  assert.match(actuatorService, /^RestrictAddressFamilies=AF_UNIX$/mu);
  assert.match(actuatorService, /^ReadWritePaths=\/var\/lib\/kai-host-actuator \/run\/kai-host-actuator \/run\/docker\.sock$/mu);
  assert.match(actuator, /execFile\("\/usr\/bin\/docker", args/u);
  assert.match(actuator, /export async function executeStart/u);
  assert.match(actuator, /export async function executeStop/u);
  assert.match(actuator, /export async function executeCleanup/u);
  assert.match(actuatorClient, /SSH-2\\\.0-/u);
  assert.doesNotMatch(actuator, /shell\s*:\s*true|\bexec(?:Sync)?\s*\(|--privileged/u);
  assert.doesNotMatch(actuatorClient, /node:child_process|\/usr\/bin\/docker|\/run\/docker\.sock/u);
  assert.doesNotMatch(doctor, /node:child_process|\/usr\/bin\/docker|\/run\/docker\.sock/u);
  assert.match(doctor, /doctorActuator/u);
  assert.doesNotMatch(runtime, /privateKeyPkcs8|registrationBody|nonce/u);
  assert.doesNotMatch(verifier, /shell\s*:\s*true|\bexec(?:Sync)?\s*\(/u);
  assert.match(installer, /src\/verify\.mjs/u);
  assert.match(installer, /src\/doctor\.mjs/u);
  assert.match(installer, /src\/preflight\.mjs/u);
  assert.match(installer, /kai-host-actuator\.service/u);
  assert.match(runtime, /check-connection/u);
  assert.match(runtime, /readPairingFile/u);
  assert.equal(packageJson.version, "1.11.0");
  assert.equal(packageJson.dependencies, undefined);
});
