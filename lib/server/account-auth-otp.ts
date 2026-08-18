import type { AdminRole } from "../admin-auth-types.ts";
import { ADMIN_ROLES } from "../admin-auth-types.ts";
import { AccountAuthError, accountAuthDigest, createAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;
declare global { var __kaiLocalOtpInbox: Map<string, string> | undefined; }

function runtimeEnv(): Env { return typeof process === "undefined" ? {} : process.env; }
function inbox() { globalThis.__kaiLocalOtpInbox ??= new Map(); return globalThis.__kaiLocalOtpInbox; }
function nowIso(date: Date) { return date.toISOString(); }

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") throw new AccountAuthError("EMAIL_INVALID", 400, "邮箱格式无效。 ");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new AccountAuthError("EMAIL_INVALID", 400, "邮箱格式无效。 ");
  return email;
}

function localEnabled(env: Env) { return env.NODE_ENV !== "production" && env.KAI_ADMIN_LOCAL_AUTH === "1"; }
function hmacSecret(env: Env) {
  const secret = env.KAI_EMAIL_OTP_HMAC_SECRET?.trim() || (localEnabled(env) ? env.KAI_ADMIN_LOCAL_SECRET?.trim() : "");
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) throw new AccountAuthError("EMAIL_OTP_NOT_CONFIGURED", 503, "邮箱验证码服务未配置。 ");
  return secret;
}

