import { HOSTING_GPU_MODELS, type HostingDevice, type HostingDeviceInventory } from "../hosting-v2.ts";
import { AccountAuthError } from "./account-auth.ts";
import {
  HostingAgentCryptoError,
  assertHostingAgentWindow,
  hostingAgentTimestamp,
  verifyHostingAgentSignature,
} from "./hosting-agent-crypto.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function requireHostingAgentTransport(request: Request) {
  const url = new URL(request.url);
  if (url.protocol === "https:") return;
  const trustedProxy = typeof process !== "undefined" && process.env.KAI_TRUST_PROXY === "1";
  if (trustedProxy && request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https") return;
  const localDevelopment = typeof process !== "undefined" && process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!localDevelopment) throw new AccountAuthError("AGENT_HTTPS_REQUIRED", 403, "Host Agent 只允许通过 HTTPS 连接。 ");
}

export function hostingAgentHttpError(error: unknown) {
  if (!(error instanceof HostingAgentCryptoError)) return error;
  const status = error.code === "AGENT_SIGNATURE_INVALID" || error.code === "AGENT_KEY_INVALID" ? 403 : error.code === "AGENT_PROOF_EXPIRED" ? 409 : 400;
  return new AccountAuthError(error.code, status, error.message);
}

export function agentString(input: Record<string, unknown>, field: string, minimum = 1, maximum = 500) {
  const value = typeof input[field] === "string" ? input[field].trim() : "";
  if (value.length < minimum || value.length > maximum) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, `${field} 字段无效。 `);
  return value;
}

export function agentInteger(input: Record<string, unknown>, field: string, minimum: number, maximum: number) {
  const value = input[field];
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, `${field} 字段无效。 `);
  return Number(value);
}

export function agentDigest(input: Record<string, unknown>, field: string) {
  const value = agentString(input, field, 71, 71).toLowerCase();
  if (!DIGEST.test(value)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, `${field} 必须是 SHA-256 摘要。 `);
  return value;
}

export function agentVersionAtLeast(current: string, minimum: string) {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(value);
    if (!match) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "agentVersion 必须是语义化版本。 ");
    return match.slice(1, 4).map(Number);
  };
  const left = parse(current);
  const right = parse(minimum);
  return left[0] > right[0] || left[0] === right[0] && (left[1] > right[1] || left[1] === right[1] && left[2] >= right[2]);
}

export function parseHostingDeviceInventory(value: unknown): HostingDeviceInventory {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "inventory 必须是对象。 ");
  const input = value as Record<string, unknown>;
  const gpuModel = agentString(input, "gpuModel", 8, 16) as HostingDeviceInventory["gpuModel"];
  if (!HOSTING_GPU_MODELS.includes(gpuModel)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "首期只接受 RTX 4090 与 H100 80GB。 ");
  const publicHost = agentString(input, "publicHost", 3, 253).toLowerCase();
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:]+\])$/u.test(publicHost)) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "publicHost 必须是公网 IP 或域名，不能包含协议和路径。 ");
  const sshPortStart = agentInteger(input, "sshPortStart", 1024, 65535);
  const sshPortEnd = agentInteger(input, "sshPortEnd", sshPortStart, 65535);
  if (sshPortEnd - sshPortStart > 199) throw new AccountAuthError("AGENT_FIELD_INVALID", 400, "单台设备最多声明 200 个受控端口。 ");
  return {
    hostnameDigest: agentDigest(input, "hostnameDigest"),
    gpuModel,
    gpuUuidDigest: agentDigest(input, "gpuUuidDigest"),
    gpuMemoryMiB: agentInteger(input, "gpuMemoryMiB", gpuModel === "RTX_4090" ? 20_000 : 70_000, gpuModel === "RTX_4090" ? 30_000 : 100_000),
    driverVersion: agentString(input, "driverVersion", 3, 40),
    cudaVersion: agentString(input, "cudaVersion", 3, 40),
    cpuModel: agentString(input, "cpuModel", 2, 200),
    memoryMiB: agentInteger(input, "memoryMiB", 8_192, 4_194_304),
    storageGiB: agentInteger(input, "storageGiB", 40, 1_048_576),
    publicHost,
    sshPortStart,
    sshPortEnd,
  };
}

export function parseAgentProof(input: Record<string, unknown>, now = new Date()) {
  const issuedAt = hostingAgentTimestamp(input.issuedAt, "issuedAt");
  const expiresAt = hostingAgentTimestamp(input.expiresAt, "expiresAt");
  assertHostingAgentWindow(issuedAt, expiresAt, now);
  return { issuedAt, expiresAt, signature: agentString(input, "signature", 86, 86) };
}

export async function verifyExistingDeviceProof(device: HostingDevice, operation: string, fields: Record<string, unknown>, proof: ReturnType<typeof parseAgentProof>) {
  await verifyHostingAgentSignature(device.devicePublicKey, { operation, deviceId: device.id, ...fields, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt }, proof.signature);
}
