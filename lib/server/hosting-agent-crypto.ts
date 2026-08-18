import { accountAuthDigest } from "./account-auth.ts";

export class HostingAgentCryptoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HostingAgentCryptoError";
    this.code = code;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new HostingAgentCryptoError("AGENT_PAYLOAD_INVALID", "Agent payload contains a non-finite number.");
  return value;
}

export function hostingAgentCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export async function hostingAgentDigest(value: unknown) {
  return `sha256:${await accountAuthDigest(hostingAgentCanonicalJson(value))}`;
}

function decodeBase64Url(value: string, bytes: number, field: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new HostingAgentCryptoError("AGENT_FIELD_INVALID", `${field} 格式无效。`);
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  let decoded: Uint8Array;
  try { decoded = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0)); }
  catch { throw new HostingAgentCryptoError("AGENT_FIELD_INVALID", `${field} 格式无效。`); }
  if (decoded.length !== bytes) throw new HostingAgentCryptoError("AGENT_FIELD_INVALID", `${field} 长度无效。`);
  const copied = new Uint8Array(new ArrayBuffer(decoded.length));
  copied.set(decoded);
  return copied;
}

export async function verifyHostingAgentSignature(publicKey: string, payload: unknown, signature: string) {
  const keyBytes = decodeBase64Url(publicKey, 32, "devicePublicKey");
  const signatureBytes = decodeBase64Url(signature, 64, "signature");
  let key: CryptoKey;
  try { key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]); }
  catch { throw new HostingAgentCryptoError("AGENT_KEY_INVALID", "设备公钥无法读取。"); }
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, new TextEncoder().encode(hostingAgentCanonicalJson(payload)));
  if (!valid) throw new HostingAgentCryptoError("AGENT_SIGNATURE_INVALID", "设备签名校验失败。");
}

export async function hostingAgentKeyId(publicKey: string) {
  const keyBytes = decodeBase64Url(publicKey, 32, "devicePublicKey");
  const digest = await crypto.subtle.digest("SHA-256", keyBytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hostingAgentTimestamp(value: unknown, field: string) {
  if (typeof value !== "string" || !value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new HostingAgentCryptoError("AGENT_FIELD_INVALID", `${field} 必须是 UTC 时间。`);
  }
  return new Date(value).toISOString();
}

export function assertHostingAgentWindow(issuedAt: string, expiresAt: string, now = new Date()) {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  if (expires <= issued || expires - issued > 2 * 60_000 || issued > now.getTime() + 30_000 || expires < now.getTime()) {
    throw new HostingAgentCryptoError("AGENT_PROOF_EXPIRED", "设备证明已过期或时间窗无效。");
  }
}
