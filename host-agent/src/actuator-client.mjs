import { createConnection } from "node:net";
import { AgentError, digestJson } from "./protocol.mjs";

const defaultSocketPath = "/run/kai-host-actuator/actuator.sock";

export async function callActuator(request, { socketPath = process.env.KAI_HOST_ACTUATOR_SOCKET?.trim() || defaultSocketPath, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(new AgentError("ACTUATOR_TIMEOUT", "The isolated workload actuator timed out.")));
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      length += chunk.length;
      if (length > 64 * 1024) return finish(new AgentError("ACTUATOR_RESPONSE_TOO_LARGE", "The workload actuator response exceeded its limit."));
      chunks.push(chunk);
    });
    socket.on("error", (error) => finish(new AgentError("ACTUATOR_UNAVAILABLE", "The isolated workload actuator is unavailable.", { cause: error })));
    socket.on("end", () => {
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!response || typeof response !== "object") throw new Error("shape");
        if (response.ok === true && response.result && typeof response.result === "object") return finish(null, response.result);
        const code = typeof response.error?.code === "string" ? response.error.code : "ACTUATOR_REJECTED";
        return finish(new AgentError(code, "The isolated workload actuator rejected the request."));
      } catch (error) {
        return finish(error instanceof AgentError ? error : new AgentError("ACTUATOR_RESPONSE_INVALID", "The workload actuator returned an invalid response.", { cause: error }));
      }
    });
  });
}

export async function provisionWorkload(command, state, { call = callActuator } = {}) {
  const payload = command?.payload;
  const inventory = state?.inventory;
  if (!command || command.type !== "PROVISION" || typeof command.id !== "string" || typeof command.contractId !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AgentError("PROVISION_COMMAND_INVALID", "Provision command is invalid.");
  }
  const fields = Object.keys(payload).sort();
  if (fields.join(",") !== "contractId,gpuCount,image,publicKey,reservedSeconds" || payload.contractId !== command.contractId || payload.gpuCount !== 1 || !Number.isSafeInteger(payload.reservedSeconds) || payload.reservedSeconds < 180) {
    throw new AgentError("PROVISION_COMMAND_INVALID", "Provision command fields are invalid.");
  }
  if (!inventory || typeof inventory.publicHost !== "string" || !Number.isSafeInteger(inventory.sshPortStart) || !Number.isSafeInteger(inventory.memoryMiB)) {
    throw new AgentError("AGENT_UPGRADE_REQUIRED", "Paired inventory is missing; pair this Agent again before provisioning.");
  }
  const result = await call({
    protocolVersion: 1,
    operation: "PROVISION",
    commandId: command.id,
    contractId: command.contractId,
    image: payload.image,
    publicKey: payload.publicKey,
    publicHost: inventory.publicHost,
    sshPort: inventory.sshPortStart,
    memoryMiB: inventory.memoryMiB,
    gpuCount: 1,
  });
  if (result.protocolVersion !== 1 || result.contractId !== command.contractId || result.image !== payload.image || result.endpointDisplay !== `${inventory.publicHost}:${inventory.sshPortStart}` || !/^sha256:[a-f0-9]{64}$/u.test(result.containerDigest) || !/^sha256:[a-f0-9]{64}$/u.test(result.workspaceDigest)) {
    throw new AgentError("ACTUATOR_RESULT_INVALID", "The workload actuator result did not match the signed command.");
  }
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(result), errorCode: null, details: result };
}
