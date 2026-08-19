import { resolveAccountSession } from "./account-auth.ts";
import type { ActivityIdentity } from "../activity-types.ts";
import { requireAdminPermission } from "./admin-auth.ts";
import { activitySecurityEnvironment, type ActivitySecurityEnv } from "./activity-env.ts";

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function configuredAdminEmails(value: string | undefined) {
  return new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(item)));
}

export async function resolveActivityIdentity(request: Request, envOverride?: ActivitySecurityEnv): Promise<ActivityIdentity | null> {
  const account = await resolveAccountSession(request);
  if (account) return { id: account.account.id, displayName: account.account.displayName, email: account.account.primaryEmail, source: "account" };
  const env = await activitySecurityEnvironment(envOverride);
  // These headers are authentication assertions only when an operator has
  // explicitly confirmed that the front proxy strips client-supplied copies.
  // Direct/self-hosted origins therefore fail closed by default.
  if (env.KAI_TRUST_OPENAI_IDENTITY_HEADERS !== "1") return null;
  const userId = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!userId || !email) return null;
  let displayName = email;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { displayName = decodeURIComponent(encodedName); } catch { displayName = email; }
  }
  return { id: `oai_${(await digest(userId)).slice(0, 40)}`, displayName, email, source: "chatgpt" };
}

export async function requireActivityAdminAccess(request: Request, access: "READ" | "MODERATE", envOverride?: ActivitySecurityEnv) {
  const env = await activitySecurityEnvironment(envOverride);
  if (env.KAI_TRUST_OPENAI_IDENTITY_HEADERS === "1") {
    const identity = await resolveActivityIdentity(request, env);
    if (identity?.source === "chatgpt" && configuredAdminEmails(env.KAI_ACTIVITY_ADMIN_EMAILS).has(identity.email.toLowerCase())) {
      return { id: identity.id, displayName: identity.displayName, source: "sites-allowlist" as const };
    }
  }
  const root = await requireAdminPermission(request, [access === "READ" ? "ADMIN_PANEL_READ" : "MARKET_PUBLISH"]);
  return { id: root.principal.id, displayName: root.principal.displayName, source: "root-session" as const };
}

export async function requireActivityIdentity(request: Request) {
  const identity = await resolveActivityIdentity(request);
  if (!identity) throw new ActivityHttpError("ACTIVITY_AUTH_REQUIRED", 401, "请先登录后继续。 ");
  return identity;
}

export class ActivityHttpError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); this.name = "ActivityHttpError"; }
}

export function assertActivitySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new ActivityHttpError("ACTIVITY_ORIGIN_REQUIRED", 403, "请求来源无效。 ");
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new ActivityHttpError("ACTIVITY_ORIGIN_INVALID", 403, "请求来源无效。 "); }
  const configuredOrigin = typeof process === "undefined" ? undefined : process.env.KAI_PUBLIC_ORIGIN;
  let expectedOrigin: string;
  try { expectedOrigin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(request.url).origin; }
  catch { throw new ActivityHttpError("ACTIVITY_ORIGIN_CONFIGURATION_INVALID", 500, "活动服务来源配置无效。 "); }
  if (parsed.origin !== expectedOrigin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new ActivityHttpError("ACTIVITY_ORIGIN_REJECTED", 403, "跨站请求已拒绝。 ");
  }
}

export function activityErrorResponse(error: unknown) {
  const status = error instanceof ActivityHttpError ? error.status : 500;
  const code = error instanceof ActivityHttpError ? error.code : "ACTIVITY_INTERNAL_ERROR";
  const message = error instanceof ActivityHttpError ? error.message : "活动服务暂时不可用。";
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
