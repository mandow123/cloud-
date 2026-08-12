import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
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

export async function doctorActuator({ call = callActuator } = {}) {
  const result = await call({ protocolVersion: 1, operation: "DOCTOR" });
  if (result.protocolVersion !== 1 || typeof result.dockerVersion !== "string"
    || !/^\d+\.\d+(?:\.\d+)?(?:[-+._A-Za-z0-9]*)?$/u.test(result.dockerVersion)
    || result.nvidiaRuntime !== true) {
    throw new AgentError("ACTUATOR_RESULT_INVALID", "The workload actuator returned an invalid host readiness result.");
  }
  return result;
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
    reservedSeconds: payload.reservedSeconds,
  });
  if (result.protocolVersion !== 1 || result.contractId !== command.contractId || result.image !== payload.image || result.endpointDisplay !== `${inventory.publicHost}:${inventory.sshPortStart}` || !/^sha256:[a-f0-9]{64}$/u.test(result.containerDigest) || !/^sha256:[a-f0-9]{64}$/u.test(result.workspaceDigest)) {
    throw new AgentError("ACTUATOR_RESULT_INVALID", "The workload actuator result did not match the signed command.");
  }
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(result), errorCode: null, details: result };
}

function parseEndpoint(value, inventory) {
  const match = /^(\[[0-9a-f:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):([0-9]{2,5})$/u.exec(value ?? "");
  const host = match?.[1] ?? "";
  const port = Number(match?.[2] ?? 0);
  if (!match || host.toLowerCase() !== inventory.publicHost.toLowerCase() || port < inventory.sshPortStart || port > inventory.sshPortEnd) {
    throw new AgentError("START_ENDPOINT_INVALID", "Start endpoint is outside the paired inventory range.");
  }
  return { host: host.replace(/^\[|\]$/gu, ""), port, display: `${match[1]}:${port}` };
}

async function readSshBanner(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(new AgentError("SSH_READINESS_TIMEOUT", "SSH service did not become ready.")));
    socket.on("data", (chunk) => {
      length += chunk.length;
      if (length > 1_024) return finish(new AgentError("SSH_BANNER_INVALID", "SSH service returned an invalid banner."));
      chunks.push(chunk);
      const lines = Buffer.concat(chunks).toString("ascii").split(/\r?\n/u);
      const banner = lines.find((line) => line.startsWith("SSH-"));
      if (!banner) return;
      if (!/^SSH-2\.0-[\x21-\x7e]{1,200}$/u.test(banner)) return finish(new AgentError("SSH_BANNER_INVALID", "SSH service returned an unsupported banner."));
      return finish(null, digestJson({ banner }));
    });
    socket.on("error", (error) => finish(new AgentError("SSH_READINESS_UNAVAILABLE", "SSH service is not reachable.", { cause: error })));
    socket.on("end", () => finish(new AgentError("SSH_BANNER_INVALID", "SSH service closed before sending its banner.")));
  });
}

export async function probeSshReadiness(endpoint, { attempts = 10, timeoutMs = 2_500, waitMs = 1_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await readSshBanner(endpoint.host, endpoint.port, timeoutMs); }
    catch (error) { lastError = error; }
    if (attempt < attempts) await delay(waitMs);
  }
  throw new AgentError("SSH_READINESS_TIMEOUT", "SSH service did not present a valid protocol banner before the readiness deadline.", { cause: lastError });
}

