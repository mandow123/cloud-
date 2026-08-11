import { execFile as execFileCallback } from "node:child_process";
import { lookup as lookupCallback } from "node:dns";
import { open, statfs, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectInventory } from "./inventory.mjs";
import { AgentError, digestJson, randomNonce } from "./protocol.mjs";

const execFile = promisify(execFileCallback);
const lookup = promisify(lookupCallback);
export const VERIFY_TESTS = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"];

function verificationError(code, message) {
  return new AgentError(code, message);
}

async function storageProbe(storagePath) {
  const path = join(storagePath, `.verify-${randomNonce()}`);
  let handle;
  try {
    const filesystem = await statfs(storagePath, { bigint: true });
    const availableGiB = Number(filesystem.bavail * filesystem.bsize / 1_073_741_824n);
    if (availableGiB < 40) throw verificationError("STORAGE_CAPACITY_LOW", "At least 40 GiB of free storage is required.");
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(Buffer.alloc(1024 * 1024));
    await handle.sync();
    return { availableGiB, writeProbeBytes: 1024 * 1024 };
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(path).catch(() => undefined);
  }
}

async function portProbe(host, port) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: host.replace(/^\[|\]$/gu, ""), port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.setTimeout(5_000, () => finish(verificationError("PORT_TIMEOUT", "Declared public port did not accept a connection.")));
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(new AgentError("PORT_UNREACHABLE", "Declared public port did not accept a connection.", { cause: error })));
  });
  return { port, scope: "HOST_ORIGIN" };
}

export function defaultVerificationRunners(state, inventoryCollector = collectInventory) {
  let inventoryPromise;
  const inventory = () => {
    inventoryPromise ??= inventoryCollector(state.inventoryConfig);
    return inventoryPromise;
  };
  return {
    async GPU_IDENTITY() {
      const current = await inventory();
      const inventoryDigest = digestJson(current);
      if (inventoryDigest !== state.inventoryDigest) throw verificationError("INVENTORY_CHANGED", "Current inventory differs from the registered inventory.");
      return { gpuModel: current.gpuModel, gpuMemoryMiB: current.gpuMemoryMiB, inventoryDigest };
    },
    async CUDA_SMOKE() {
      const { stdout } = await execFile("nvidia-smi", ["--query-gpu=compute_mode,pstate,temperature.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 });
      const rows = stdout.trim().split(/\r?\n/u).filter(Boolean);
      if (rows.length !== 1 || rows[0].split(",").length !== 3) throw verificationError("CUDA_DRIVER_PROBE_FAILED", "NVIDIA compute-mode probe returned an unexpected result.");
      return { method: "NVIDIA_SMI_COMPUTE_MODE", probeDigest: digestJson({ output: rows[0].trim() }) };
    },
    async MEMORY() {
      const current = await inventory();
      const memoryMiB = Math.floor(totalmem() / 1_048_576);
      if (memoryMiB < 8_192) throw verificationError("HOST_MEMORY_LOW", "At least 8 GiB of host memory is required.");
      return { hostMemoryMiB: memoryMiB, gpuMemoryMiB: current.gpuMemoryMiB };
    },
    async STORAGE() {
      return storageProbe(state.inventoryConfig.storagePath);
    },
    async NETWORK() {
      const apiHost = new URL(state.apiOrigin).hostname;
      const [apiAddress, publicAddress] = await Promise.all([lookup(apiHost), lookup(state.inventoryConfig.publicHost.replace(/^\[|\]$/gu, ""))]);
      return { apiFamily: apiAddress.family, publicHostFamily: publicAddress.family };
    },
    async PORT_REACHABILITY() {
      return portProbe(state.inventoryConfig.publicHost, Number(state.inventoryConfig.sshPortStart));
    },
  };
}

function validateCommand(command, state) {
  if (!command || typeof command !== "object" || command.type !== "VERIFY" || typeof command.id !== "string") throw verificationError("COMMAND_UNSUPPORTED", "Only VERIFY commands are supported by this Agent version.");
  const payload = command.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.expectedInventoryDigest !== state.inventoryDigest || !Array.isArray(payload.tests)) {
    throw verificationError("VERIFY_COMMAND_INVALID", "Verification command does not match the registered device inventory.");
  }
  if (payload.tests.length !== VERIFY_TESTS.length || new Set(payload.tests).size !== VERIFY_TESTS.length || VERIFY_TESTS.some((name) => !payload.tests.includes(name))) {
    throw verificationError("VERIFY_TEST_SET_INVALID", "Verification command contains an unsupported test set.");
  }
}

function errorCode(error) {
  const value = error instanceof AgentError ? error.code : "VERIFY_TEST_FAILED";
  return /^[A-Z0-9_:-]{3,80}$/u.test(value) ? value : "VERIFY_TEST_FAILED";
}

export async function runVerification(command, state, { runners = defaultVerificationRunners(state) } = {}) {
  validateCommand(command, state);
  const tests = [];
  for (const name of VERIFY_TESTS) {
    try {
      const summary = await runners[name]();
      tests.push({ name, status: "PASSED", evidenceDigest: digestJson({ name, summary }), summary });
    } catch (error) {
      const code = errorCode(error);
      tests.push({ name, status: "FAILED", evidenceDigest: digestJson({ name, code }), errorCode: code });
    }
  }
  const details = { protocolVersion: 1, inventoryDigest: state.inventoryDigest, observedAt: new Date().toISOString(), tests };
  const passed = tests.every((test) => test.status === "PASSED");
  return {
    outcome: passed ? "SUCCEEDED" : "FAILED",
    evidenceDigest: digestJson(details),
    errorCode: passed ? null : "VERIFICATION_FAILED",
    details,
  };
}
