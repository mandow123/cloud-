import { AccountAuthError, createAccountSession, type IssuedAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

export const KAI_IDENTITY_ISSUER = "https://account.kai.com/connect";
export const KAI_IDENTITY_DISCOVERY = `${KAI_IDENTITY_ISSUER}/.well-known/openid-configuration`;
export const KAI_IDENTITY_SCOPES = "openid kai:name email";
const TRANSACTION_MAX_AGE_SECONDS = 10 * 60;
const SECURE_TRANSACTION_COOKIE = "__Host-kai_oidc_transaction";
const DEVELOPMENT_TRANSACTION_COOKIE = "kai_oidc_transaction_dev";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;
type OidcTransaction = Readonly<{
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  createdAt: number;
}>;

type OidcMetadata = Readonly<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string;
}>;

export type KaiIdentityStart = Readonly<{ location: string; transactionCookie: string }>;
export type KaiIdentityCompletion = Readonly<{ issued: IssuedAccountSession; returnTo: string; clearTransactionCookie: string }>;

function environment(): Environment {
  return typeof process === "undefined" ? {} : process.env;
}

function base64UrlEncode(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new AccountAuthError("OIDC_RESPONSE_INVALID", 401, "统一登录响应无效，请重新登录。");
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function randomBase64Url(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function safeReturnTo(value: string | null | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/member";
}

function secureRequest(request: Request) {
  if (new URL(request.url).protocol === "https:") return true;
  return environment().KAI_TRUST_PROXY === "1" && request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

function cookieValue(request: Request, name: string) {
  for (const item of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}

function transactionCookie(request: Request, value: string, maxAgeSeconds: number) {
  const secure = secureRequest(request);
  const name = secure ? SECURE_TRANSACTION_COOKIE : DEVELOPMENT_TRANSACTION_COOKIE;
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/api/auth/kai",
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

export function clearKaiIdentityTransactionCookie(request: Request) {
  return transactionCookie(request, "", 0);
}

function oidcConfiguration(env: Environment) {
  const clientId = env.KAI_ACCOUNT_OIDC_CLIENT_ID?.trim();
  const secret = env.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim();
  const publicOrigin = env.KAI_PUBLIC_ORIGIN?.trim();
  if (!clientId || !/^kaic_[A-Za-z0-9_-]{8,200}$/u.test(clientId)) {
    throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "KAI 统一账户尚未完成应用登记。");
  }
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
    throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "KAI 统一账户事务密钥尚未配置。");
  }
  let origin: string;
  try { origin = new URL(publicOrigin || "").origin; } catch { throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "网站公开地址尚未配置。"); }
  if (!origin.startsWith("https://") && env.NODE_ENV === "production") {
    throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "生产统一登录必须使用 HTTPS。");
  }
  return { clientId, secret, redirectUri: `${origin}/api/auth/kai/callback` };
}

async function transactionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealTransaction(transaction: OidcTransaction, secret: string) {
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await transactionKey(secret), new TextEncoder().encode(JSON.stringify(transaction))));
  const sealed = new Uint8Array(iv.length + ciphertext.length); sealed.set(iv); sealed.set(ciphertext, iv.length);
  return base64UrlEncode(sealed);
}

async function openTransaction(value: string, secret: string, now: Date): Promise<OidcTransaction> {
  try {
    const sealed = base64UrlDecode(value);
    if (sealed.byteLength < 29) throw new Error("short");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12) }, await transactionKey(secret), sealed.slice(12));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<OidcTransaction>;
    if (typeof parsed.state !== "string" || typeof parsed.nonce !== "string" || typeof parsed.verifier !== "string" || typeof parsed.returnTo !== "string" || typeof parsed.createdAt !== "number") throw new Error("shape");
    if (parsed.createdAt > now.getTime() + 30_000 || parsed.createdAt <= now.getTime() - TRANSACTION_MAX_AGE_SECONDS * 1_000) throw new Error("expired");
    return parsed as OidcTransaction;
  } catch {
    throw new AccountAuthError("OIDC_TRANSACTION_INVALID", 401, "登录事务已失效，请重新登录。");
  }
}

function asJsonObject(value: unknown, code = "OIDC_RESPONSE_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountAuthError(code, 401, "统一登录响应无效，请重新登录。");
  return value as JsonObject;
}

async function fetchJson(fetcher: typeof fetch, url: string, init: RequestInit | undefined, code: string) {
  let response: Response;
  try { response = await fetcher(url, init); } catch { throw new AccountAuthError("KAI_IDENTITY_UNAVAILABLE", 503, "KAI 统一账户暂时无法连接。"); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new AccountAuthError(code, 401, "统一登录未完成，请重新登录。");
  return asJsonObject(payload, code);
}

async function readMetadata(fetcher: typeof fetch): Promise<OidcMetadata> {
  const payload = await fetchJson(fetcher, KAI_IDENTITY_DISCOVERY, { cache: "no-store", headers: { accept: "application/json" } }, "OIDC_DISCOVERY_INVALID");
  const expected: OidcMetadata = {
    issuer: KAI_IDENTITY_ISSUER,
    authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
    token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
    jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
  };
  for (const [key, value] of Object.entries(expected)) if (payload[key] !== value) throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。");
  return expected;
}

function parseJwt(value: unknown) {
  if (typeof value !== "string") throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌无效。");
  const parts = value.split(".");
  if (parts.length !== 3) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌无效。");
  try {
    return {
      header: asJsonObject(JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))), "OIDC_ID_TOKEN_INVALID"),
      claims: asJsonObject(JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))), "OIDC_ID_TOKEN_INVALID"),
      signingInput: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      signature: base64UrlDecode(parts[2]),
    };
  } catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌无效。");
  }
}

