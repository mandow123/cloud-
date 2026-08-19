import { resolveAccountSession } from "./account-auth.ts";
import type { ActivityIdentity } from "../activity-types.ts";

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveActivityIdentity(request: Request): Promise<ActivityIdentity | null> {
  const account = await resolveAccountSession(request).catch(() => null);
  if (account) return { id: account.account.id, displayName: account.account.displayName, email: account.account.primaryEmail, source: "account" };
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
  if (parsed.origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new ActivityHttpError("ACTIVITY_ORIGIN_REJECTED", 403, "跨站请求已拒绝。 ");
  }
}

export function activityErrorResponse(error: unknown) {
  const status = error instanceof ActivityHttpError ? error.status : 500;
  const code = error instanceof ActivityHttpError ? error.code : "ACTIVITY_INTERNAL_ERROR";
  const message = error instanceof ActivityHttpError ? error.message : "活动服务暂时不可用。";
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
