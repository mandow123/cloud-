import { AccountAuthError } from "./account-auth.ts";

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function constantTimeTokenEqual(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function boundedHeader(request: Request, name: string, pattern: RegExp) {
  const value = request.headers.get(name)?.trim() ?? "";
  if (!pattern.test(value)) throw new AccountAuthError("MOBILE_SERVICE_PRINCIPAL_INVALID", 403, "移动服务身份无效。");
  return value;
}

export async function requireMobileInternalPrincipal(request: Request) {
  const expected = process.env.KAI_MOBILE_CLOUD_SERVICE_TOKEN?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (expected.length < 32 || expected.length > 4096 || /\s/u.test(expected)) throw new AccountAuthError("MOBILE_SERVICE_NOT_CONFIGURED", 503, "移动服务尚未配置。");
  if (supplied.length < 32 || supplied.length > 4096 || !(await constantTimeTokenEqual(supplied, expected))) throw new AccountAuthError("MOBILE_SERVICE_FORBIDDEN", 403, "移动服务凭据无效。");
  return {
    subject: boundedHeader(request, "x-kai-mobile-subject", /^[A-Za-z0-9@._:+/-]{3,200}$/u),
    organizationId: boundedHeader(request, "x-kai-organization-id", /^[A-Za-z0-9_.:-]{4,160}$/u),
  } as const;
}