async function validateIdToken(value: unknown, input: { metadata: OidcMetadata; clientId: string; nonce: string; now: Date; fetcher: typeof fetch }) {
  const token = parseJwt(value);
  if (token.header.alg !== "ES256" || typeof token.header.kid !== "string") throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌算法无效。");
  const jwks = await fetchJson(input.fetcher, input.metadata.jwks_uri, { cache: "no-store", headers: { accept: "application/json" } }, "OIDC_JWKS_INVALID");
  if (!Array.isArray(jwks.keys)) throw new AccountAuthError("OIDC_JWKS_INVALID", 503, "统一登录签名密钥无效。");
  const jwk = jwks.keys.find((candidate) => candidate && typeof candidate === "object" && (candidate as JsonObject).kid === token.header.kid) as JsonWebKey | undefined;
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") throw new AccountAuthError("OIDC_JWKS_INVALID", 503, "统一登录签名密钥无效。");
  let verified = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, token.signature, token.signingInput);
  } catch { verified = false; }
  if (!verified) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌签名无效。");
  const claims = token.claims;
  const audience = claims.aud;
  const audienceValid = audience === input.clientId || (Array.isArray(audience) && audience.length === 1 && audience[0] === input.clientId);
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  if (claims.iss !== KAI_IDENTITY_ISSUER || !audienceValid || claims.nonce !== input.nonce || typeof claims.sub !== "string" || !claims.sub) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌校验失败。");
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds - 30 || claims.exp > nowSeconds + 10 * 60 || typeof claims.iat !== "number" || claims.iat > nowSeconds + 30) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌已过期或时间无效。");
  return claims;
}

export async function beginKaiIdentityLogin(request: Request, options: { env?: Environment; fetcher?: typeof fetch; now?: Date } = {}): Promise<KaiIdentityStart> {
  const env = options.env ?? environment();
  const config = oidcConfiguration(env);
  const metadata = await readMetadata(options.fetcher ?? fetch);
  const verifier = randomBase64Url(32);
  const challenge = base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const transaction: OidcTransaction = {
    state: randomBase64Url(32), nonce: randomBase64Url(32), verifier,
    returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
    createdAt: (options.now ?? new Date()).getTime(),
  };
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: KAI_IDENTITY_SCOPES,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { location: authorization.toString(), transactionCookie: transactionCookie(request, await sealTransaction(transaction, config.secret), TRANSACTION_MAX_AGE_SECONDS) };
}

export async function completeKaiIdentityLogin(request: Request, options: { env?: Environment; fetcher?: typeof fetch; store?: AccountAuthStore; now?: Date } = {}): Promise<KaiIdentityCompletion> {
  const env = options.env ?? environment();
  const config = oidcConfiguration(env);
  const now = options.now ?? new Date();
  const cookieName = secureRequest(request) ? SECURE_TRANSACTION_COOKIE : DEVELOPMENT_TRANSACTION_COOKIE;
  const sealed = cookieValue(request, cookieName);
  if (!sealed) throw new AccountAuthError("OIDC_TRANSACTION_INVALID", 401, "登录事务不存在，请重新登录。");
  const transaction = await openTransaction(sealed, config.secret, now);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state || state !== transaction.state) throw new AccountAuthError("OIDC_STATE_INVALID", 401, "登录状态校验失败，请重新登录。");
  if (url.searchParams.has("error")) throw new AccountAuthError("OIDC_AUTHORIZATION_DENIED", 401, "登录或授权未完成。");
  if (url.searchParams.get("iss") && url.searchParams.get("iss") !== KAI_IDENTITY_ISSUER) throw new AccountAuthError("OIDC_ISSUER_INVALID", 401, "登录签发方校验失败。");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) throw new AccountAuthError("OIDC_RESPONSE_INVALID", 401, "统一登录响应无效，请重新登录。");
  const fetcher = options.fetcher ?? fetch;
  const metadata = await readMetadata(fetcher);
  const tokenPayload = await fetchJson(fetcher, metadata.token_endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, redirect_uri: config.redirectUri, code, code_verifier: transaction.verifier }),
  }, "OIDC_TOKEN_EXCHANGE_FAILED");
  const claims = await validateIdToken(tokenPayload.id_token, { metadata, clientId: config.clientId, nonce: transaction.nonce, now, fetcher });
  if (typeof tokenPayload.access_token !== "string" || !tokenPayload.access_token) throw new AccountAuthError("OIDC_TOKEN_EXCHANGE_FAILED", 401, "统一登录令牌无效。");
  const userinfo = await fetchJson(fetcher, metadata.userinfo_endpoint, { headers: { accept: "application/json", authorization: `Bearer ${tokenPayload.access_token}` }, cache: "no-store" }, "OIDC_USERINFO_INVALID");
  if (userinfo.sub !== claims.sub || userinfo.email_verified !== true || typeof userinfo.email !== "string" || !userinfo.email.includes("@")) throw new AccountAuthError("OIDC_USERINFO_INVALID", 401, "统一账户没有可用的已验证邮箱。");
  const store = options.store ?? await getAccountAuthStore();
  const identity = await store.resolveOrCreateKaiIdentity({
    issuer: KAI_IDENTITY_ISSUER,
    subject: String(claims.sub),
    displayName: typeof userinfo.name === "string" && userinfo.name.trim() ? userinfo.name.trim().slice(0, 120) : userinfo.email.split("@")[0].slice(0, 120),
    verifiedEmail: userinfo.email.trim().toLowerCase(),
    verifiedAt: now.toISOString(),
  });
  const issued = await createAccountSession(request, identity, "KAI_IDENTITY_OIDC", { store, now });
  return { issued, returnTo: transaction.returnTo, clearTransactionCookie: clearKaiIdentityTransactionCookie(request) };
}
