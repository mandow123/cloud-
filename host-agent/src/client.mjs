import { dirname } from "node:path";
import { collectInventory } from "./inventory.mjs";
import {
  AgentError,
  assertHttpsEndpoint,
  digestJson,
  generateDeviceIdentity,
  proofWindow,
  randomIdempotencyKey,
  signPayload,
  signedProof,
} from "./protocol.mjs";
import { readState, stateFilePath, writeState } from "./state.mjs";

export const AGENT_VERSION = "1.0.0";

function validatePairingBundle(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentError("PAIRING_INVALID", "Pairing bundle must be a JSON object.");
  const required = ["registerEndpoint", "challengeId", "nonce", "minimumAgentVersion", "expiresAt"];
  for (const field of required) if (typeof value[field] !== "string" || value[field].length < 3) throw new AgentError("PAIRING_INVALID", `Pairing field ${field} is invalid.`);
  if (value.version !== 1) throw new AgentError("PAIRING_VERSION_UNSUPPORTED", "Pairing bundle version is unsupported.");
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new AgentError("PAIRING_INVALID", "Pairing expiry is invalid.");
  if (expiresAt <= Date.now()) throw new AgentError("PAIRING_EXPIRED", "Pairing bundle has expired.");
  const endpoint = assertHttpsEndpoint(value.registerEndpoint, options);
  if (endpoint.pathname !== "/api/v2/agent/register") throw new AgentError("PAIRING_ENDPOINT_INVALID", "Pairing endpoint path is invalid.");
  if (!/^[A-Za-z0-9_-]+$/u.test(value.nonce)) throw new AgentError("PAIRING_INVALID", "Pairing nonce is invalid.");
  return { ...value, registerEndpoint: endpoint.toString() };
}

function semverTuple(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(value);
  if (!match) throw new AgentError("VERSION_INVALID", "Agent version is invalid.");
  return match.slice(1, 4).map(Number);
}

function versionAtLeast(current, minimum) {
  const left = semverTuple(current);
  const right = semverTuple(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

async function apiPost(url, body, { idempotencyKey, allowInsecureLocal = false, timeoutMs = 20_000 } = {}) {
  const endpoint = assertHttpsEndpoint(url, { allowInsecureLocal });
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        "user-agent": `KAI-Host-Agent/${AGENT_VERSION}`,
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AgentError("NETWORK_ERROR", "KAI Cloud could not be reached over the secured agent channel.", { cause: error });
  }
  const raw = (await response.text()).slice(0, 64 * 1024);
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; }
  catch { payload = null; }
  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? `KAI Cloud rejected the request (${response.status}).`;
    throw new AgentError(code, message);
  }
  if (!payload || typeof payload !== "object") throw new AgentError("RESPONSE_INVALID", "KAI Cloud returned an invalid agent response.");
  return payload;
}

export async function pairDevice({
  bundle,
  displayName,
  publicHost,
  sshPortStart,
  sshPortEnd,
  stateFile = stateFilePath(),
  allowInsecureLocal = false,
  inventoryCollector = collectInventory,
  post = apiPost,
}) {
  const pairing = validatePairingBundle(bundle, { allowInsecureLocal });
  if (!versionAtLeast(AGENT_VERSION, pairing.minimumAgentVersion)) throw new AgentError("AGENT_UPGRADE_REQUIRED", `Agent ${pairing.minimumAgentVersion} or newer is required.`);
  const name = typeof displayName === "string" ? displayName.normalize("NFKC").trim() : "";
  if (name.length < 2 || name.length > 80) throw new AgentError("DISPLAY_NAME_INVALID", "Device display name must contain 2–80 characters.");

  const identity = await generateDeviceIdentity();
  const inventoryConfig = { publicHost, sshPortStart, sshPortEnd, storagePath: dirname(stateFile) };
  const inventory = await inventoryCollector(inventoryConfig);
  const inventoryDigest = digestJson(inventory);
  const window = proofWindow();
  const signedPayload = {
    operation: "REGISTER_DEVICE",
    challengeId: pairing.challengeId,
    nonce: pairing.nonce,
    displayName: name,
    devicePublicKey: identity.publicKeyRaw,
    agentVersion: AGENT_VERSION,
    inventory,
    inventoryDigest,
    ...window,
  };
  const registrationBody = { ...signedPayload, signature: await signPayload(identity.privateKeyPkcs8, signedPayload) };
  const idempotencyKey = randomIdempotencyKey("register");
  await writeState({
    version: 1,
    status: "PAIRING",
    privateKeyPkcs8: identity.privateKeyPkcs8,
    publicKeyRaw: identity.publicKeyRaw,
    registrationBody,
    idempotencyKey,
    registerEndpoint: pairing.registerEndpoint,
    inventoryConfig,
    createdAt: new Date().toISOString(),
  }, stateFile);

  const response = await post(pairing.registerEndpoint, registrationBody, { idempotencyKey, allowInsecureLocal });
  const record = response.record;
  if (!record || typeof record.id !== "string" || typeof record.inventoryDigest !== "string") throw new AgentError("REGISTRATION_RESPONSE_INVALID", "Device registration response is invalid.");
  const activeState = {
    version: 1,
    status: "ACTIVE",
    deviceId: record.id,
    privateKeyPkcs8: identity.privateKeyPkcs8,
    publicKeyRaw: identity.publicKeyRaw,
    apiOrigin: new URL(pairing.registerEndpoint).origin,
    inventoryConfig,
    inventoryDigest: record.inventoryDigest,
    lastSequence: Number.isSafeInteger(record.lastSequence) ? record.lastSequence : 0,
    pairedAt: new Date().toISOString(),
  };
  await writeState(activeState, stateFile);
  return { deviceId: activeState.deviceId, inventory, state: activeState };
}

