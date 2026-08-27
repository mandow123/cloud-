import { AccountAuthError, accountAuthDigest, assertAccountAuthSameOrigin, type AccountSessionContext } from "./account-auth.ts";
import { readJsonBody, requireIdempotencyKey } from "./api-guard.ts";
import { requireTradingAccountSession } from "./entity-ownership.ts";
import type { ManagedGpuCurrency, ManagedGpuFulfillmentChoice } from "../managed-gpu.ts";
import { requireManagedGpuOrganization } from "./managed-gpu-feature.ts";

export function managedGpuObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "提交内容必须是对象。");
  return value as Record<string, unknown>;
}
export function managedGpuString(input: Record<string, unknown>, field: string, minimum = 1, maximum = 200) {
  const value = typeof input[field] === "string" ? input[field].trim() : "";
  if (value.length < minimum || value.length > maximum) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, `${field} 长度应为 ${minimum}–${maximum} 个字符。`);
  return value;
}
export function managedGpuInteger(input: Record<string, unknown>, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const value = input[field];
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, `${field} 必须是 ${minimum}–${maximum} 的整数。`);
  return Number(value);
}
export function managedGpuCurrency(input: Record<string, unknown>, field: string): ManagedGpuCurrency {
  const value = managedGpuString(input, field, 3, 3);
  if (!["CNY", "USD", "HKD", "SGD"].includes(value)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, `${field} 暂不支持。`);
  return value as ManagedGpuCurrency;
}
export function managedGpuCountry(value: unknown, field: string) {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/u.test(country)) throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, `${field} 必须是两位国家代码。`);
  return country;
}
export function managedGpuChoice(input: Record<string, unknown>): ManagedGpuFulfillmentChoice {
  const value = managedGpuString(input, "fulfillmentChoice", 14, 20);
  if (value !== "BEIDOU_HOSTING" && value !== "GLOBAL_SHIPPING") throw new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, "履约方式无效。");
  return value;
}
export function managedGpuRejectFields(input: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) if (field in input) throw new AccountAuthError("MANAGED_GPU_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端计算。`);
}
export async function managedGpuMemberMutation(request: Request, input: Record<string, unknown>) {
  assertAccountAuthSameOrigin(request);
  const account = await requireTradingAccountSession(request);
  if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。");
  requireManagedGpuOrganization(account.activeOrganization.id);
  return {
    account,
    context: {
      organizationId: account.activeOrganization.id,
      accountId: account.account.id,
      idempotencyKey: requireIdempotencyKey(request),
      payloadHash: await accountAuthDigest(JSON.stringify(input)),
      now: new Date().toISOString(),
    },
  };
}
export async function managedGpuMemberRead(request: Request): Promise<AccountSessionContext> {
  const account = await requireTradingAccountSession(request);
  if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。");
  requireManagedGpuOrganization(account.activeOrganization.id);
  return account;
}
export async function managedGpuReadBody(request: Request) { return managedGpuObject(await readJsonBody(request)); }
