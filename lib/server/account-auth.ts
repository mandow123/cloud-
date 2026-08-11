import type { AdminAuthMethod, Membership, Organization, UserAccount } from "../admin-auth-types.ts";
import { getAccountAuthStore, type AccountAuthStore, type ResolvedIdentity } from "./account-auth-store.ts";

export const ACCOUNT_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1_000;
export const ACCOUNT_SESSION_IDLE_MS = 30 * 60 * 1_000;
const SECURE_COOKIE = "__Host-kai_admin_session";
const DEVELOPMENT_COOKIE = "kai_admin_session_dev";

export class AccountAuthError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503;
  constructor(
    code: string,
    status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    message: string,
  ) { super(message); this.name = "AccountAuthError"; this.code = code; this.status = status; }
}

export type AccountSessionContext = Readonly<{
  account: UserAccount;
  activeOrganization: Organization;
  membership: Membership;
  sessionId: string;
  authMethod: AdminAuthMethod;
}>;

export type IssuedAccountSession = Readonly<{
  context: AccountSessionContext;
  token: string;
  cookie: string;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
}>;

function randomToken(bytesLength = 32) {
  const bytes = new Uint8Array(bytesLength); crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function accountAuthDigest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string) {
  for (const item of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = item.indexOf("="); if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}

function secureRequest(request: Request) {
  if (new URL(request.url).protocol === "https:") return true;
  if (typeof process === "undefined" || process.env.KAI_TRUST_PROXY !== "1") return false;
  if (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https") return true;
  try { return new URL(process.env.KAI_PUBLIC_ORIGIN || "").protocol === "https:"; } catch { return false; }
}

function sessionCookie(request: Request, token: string, maxAgeSeconds: number) {
  const secure = secureRequest(request);
  return [
    `${secure ? SECURE_COOKIE : DEVELOPMENT_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/", `Max-Age=${Math.max(0, maxAgeSeconds)}`, "HttpOnly", "SameSite=Strict", secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

export function clearAccountSessionCookie(request: Request) { return sessionCookie(request, "", 0); }

export function assertAccountAuthSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new AccountAuthError("AUTH_ORIGIN_REJECTED", 403, "认证请求来源无效。 ");
  let parsed: URL; try { parsed = new URL(origin); } catch { throw new AccountAuthError("AUTH_ORIGIN_REJECTED", 403, "认证请求来源无效。 "); }
  const publicOrigin = typeof process === "undefined" ? undefined : process.env.KAI_PUBLIC_ORIGIN;
  const expected = publicOrigin ? new URL(publicOrigin).origin : new URL(request.url).origin;
  if (parsed.origin !== expected || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") throw new AccountAuthError("AUTH_ORIGIN_REJECTED", 403, "认证请求来源无效。 ");
}

export function readAccountSessionToken(request: Request) {
  const name = secureRequest(request) ? SECURE_COOKIE : DEVELOPMENT_COOKIE;
  const token = cookieValue(request, name);
  return token && /^[a-f0-9]{64}$/u.test(token) ? token : null;
}

function sessionContext(identity: ResolvedIdentity, sessionId: string, authMethod: AdminAuthMethod): AccountSessionContext {
  return { account: identity.account, activeOrganization: identity.organization, membership: identity.membership, sessionId, authMethod };
}

export async function createAccountSession(
  request: Request,
  identity: ResolvedIdentity,
  authMethod: AdminAuthMethod,
  options: { store?: AccountAuthStore; now?: Date } = {},
): Promise<IssuedAccountSession> {
  if (identity.account.status !== "ACTIVE" || identity.organization.status !== "ACTIVE") {
    throw new AccountAuthError("ACCOUNT_ACCESS_FORBIDDEN", 403, "账户或组织当前不可登录。 ");
  }
  const store = options.store ?? await getAccountAuthStore();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const absolute = new Date(now.getTime() + ACCOUNT_SESSION_ABSOLUTE_MS);
  const idle = new Date(now.getTime() + ACCOUNT_SESSION_IDLE_MS);
  const token = randomToken();
  const session = await store.createSession({
    tokenHash: await accountAuthDigest(token), accountId: identity.account.id, organizationId: identity.organization.id,
    authMethod, now: nowIso, idleExpiresAt: idle.toISOString(), absoluteExpiresAt: absolute.toISOString(),
  });
  await store.recordAudit({ accountId: identity.account.id, organizationId: identity.organization.id, sessionId: session.id, eventType: "LOGIN_SUCCEEDED", outcome: "ALLOWED", metadata: { authMethod }, occurredAt: nowIso });
  return { context: sessionContext(identity, session.id, authMethod), token, cookie: sessionCookie(request, token, ACCOUNT_SESSION_ABSOLUTE_MS / 1_000), absoluteExpiresAt: absolute.toISOString(), idleExpiresAt: idle.toISOString() };
}

export async function resolveAccountSession(
  request: Request,
  options: { store?: AccountAuthStore; now?: Date; touch?: boolean } = {},
): Promise<AccountSessionContext | null> {
  const token = readAccountSessionToken(request); if (!token) return null;
  const store = options.store ?? await getAccountAuthStore();
  const resolved = await store.resolveSession(await accountAuthDigest(token)); if (!resolved) return null;
  const now = options.now ?? new Date(); const nowMs = now.getTime();
  if (Date.parse(resolved.session.idleExpiresAt) <= nowMs || Date.parse(resolved.session.absoluteExpiresAt) <= nowMs) return null;
  if (resolved.account.status !== "ACTIVE" || resolved.organization.status !== "ACTIVE") {
    throw new AccountAuthError("ACCOUNT_ACCESS_FORBIDDEN", 403, "账户或组织已停用。 ");
  }
  if (options.touch !== false) {
    const absoluteMs = Date.parse(resolved.session.absoluteExpiresAt);
    const nextIdleMs = Math.min(nowMs + ACCOUNT_SESSION_IDLE_MS, absoluteMs - 1);
    if (nextIdleMs <= nowMs || !await store.touchSession(resolved.session.id, now.toISOString(), new Date(nextIdleMs).toISOString())) return null;
  }
  return { account: resolved.account, activeOrganization: resolved.organization, membership: resolved.membership, sessionId: resolved.session.id, authMethod: resolved.session.authMethod };
}

export async function requireAccountSession(request: Request, options: { store?: AccountAuthStore; now?: Date } = {}) {
  const context = await resolveAccountSession(request, options);
  if (!context) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
  return context;
}

export async function logoutAccountSession(request: Request, options: { store?: AccountAuthStore; now?: Date } = {}) {
  const store = options.store ?? await getAccountAuthStore();
  const context = await resolveAccountSession(request, { ...options, store, touch: false });
  if (context) {
    const now = (options.now ?? new Date()).toISOString();
    await store.revokeSession(context.sessionId, now);
    await store.recordAudit({ accountId: context.account.id, organizationId: context.activeOrganization.id, sessionId: context.sessionId, eventType: "LOGOUT", outcome: "ALLOWED", occurredAt: now });
  }
  return clearAccountSessionCookie(request);
}

export async function switchAccountOrganization(request: Request, organizationId: string, options: { store?: AccountAuthStore; now?: Date } = {}) {
  const store = options.store ?? await getAccountAuthStore();
  const current = await requireAccountSession(request, { ...options, store });
  const selected = await store.getMembership(current.account.id, organizationId);
  if (!selected || selected.status !== "ACTIVE" || selected.organization.status !== "ACTIVE") {
    throw new AccountAuthError("ORGANIZATION_ACCESS_FORBIDDEN", 403, "当前账户不能切换到该组织。 ");
  }
  const identity: ResolvedIdentity = { account: current.account, organization: selected.organization, membership: selected };
  const issued = await createAccountSession(request, identity, current.authMethod, { ...options, store });
  await store.revokeSession(current.sessionId, (options.now ?? new Date()).toISOString());
  return issued;
}

export function accountAuthErrorResponse(error: unknown) {
  const status = error instanceof AccountAuthError ? error.status : 500;
  const code = error instanceof AccountAuthError ? error.code : "ACCOUNT_AUTH_INTERNAL_ERROR";
  const message = error instanceof AccountAuthError ? error.message : "认证服务暂时不可用。";
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
}

export function accountAuthJson(value: unknown, status = 200, headers?: HeadersInit) {
  const finalHeaders = new Headers(headers); finalHeaders.set("cache-control", "no-store"); finalHeaders.set("content-type", "application/json; charset=utf-8"); finalHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers: finalHeaders });
}