export async function startWorkload(command, state, { call = callActuator, probe = probeSshReadiness, now = () => new Date().toISOString() } = {}) {
  const payload = command?.payload;
  const inventory = state?.inventory;
  if (!command || command.type !== "START" || typeof command.id !== "string" || typeof command.contractId !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AgentError("START_COMMAND_INVALID", "Start command is invalid.");
  }
  const fields = Object.keys(payload).sort();
  if (fields.join(",") !== "contractId,endpointDisplay" || payload.contractId !== command.contractId || typeof payload.endpointDisplay !== "string") {
    throw new AgentError("START_COMMAND_INVALID", "Start command fields are invalid.");
  }
  if (!inventory || typeof inventory.publicHost !== "string" || !Number.isSafeInteger(inventory.sshPortStart) || !Number.isSafeInteger(inventory.sshPortEnd)) {
    throw new AgentError("AGENT_UPGRADE_REQUIRED", "Paired inventory is missing; pair this Agent again before starting workloads.");
  }
  const endpoint = parseEndpoint(payload.endpointDisplay, inventory);
  const runtime = await call({ protocolVersion: 1, operation: "START", commandId: command.id, contractId: command.contractId });
  if (runtime.protocolVersion !== 1 || runtime.contractId !== command.contractId
    || !/^sha256:[a-f0-9]{64}$/u.test(runtime.containerDigest)
    || !/^sha256:[a-f0-9]{64}$/u.test(runtime.runtimeStateDigest)
    || typeof runtime.startedAt !== "string" || !Number.isFinite(Date.parse(runtime.startedAt))) {
    throw new AgentError("ACTUATOR_RESULT_INVALID", "The workload start result did not match the signed command.");
  }
  const sshBannerDigest = await probe(endpoint);
  if (!/^sha256:[a-f0-9]{64}$/u.test(sshBannerDigest)) throw new AgentError("SSH_EVIDENCE_INVALID", "SSH readiness evidence is invalid.");
  const details = { ...runtime, endpointDisplay: endpoint.display, runtimeStatus: "RUNNING", sshBannerDigest, observedAt: now() };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

export async function stopWorkload(command, _state, { call = callActuator, now = () => new Date().toISOString() } = {}) {
  const payload = command?.payload;
  if (!command || command.type !== "STOP" || typeof command.id !== "string" || typeof command.contractId !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AgentError("STOP_COMMAND_INVALID", "Stop command is invalid.");
  }
  const fields = Object.keys(payload).sort();
  if (fields.join(",") !== "contractId,maximumSeconds,startedAt" || payload.contractId !== command.contractId
    || typeof payload.startedAt !== "string" || !Number.isFinite(Date.parse(payload.startedAt))
    || !Number.isSafeInteger(payload.maximumSeconds) || payload.maximumSeconds < 180) {
    throw new AgentError("STOP_COMMAND_INVALID", "Stop command fields are invalid.");
  }
  const runtime = await call({ protocolVersion: 1, operation: "STOP", commandId: command.id, contractId: command.contractId });
  if (runtime.protocolVersion !== 1 || runtime.contractId !== command.contractId
    || !/^sha256:[a-f0-9]{64}$/u.test(runtime.containerDigest)
    || !/^sha256:[a-f0-9]{64}$/u.test(runtime.runtimeStateDigest)
    || typeof runtime.startedAt !== "string" || typeof runtime.stoppedAt !== "string"
    || !Number.isFinite(Date.parse(runtime.startedAt)) || !Number.isFinite(Date.parse(runtime.stoppedAt))
    || Date.parse(runtime.startedAt) > Date.parse(runtime.stoppedAt)
    || !Number.isSafeInteger(runtime.runtimeSeconds) || runtime.runtimeSeconds < 0) {
    throw new AgentError("ACTUATOR_RESULT_INVALID", "The workload stop result did not match the signed command.");
  }
  const details = { ...runtime, runtimeStatus: "STOPPED", observedAt: now() };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}

export async function cleanupWorkload(command, _state, { call = callActuator, now = () => new Date().toISOString() } = {}) {
  const payload = command?.payload;
  if (!command || command.type !== "CLEANUP" || typeof command.id !== "string" || typeof command.contractId !== "string" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AgentError("CLEANUP_COMMAND_INVALID", "Cleanup command is invalid.");
  }
  const fields = Object.keys(payload).sort();
  if (fields.join(",") !== "contractId,removeAuthorizedKeys,removeContainer,removeWorkspace" || payload.contractId !== command.contractId
    || payload.removeAuthorizedKeys !== true || payload.removeContainer !== true || payload.removeWorkspace !== true) {
    throw new AgentError("CLEANUP_COMMAND_INVALID", "Cleanup command fields are invalid.");
  }
  const runtime = await call({ protocolVersion: 1, operation: "CLEANUP", commandId: command.id, contractId: command.contractId });
  if (runtime.protocolVersion !== 1 || runtime.contractId !== command.contractId
    || !/^sha256:[a-f0-9]{64}$/u.test(runtime.containerDigest)
    || !/^sha256:[a-f0-9]{64}$/u.test(runtime.cleanupDigest)
    || runtime.containerRemoved !== true || runtime.authorizedKeyRemoved !== true || runtime.workspaceRemoved !== true
    || typeof runtime.cleanedAt !== "string" || !Number.isFinite(Date.parse(runtime.cleanedAt))) {
    throw new AgentError("ACTUATOR_RESULT_INVALID", "The workload cleanup result did not match the signed command.");
  }
  const details = { ...runtime, cleanupStatus: "CLEANED", observedAt: now() };
  return { outcome: "SUCCEEDED", evidenceDigest: digestJson(details), errorCode: null, details };
}
