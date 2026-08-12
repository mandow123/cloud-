import { createServer } from "node:net";
import { doctorActuator } from "./actuator-client.mjs";
import { collectInventory } from "./inventory.mjs";
import { AgentError } from "./protocol.mjs";

function fail(code, message, cause) {
  return new AgentError(code, message, cause ? { cause } : undefined);
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
  runtimeChecker = doctorActuator,
  portChecker = assertPortAvailable,
} = {}) {
  const inventory = await inventoryCollector(input);
  const runtime = await runtimeChecker();
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
