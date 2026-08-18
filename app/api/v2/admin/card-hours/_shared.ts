import type { AdminPermission } from "@/lib/admin-auth-types";
import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { mutationHash, prepareWrite, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";

export async function cardHourAdminWrite(request: Request, permissions: readonly AdminPermission[]) {
  assertAccountAuthSameOrigin(request);
  const admin = await requireAdminPermission(request, permissions);
  const authorization = await authorizeMarketplaceRequest(request);
  prepareWrite(request, authorization.actor);
  await persistMarketplaceSession(authorization);
  const value = await readJsonBody(request);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError("CARD_HOUR_ADMIN_INPUT_INVALID", 400, "提交内容必须是对象。 ");
  const body = value as Record<string, unknown>;
  return {
    admin,
    body,
    idempotencyKey: requireIdempotencyKey(request),
    payloadHash: await mutationHash(body),
    now: new Date().toISOString(),
  };
}

export function requiredText(body: Record<string, unknown>, field: string, minimum: number, maximum: number) {
  const value = typeof body[field] === "string" ? body[field].trim() : "";
  if (value.length < minimum || value.length > maximum) throw new AccountAuthError("CARD_HOUR_ADMIN_INPUT_INVALID", 400, `${field} 长度必须为 ${minimum}–${maximum} 个字符。 `);
  return value;
}
