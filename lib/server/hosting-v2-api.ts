import { AccountAuthError, assertAccountAuthSameOrigin } from "./account-auth.ts";
import { mutationHash, prepareWrite, requireIdempotencyKey } from "./api-guard.ts";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "./marketplace-auth.ts";
import type { HostingMutationContext } from "./hosting-v2-store.ts";
import type { HostingContract } from "../hosting-v2.ts";

export { requireHostingV2Enabled, requireHostingV2SetupEnabled } from "./hosting-v2-feature.ts";

export function hostingObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "提交内容必须是对象。 ");
  return value as Record<string, unknown>;
}

export function hostingString(input: Record<string, unknown>, field: string, minimum = 1, maximum = 500) {
  const value = typeof input[field] === "string" ? input[field].trim() : "";
  if (value.length < minimum || value.length > maximum) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, `${field} 长度应为 ${minimum}–${maximum} 个字符。 `);
  return value;
}

export function hostingInteger(input: Record<string, unknown>, field: string, minimum = 0) {
  const value = input[field];
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, `${field} 必须是大于等于 ${minimum} 的整数。 `);
  return Number(value);
}

export function hostingBoolean(input: Record<string, unknown>, field: string) {
  if (typeof input[field] !== "boolean") throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, `${field} 必须是布尔值。 `);
  return input[field];
}

export function hostingContractClientView(contract: HostingContract) {
  return {
    id: contract.id,
    offerId: contract.offerId,
    snapshot: contract.snapshot,
    reservedSeconds: contract.reservedSeconds,
    measuredSeconds: contract.measuredSeconds,
    heldMicros: contract.heldMicros,
    settledMicros: contract.settledMicros,
    status: contract.status,
    sshPublicKeyFingerprint: contract.sshPublicKeyFingerprint,
    endpointDisplay: contract.endpointDisplay,
    startedAt: contract.startedAt,
    stoppedAt: contract.stoppedAt,
    acceptedAt: contract.acceptedAt,
    version: contract.version,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

export function hostingSupplierContractClientView(contract: HostingContract) {
  return {
    id: contract.id,
    offerId: contract.offerId,
    deviceId: contract.deviceId,
    snapshot: contract.snapshot,
    reservedSeconds: contract.reservedSeconds,
    measuredSeconds: contract.measuredSeconds,
    heldMicros: contract.heldMicros,
    settledMicros: contract.settledMicros,
    supplierIncomeMicros: contract.supplierIncomeMicros,
    commissionMicros: contract.commissionMicros,
    status: contract.status,
    sshPublicKeyFingerprint: contract.sshPublicKeyFingerprint,
    endpointDisplay: contract.endpointDisplay,
    startedAt: contract.startedAt,
    stoppedAt: contract.stoppedAt,
    acceptedAt: contract.acceptedAt,
    version: contract.version,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}

export function hostingSupplierOfferClientView(offer: import("../hosting-v2.ts").HostingOffer) {
  return {
    id: offer.id,
    deviceId: offer.deviceId,
    title: offer.title,
    gpuModel: offer.gpuModel,
    region: offer.region,
    cardHourMicrosPerGpuHour: offer.cardHourMicrosPerGpuHour,
    minRentalSeconds: offer.minRentalSeconds,
    maxRentalSeconds: offer.maxRentalSeconds,
    availableFrom: offer.availableFrom,
    availableUntil: offer.availableUntil,
    approvedImage: offer.approvedImage,
    termsVersion: offer.termsVersion,
    status: offer.status,
    version: offer.version,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

export async function hostingMutationContext(request: Request, actorId: string, body: unknown): Promise<HostingMutationContext> {
  assertAccountAuthSameOrigin(request);
  const authorization = await authorizeMarketplaceRequest(request);
  prepareWrite(request, authorization.actor);
  await persistMarketplaceSession(authorization);
  return {
    actorId,
    idempotencyKey: requireIdempotencyKey(request),
    payloadHash: await mutationHash(body),
    now: new Date().toISOString(),
  };
}
