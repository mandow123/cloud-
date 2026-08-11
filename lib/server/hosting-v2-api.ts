import { AccountAuthError, assertAccountAuthSameOrigin } from "./account-auth.ts";
import { mutationHash, requireIdempotencyKey } from "./api-guard.ts";
import type { HostingMutationContext } from "./hosting-v2-store.ts";

export { requireHostingV2Enabled } from "./hosting-v2-feature.ts";

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

export async function hostingMutationContext(request: Request, actorId: string, body: unknown): Promise<HostingMutationContext> {
  assertAccountAuthSameOrigin(request);
  return {
    actorId,
    idempotencyKey: requireIdempotencyKey(request),
    payloadHash: await mutationHash(body),
    now: new Date().toISOString(),
  };
}