async function otpDigest(secret: string, challengeId: string, email: string, code: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${challengeId}:${email}:${code}`)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false; let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function otpCode() {
  const bytes = new Uint32Array(1);
  const sampleLimit = 0x1_0000_0000 - (0x1_0000_0000 % 1_000_000);
  do { crypto.getRandomValues(bytes); } while (bytes[0]! >= sampleLimit);
  return String(bytes[0]! % 1_000_000).padStart(6, "0");
}

async function sendOtp(email: string, code: string, challengeId: string, expiresAt: string, env: Env, fetcher: Fetcher) {
  const url = env.KAI_EMAIL_OTP_WEBHOOK_URL?.trim();
  const token = env.KAI_EMAIL_OTP_WEBHOOK_TOKEN?.trim();
  if (!url || !token) {
    if (localEnabled(env)) { inbox().set(challengeId, code); return "LOCAL_INBOX" as const; }
    throw new AccountAuthError("EMAIL_OTP_NOT_CONFIGURED", 503, "邮箱发送服务未配置。 ");
  }
  let parsed: URL; try { parsed = new URL(url); } catch { throw new AccountAuthError("EMAIL_OTP_NOT_CONFIGURED", 503, "邮箱发送服务地址无效。 "); }
  if (parsed.protocol !== "https:" && !(localEnabled(env) && parsed.hostname === "localhost")) throw new AccountAuthError("EMAIL_OTP_NOT_CONFIGURED", 503, "邮箱发送服务必须使用 HTTPS。 ");
  const response = await fetcher(parsed, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ template: "KAI_ADMIN_LOGIN_OTP", recipient: email, code, challengeId, expiresAt }) });
  if (!response.ok) throw new AccountAuthError("EMAIL_OTP_DELIVERY_FAILED", 503, "验证码暂时无法发送。 ");
  return "SENT" as const;
}

export async function requestEmailOtp(request: Request, emailValue: unknown, options: { store?: AccountAuthStore; env?: Env; now?: Date; fetcher?: Fetcher } = {}) {
  const env = options.env ?? runtimeEnv(); const store = options.store ?? await getAccountAuthStore(); const now = options.now ?? new Date();
  const email = normalizeEmail(emailValue); const since = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
  if (await store.countRecentOtp(email, since) >= 5) throw new AccountAuthError("EMAIL_OTP_RATE_LIMITED", 429, "验证码请求过于频繁。 ");
  const latest = await store.latestOpenOtp(email);
  if (latest && Date.parse(latest.createdAt) > now.getTime() - 60_000) throw new AccountAuthError("EMAIL_OTP_RATE_LIMITED", 429, "请稍后再请求验证码。 ");
  const challengeId = `otp_${crypto.randomUUID()}`; const code = otpCode(); const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const fingerprint = await accountAuthDigest(`${request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown"}:${request.headers.get("user-agent") ?? "unknown"}`);
  await store.createOtpChallenge({ id: challengeId, normalizedEmail: email, otpDigest: await otpDigest(hmacSecret(env), challengeId, email, code), requestFingerprint: fingerprint, createdAt: nowIso(now), expiresAt });
  const delivery = await sendOtp(email, code, challengeId, expiresAt, env, options.fetcher ?? fetch);
  await store.recordAudit({ eventType: "EMAIL_OTP_REQUESTED", outcome: "ALLOWED", target: await accountAuthDigest(email), metadata: { challengeId, delivery }, occurredAt: nowIso(now) });
  return { challengeId, expiresAt, delivery };
}

export async function verifyEmailOtp(request: Request, input: { challengeId: unknown; email: unknown; code: unknown }, options: { store?: AccountAuthStore; env?: Env; now?: Date } = {}) {
  const env = options.env ?? runtimeEnv(); const store = options.store ?? await getAccountAuthStore(); const now = options.now ?? new Date(); const email = normalizeEmail(input.email);
  if (typeof input.challengeId !== "string" || !/^otp_[0-9a-f-]{36}$/u.test(input.challengeId) || typeof input.code !== "string" || !/^\d{6}$/u.test(input.code)) throw new AccountAuthError("EMAIL_OTP_INVALID", 401, "验证码无效或已过期。 ");
  const challenge = await store.latestOpenOtp(email);
  if (!challenge || challenge.id !== input.challengeId || challenge.attempts >= 5 || Date.parse(challenge.expiresAt) <= now.getTime()) throw new AccountAuthError("EMAIL_OTP_INVALID", 401, "验证码无效或已过期。 ");
  const supplied = await otpDigest(hmacSecret(env), challenge.id, email, input.code);
  if (!constantTimeEqual(supplied, challenge.otpDigest)) { await store.recordOtpFailure(challenge.id); throw new AccountAuthError("EMAIL_OTP_INVALID", 401, "验证码无效或已过期。 "); }
  if (!await store.consumeOtp(challenge.id, nowIso(now))) throw new AccountAuthError("EMAIL_OTP_INVALID", 401, "验证码无效或已使用。 ");
  inbox().delete(challenge.id);
  const emailHash = await accountAuthDigest(email);
  const identity = await store.resolveOrCreateIdentity({ provider: "EMAIL", tenantKey: "EXTERNAL", subject: emailHash, displayName: email.split("@")[0] || "External user", normalizedEmail: email, organizationExternalKey: `EMAIL:${emailHash}`, organizationName: "External account", verifiedAt: nowIso(now) });
  return createAccountSession(request, identity, "EMAIL_OTP", { store, now });
}

export function readLocalOtp(challengeId: string, env: Env = runtimeEnv()) {
  if (!localEnabled(env)) throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 认证不可用。 ");
  const code = inbox().get(challengeId); if (!code) throw new AccountAuthError("EMAIL_OTP_INVALID", 401, "验证码不存在。 ");
  return code;
}

export function assertLocalSecret(request: Request, env: Env = runtimeEnv()) {
  if (!localEnabled(env)) throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 认证不可用。 ");
  const expected = env.KAI_ADMIN_LOCAL_SECRET?.trim() ?? ""; const supplied = request.headers.get("x-kai-local-auth-secret") ?? "";
  if (expected.length < 32 || !constantTimeEqual(expected, supplied)) throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 认证凭据无效。 ");
}

export function assertLocalInteractiveRequest(request: Request, env: Env = runtimeEnv()) {
  if (!localEnabled(env)) throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 认证不可用。 ");
  const url = new URL(request.url);
  const multiRoleHost = env.KAI_ADMIN_LOCAL_MULTI_ROLE_QA === "1" && /^(buyer|supplier|root|finance)\.localhost$/u.test(url.hostname);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && !multiRoleHost) throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 认证仅允许本机访问。 ");
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== url.origin || request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 认证请求来源无效。 ");
  }
}

export function localRoles(env: Env = runtimeEnv()): AdminRole[] {
  const allowed = new Set<string>(ADMIN_ROLES); const values = (env.KAI_ADMIN_LOCAL_ROLES ?? "SUPPORT_READONLY").split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length || values.some((role) => !allowed.has(role))) throw new AccountAuthError("LOCAL_AUTH_FORBIDDEN", 403, "LOCAL 角色配置无效。 ");
  return [...new Set(values)] as AdminRole[];
}
