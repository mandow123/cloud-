import type { AccountSessionContext } from "./account-auth.ts";
import { AccountAuthError } from "./account-auth.ts";
import { mutationHash, requireIdempotencyKey } from "./api-guard.ts";
import { authenticateKaiPublicApiRequest, kaiPublicApiClients, type KaiPublicApiPrincipal, type KaiPublicApiScope } from "./public-api-auth.ts";
import { enforceKaiPublicApiRateLimit } from "./public-api-rate-limit.ts";
import type { HostingDevice } from "../hosting-v2.ts";
import type { KaiPublicDevice, KaiPublicVerification } from "../kai-public-api.ts";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/u;
const HEARTBEAT_STALE_MS = 120_000;

export async function authorizeKaiPublicApi(request: Request, scopes: readonly KaiPublicApiScope[]) {
  const principal = await authenticateKaiPublicApiRequest(request, scopes);
  enforceKaiPublicApiRateLimit(`client:${principal.clientId}`);
  return principal;
}

export function kaiPublicObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError("VALIDATION_ERROR", 400, "请求正文必须是对象。 ");
  return value as Record<string, unknown>;
}

export function kaiPublicExactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new AccountAuthError("VALIDATION_ERROR", 400, "请求包含未支持的字段。 ");
}

export function kaiPublicId(value: unknown, field: string) {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) throw new AccountAuthError("VALIDATION_ERROR", 400, `${field} 格式无效。 `);
  return value;
}

export function kaiPublicString(value: unknown, field: string, minimum = 1, maximum = 120) {
  const result = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (result.length < minimum || result.length > maximum) throw new AccountAuthError("VALIDATION_ERROR", 400, `${field} 长度无效。 `);
  return result;
}

export function assertKaiPublicOrganization(principal: KaiPublicApiPrincipal, organizationReference: string) {
  if (organizationReference !== principal.organizationReference) throw new AccountAuthError("RESOURCE_NOT_FOUND", 404, "资源不存在。 ");
}

export function kaiPublicMutation(request: Request, principal: KaiPublicApiPrincipal, body: unknown) {
  return Promise.resolve(mutationHash(body)).then((payloadHash) => ({
    clientId: principal.clientId,
    organizationId: principal.organizationId,
    organizationReference: principal.organizationReference,
    actorId: `oauth:${principal.clientId}`,
    idempotencyKey: requireIdempotencyKey(request),
    payloadHash,
    now: new Date().toISOString(),
  }));
}

export function kaiPublicAccount(principal: KaiPublicApiPrincipal): AccountSessionContext {
  return {
    account: { id: principal.accountId, displayName: `Public API ${principal.clientId}`, primaryEmail: null, status: "ACTIVE" },
    activeOrganization: { id: principal.organizationId, name: principal.organizationReference, externalKey: principal.organizationReference, status: "ACTIVE" },
    membership: { id: `mbr_${principal.clientId}`, accountId: principal.accountId, organizationId: principal.organizationId, status: "ACTIVE", roles: [] },
    sessionId: `oauth:${principal.clientId}`,
    authMethod: "KAI_IDENTITY_OIDC",
  };
}

export function kaiPublicVerificationView(record: KaiPublicVerification) {
  return { id: record.id, version: record.version, status: record.status, updatedAt: record.updatedAt, failure: record.failure };
}

function heartbeatIsStale(device: HostingDevice, now: Date) {
  const lastSeenAt = device.lastSeenAt ? Date.parse(device.lastSeenAt) : Number.NaN;
  return !Number.isFinite(lastSeenAt) || now.getTime() - lastSeenAt > HEARTBEAT_STALE_MS;
}

export function kaiPublicDeviceView(device: HostingDevice, now = new Date()): KaiPublicDevice {
  let status: KaiPublicDevice["status"];
  if (device.status === "REVOKED") status = "revoked";
  else if (device.status === "OFFLINE" || heartbeatIsStale(device, now)) status = "offline";
  else if (device.status === "VERIFIED" && device.verificationStatus === "PASSED" && device.verifiedUntil && Date.parse(device.verifiedUntil) > now.getTime()) status = "ready";
  else if (device.status === "VERIFYING" || device.verificationStatus === "PENDING") status = "checking";
  else status = "registering";
  return { id: device.id, status, lastHeartbeatAt: device.lastSeenAt, updatedAt: device.updatedAt };
}

export function kaiPublicVerificationState(device: HostingDevice, now = new Date()): { status: KaiPublicVerification["status"]; failure: KaiPublicVerification["failure"] } {
  if (device.status === "REVOKED") return { status: "revoked", failure: null };
  if (device.status === "OFFLINE" || heartbeatIsStale(device, now)) return { status: "failed", failure: { code: "DEVICE_OFFLINE", message: "The verification device is offline." } };
  if (device.verificationStatus === "FAILED") return { status: "failed", failure: { code: "VERIFICATION_FAILED", message: "KAI Cloud verification did not pass." } };
  if (device.verificationStatus === "EXPIRED" || (device.verifiedUntil && Date.parse(device.verifiedUntil) <= now.getTime())) return { status: "failed", failure: { code: "VERIFICATION_EXPIRED", message: "KAI Cloud verification evidence expired." } };
  if (device.status === "VERIFIED" && device.verificationStatus === "PASSED" && device.verifiedUntil && Date.parse(device.verifiedUntil) > now.getTime()) return { status: "passed", failure: null };
  return { status: "running", failure: null };
}

export function kaiPublicClientForOrganization(organizationId: string) {
  return kaiPublicApiClients().filter((client) => client.organizationId === organizationId);
}
