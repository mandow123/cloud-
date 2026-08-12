import { execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { collectInventory } from "./inventory.mjs";
import { AgentError } from "./protocol.mjs";

const execFile = promisify(execFileCallback);

function fail(code, message, cause) {
  return new AgentError(code, message, cause ? { cause } : undefined);
}

async function dockerProbe(run = execFile) {
  try {
    const [{ stdout: versionOutput }, { stdout: runtimesOutput }] = await Promise.all([
      run("/usr/bin/docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 }),
      run("/usr/bin/docker", ["info", "--format", "{{json .Runtimes}}"], { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 }),
    ]);
    const dockerVersion = versionOutput.trim();
    const runtimes = JSON.parse(runtimesOutput.trim());
    if (!/^\d+\.\d+(?:\.\d+)?(?:[-+._A-Za-z0-9]*)?$/u.test(dockerVersion)) {
      throw fail("DOCKER_VERSION_INVALID", "Docker returned an invalid server version.");
    }
    if (!runtimes || typeof runtimes !== "object" || Array.isArray(runtimes) || !("nvidia" in runtimes)) {
      throw fail("NVIDIA_RUNTIME_MISSING", "Docker is not configured with the NVIDIA container runtime.");
    }
    return { dockerVersion, nvidiaRuntime: true };
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw fail("DOCKER_UNAVAILABLE", "Docker Engine or the NVIDIA container runtime is unavailable.", error);
  }
}

async function assertPortAvailable(port, create = createServer) {
  await new Promise((resolve, reject) => {
    const server = create();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve();
    };
    server.once("error", (error) => finish(fail("SSH_PORT_UNAVAILABLE", `Managed SSH port ${port} is unavailable.`, error)));
    server.listen({ host: "0.0.0.0", port, exclusive: true }, () => {
      server.close((error) => finish(error ? fail("SSH_PORT_CHECK_FAILED", `Managed SSH port ${port} could not be released after inspection.`, error) : undefined));
    });
  });
}

export async function runDoctor(input, {
  inventoryCollector = collectInventory,
  runDocker = dockerProbe,
  portChecker = assertPortAvailable,
} = {}) {
  const inventory = await inventoryCollector(input);
  const runtime = await runDocker();
  await portChecker(inventory.sshPortStart);
  if (inventory.storageGiB < 40) throw fail("STORAGE_CAPACITY_LOW", "At least 40 GiB of storage is required for managed workloads.");
  if (inventory.memoryMiB < 8_192) throw fail("HOST_MEMORY_LOW", "At least 8 GiB of host memory is required.");
  return {
    inventory,
    runtime,
    managedPort: inventory.sshPortStart,
    storageReady: true,
    memoryReady: true,
  };
}
