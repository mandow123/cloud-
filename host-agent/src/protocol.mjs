import { createHash, randomUUID, webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const encoder = new TextEncoder();

export class AgentError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "AgentError";
    this.code = code;
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new AgentError("PAYLOAD_INVALID", "Payload contains a non-finite number.");
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function digestJson(value) {
  return sha256(canonicalJson(value));
}

export async function generateDeviceIdentity() {
  const pair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return {
    privateKeyPkcs8: base64url(await subtle.exportKey("pkcs8", pair.privateKey)),
    publicKeyRaw: base64url(await subtle.exportKey("raw", pair.publicKey)),
  };
}

export async function importPrivateKey(privateKeyPkcs8) {
  if (typeof privateKeyPkcs8 !== "string" || !/^[A-Za-z0-9_-]+$/u.test(privateKeyPkcs8)) throw new AgentError("PRIVATE_KEY_INVALID", "Device private key is invalid.");
  try {
    return await subtle.importKey("pkcs8", Buffer.from(privateKeyPkcs8, "base64url"), { name: "Ed25519" }, false, ["sign"]);
  } catch (error) {
    throw new AgentError("PRIVATE_KEY_INVALID", "Device private key cannot be read.", { cause: error });
  }
}

export async function signPayload(privateKeyPkcs8, payload) {
  const privateKey = await importPrivateKey(privateKeyPkcs8);
  return base64url(await subtle.sign("Ed25519", privateKey, encoder.encode(canonicalJson(payload))));
}

export function proofWindow(now = new Date()) {
  return {
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  };
}

export function randomIdempotencyKey(scope) {
  return `kai-agent:${scope}:${randomUUID()}`;
}

export function randomNonce() {
  return base64url(webcrypto.getRandomValues(new Uint8Array(24)));
}

export function assertHttpsEndpoint(value, { allowInsecureLocal = false } = {}) {
  let url;
  try { url = new URL(value); }
  catch { throw new AgentError("ENDPOINT_INVALID", "Agent endpoint must be an absolute URL."); }
  const hostname = url.hostname.toLowerCase();
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)
    || /^(?:buyer|supplier|root|finance)\.localhost$/u.test(hostname);
  if (url.protocol !== "https:" && !(allowInsecureLocal && local && url.protocol === "http:")) {
    throw new AgentError("HTTPS_REQUIRED", "Host Agent only connects to HTTPS endpoints.");
  }
  if (url.username || url.password || url.hash) throw new AgentError("ENDPOINT_INVALID", "Agent endpoint cannot contain credentials or fragments.");
  return url;
}

export async function signedProof(privateKeyPkcs8, operation, deviceId, fields, now = new Date()) {
  const window = proofWindow(now);
  const payload = { operation, deviceId, ...fields, ...window };
  return { ...window, signature: await signPayload(privateKeyPkcs8, payload) };
}