export async function heartbeat({
  stateFile = stateFilePath(),
  capacityState = "ONLINE",
  allowInsecureLocal = false,
  inventoryCollector = collectInventory,
  post = apiPost,
} = {}) {
  const state = await readState(stateFile);
  if (state.status !== "ACTIVE" || typeof state.deviceId !== "string" || typeof state.apiOrigin !== "string") throw new AgentError("STATE_NOT_ACTIVE", "Agent pairing has not completed.");
  const sequence = state.lastSequence + 1;
  let inventoryDigest = state.inventoryDigest;
  let nextCapacityState = capacityState;
  try {
    inventoryDigest = digestJson(await inventoryCollector(state.inventoryConfig));
  } catch {
    nextCapacityState = "OFFLINE";
  }
  const observedAt = new Date().toISOString();
  const fields = { sequence, inventoryDigest, capacityState: nextCapacityState, observedAt };
  const proof = await signedProof(state.privateKeyPkcs8, "HEARTBEAT", state.deviceId, fields);
  const url = `${state.apiOrigin}/api/v2/agent/devices/${encodeURIComponent(state.deviceId)}/heartbeat`;
  try {
    const response = await post(url, { ...fields, ...proof }, { allowInsecureLocal, timeoutMs: 15_000 });
    if (!response.record || response.record.id !== state.deviceId) throw new AgentError("HEARTBEAT_RESPONSE_INVALID", "Heartbeat response is invalid.");
    const updated = { ...state, inventoryDigest, lastSequence: sequence, lastHeartbeatAt: observedAt };
    await writeState(updated, stateFile);
    return { state: updated, record: response.record, capacityState: nextCapacityState };
  } catch (error) {
    if (error instanceof AgentError && error.code === "EXCHANGE_STATE_CONFLICT") {
      await writeState({ ...state, lastSequence: sequence }, stateFile);
    }
    throw error;
  }
}

export async function resumePairing({ stateFile = stateFilePath(), allowInsecureLocal = false, post = apiPost } = {}) {
  const state = await readState(stateFile);
  if (state.status !== "PAIRING" || !state.registrationBody || !state.registerEndpoint || !state.idempotencyKey) throw new AgentError("PAIRING_NOT_PENDING", "No pending pairing transaction was found.");
  const response = await post(state.registerEndpoint, state.registrationBody, { idempotencyKey: state.idempotencyKey, allowInsecureLocal });
  const record = response.record;
  if (!record || typeof record.id !== "string") throw new AgentError("REGISTRATION_RESPONSE_INVALID", "Device registration response is invalid.");
  const activeState = {
    version: 1,
    status: "ACTIVE",
    deviceId: record.id,
    privateKeyPkcs8: state.privateKeyPkcs8,
    publicKeyRaw: state.publicKeyRaw,
    apiOrigin: new URL(state.registerEndpoint).origin,
    inventoryConfig: state.inventoryConfig,
    inventoryDigest: record.inventoryDigest,
    lastSequence: Number.isSafeInteger(record.lastSequence) ? record.lastSequence : 0,
    pairedAt: new Date().toISOString(),
  };
  await writeState(activeState, stateFile);
  return { deviceId: activeState.deviceId, state: activeState };
}
