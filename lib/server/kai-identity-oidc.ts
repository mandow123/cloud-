import { AccountAuthError, createAccountSession, type IssuedAccountSession } from "./account-auth.ts";
import { getAccountAuthStore, type AccountAuthStore } from "./account-auth-store.ts";

export const KAI_IDENTITY_ISSUER = "https://account.kai.com/connect";
export const KAI_IDENTITY_DISCOVERY = `${KAI_IDENTITY_ISSUER}/.well-known/openid-configuration`;
export const KAI_IDENTITY_SCOPES = "openid kai:name email";
export const KAI_IDENTITY_MODERN_ISSUER = "https://auth.kai.com/api/auth";
export const KAI_IDENTITY_MODERN_DISCOVERY = `${KAI_IDENTITY_MODERN_ISSUER}/.well-known/openid-configuration`;
export const KAI_IDENTITY_MODERN_SCOPES = "openid profile email";
const TRANSACTION_MAX_AGE_SECONDS = 10 * 60;
const SECURE_TRANSACTION_COOKIE = "__Host-kai_oidc_transaction";
const DEVELOPMENT_TRANSACTION_COOKIE = "kai_oidc_transaction_dev";
const DISCOVERY_PROBE_CACHE_MS = 30_000;
const OIDC_JSON_TIMEOUT_MS = 4_000;
const OIDC_JSON_MAX_BYTES = 512 * 1024;

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
  id_token_signing_alg_values_supported?: readonly string[];
  token_endpoint_auth_methods_supported?: readonly string[];
}>;

type OidcProviderConfiguration = Readonly<{
  issuer: string;
  discovery: string;
  scopes: string;
  clientSecret?: string;
}>;

export type KaiIdentityStart = Readonly<{ location: string; transactionCookie: string }>;
export type KaiIdentityCompletion = Readonly<{ issued: IssuedAccountSession; returnTo: string; clearTransactionCookie: string }>;
export type KaiIdentityDiscoveryProbe = Readonly<{
  available: boolean;
  probe: "read-only";
  errorCode?: "KAI_IDENTITY_UNAVAILABLE" | "OIDC_DISCOVERY_REDIRECT" | "OIDC_DISCOVERY_INVALID";
}>;

let discoveryProbeCache: Readonly<{
  key: string;
  expiresAt: number;
  result: Promise<KaiIdentityDiscoveryProbe>;
}> | null = null;

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

function secureRequest(request: Request, env: Environment = environment()) {
  if (new URL(request.url).protocol === "https:") return true;
  if (env.KAI_TRUST_PROXY !== "1") return false;
  if (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https") return true;
  try { return new URL(env.KAI_PUBLIC_ORIGIN || "").protocol === "https:"; } catch { return false; }
}

function cookieValue(request: Request, name: string) {
  for (const item of request.headers.get("cookie")?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}

function transactionCookie(request: Request, value: string, maxAgeSeconds: number, env: Environment = environment()) {
  const secure = secureRequest(request, env);
  const name = secure ? SECURE_TRANSACTION_COOKIE : DEVELOPMENT_TRANSACTION_COOKIE;
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

export function clearKaiIdentityTransactionCookie(request: Request, env?: Environment) {
  return transactionCookie(request, "", 0, env);
}

function providerConfiguration(env: Environment): OidcProviderConfiguration {
  const issuer = env.KAI_ACCOUNT_OIDC_ISSUER?.trim() || KAI_IDENTITY_ISSUER;
  if (issuer !== KAI_IDENTITY_ISSUER && issuer !== KAI_IDENTITY_MODERN_ISSUER) {
    throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "KAI 统一账户签发方不在允许列表中。");
  }
  const defaultScopes = issuer === KAI_IDENTITY_MODERN_ISSUER ? KAI_IDENTITY_MODERN_SCOPES : KAI_IDENTITY_SCOPES;
  const scopes = env.KAI_ACCOUNT_OIDC_SCOPES?.trim().replace(/\s+/gu, " ") || defaultScopes;
  const scopeList = scopes.split(" ");
  if (!/^[A-Za-z0-9:._-]+(?: [A-Za-z0-9:._-]+)*$/u.test(scopes)
    || scopeList.length > 12
    || new Set(scopeList).size !== scopeList.length
    || !scopeList.includes("openid")
    || !scopeList.includes("email")) {
    throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "KAI 统一账户授权范围配置无效。");
  }
  const clientSecret = env.KAI_ACCOUNT_OIDC_CLIENT_SECRET?.trim();
  if (clientSecret && (new TextEncoder().encode(clientSecret).byteLength < 16 || new TextEncoder().encode(clientSecret).byteLength > 2048)) {
    throw new AccountAuthError("KAI_IDENTITY_NOT_CONFIGURED", 503, "KAI 统一账户客户端密钥配置无效。");
  }
  return {
    issuer,
    discovery: `${issuer}/.well-known/openid-configuration`,
    scopes,
    ...(clientSecret ? { clientSecret } : {}),
  };
}

function oidcConfiguration(env: Environment) {
  const provider = providerConfiguration(env);
  const clientId = env.KAI_ACCOUNT_OIDC_CLIENT_ID?.trim();
  const secret = env.KAI_ACCOUNT_OIDC_TRANSACTION_SECRET?.trim();
  const publicOrigin = env.KAI_PUBLIC_ORIGIN?.trim();
  if (!clientId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(clientId)) {
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
  return { ...provider, clientId, secret, redirectUri: `${origin}/api/auth/kai/callback` };
}

export function isKaiIdentityConfigured(env: Environment = environment()) {
  try { oidcConfiguration(env); return true; } catch { return false; }
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
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "manual",
      signal: init?.signal ?? AbortSignal.timeout(OIDC_JSON_TIMEOUT_MS),
    });
  } catch { throw new AccountAuthError("KAI_IDENTITY_UNAVAILABLE", 503, "KAI 统一账户暂时无法连接。"); }
  if (!response.ok) throw new AccountAuthError(code, 401, "统一登录未完成，请重新登录。");
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > OIDC_JSON_MAX_BYTES) {
    throw new AccountAuthError(code, 401, "统一登录响应超过大小限制。");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > OIDC_JSON_MAX_BYTES) {
          await reader.cancel("OIDC response too large").catch(() => {});
          throw new AccountAuthError(code, 401, "统一登录响应超过大小限制。");
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw new AccountAuthError("KAI_IDENTITY_UNAVAILABLE", 503, "KAI 统一账户暂时无法连接。");
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AccountAuthError(code, 401, "统一登录响应无效，请重新登录。");
  }
  return asJsonObject(payload, code);
}

function metadataEndpoint(value: unknown, issuer: string) {
  if (typeof value !== "string") throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。");
  let endpoint: URL;
  try { endpoint = new URL(value); } catch { throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。"); }
  const issuerUrl = new URL(issuer);
  if (endpoint.protocol !== "https:" || endpoint.origin !== issuerUrl.origin || endpoint.username || endpoint.password || endpoint.hash) {
    throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。");
  }
  return endpoint.toString();
}

function optionalStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : undefined;
}

function expectedProviderEndpoints(issuer: string) {
  return issuer === KAI_IDENTITY_MODERN_ISSUER
    ? {
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/oauth2/userinfo`,
      }
    : {
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/me`,
      };
}

async function readMetadata(fetcher: typeof fetch, provider: OidcProviderConfiguration, timeoutMs = 4_000): Promise<OidcMetadata> {
  let response: Response;
  try {
    response = await fetcher(provider.discovery, {
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AccountAuthError("KAI_IDENTITY_UNAVAILABLE", 503, "KAI 统一账户暂时无法连接。");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new AccountAuthError("OIDC_DISCOVERY_REDIRECT", 503, "KAI 统一账户发现地址配置异常。");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。");
  }
  const object = payload as JsonObject;
  if (object.issuer !== provider.issuer) throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。");
  const signingAlgorithms = optionalStringArray(object.id_token_signing_alg_values_supported);
  const authenticationMethods = optionalStringArray(object.token_endpoint_auth_methods_supported);
  if ((provider.issuer === KAI_IDENTITY_MODERN_ISSUER && !signingAlgorithms)
    || (signingAlgorithms && !signingAlgorithms.some((algorithm) => algorithm === "ES256" || algorithm === "EdDSA"))) {
    throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户不支持 Cloud 所需的签名算法。");
  }
  const requiredAuthenticationMethod = provider.clientSecret ? "client_secret_basic" : "none";
  if ((provider.issuer === KAI_IDENTITY_MODERN_ISSUER && !authenticationMethods)
    || (authenticationMethods && !authenticationMethods.includes(requiredAuthenticationMethod))) {
    throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户客户端认证方式不匹配。");
  }
  const expectedEndpoints = expectedProviderEndpoints(provider.issuer);
  for (const [field, expected] of Object.entries(expectedEndpoints)) {
    if (metadataEndpoint(object[field], provider.issuer) !== expected) throw new AccountAuthError("OIDC_DISCOVERY_INVALID", 503, "KAI 统一账户元数据校验失败。");
  }
  return {
    issuer: provider.issuer,
    ...expectedEndpoints,
    ...(signingAlgorithms ? { id_token_signing_alg_values_supported: signingAlgorithms } : {}),
    ...(authenticationMethods ? { token_endpoint_auth_methods_supported: authenticationMethods } : {}),
  };
}

export async function probeKaiIdentityDiscovery(options: { env?: Environment; fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<KaiIdentityDiscoveryProbe> {
  let provider: OidcProviderConfiguration;
  try { provider = providerConfiguration(options.env ?? environment()); }
  catch { return { available: false, probe: "read-only", errorCode: "OIDC_DISCOVERY_INVALID" }; }
  const check = async (): Promise<KaiIdentityDiscoveryProbe> => {
    try {
      await readMetadata(options.fetcher ?? fetch, provider, options.timeoutMs ?? 2_500);
      return { available: true, probe: "read-only" };
    } catch (error) {
      const errorCode = error instanceof AccountAuthError && ["KAI_IDENTITY_UNAVAILABLE", "OIDC_DISCOVERY_REDIRECT", "OIDC_DISCOVERY_INVALID"].includes(error.code)
        ? error.code as KaiIdentityDiscoveryProbe["errorCode"]
        : "KAI_IDENTITY_UNAVAILABLE";
      return { available: false, probe: "read-only", errorCode };
    }
  };
  if (options.fetcher) return check();
  const now = Date.now();
  const key = `${provider.discovery}|${provider.clientSecret ? "client_secret_basic" : "none"}`;
  if (discoveryProbeCache && discoveryProbeCache.key === key && discoveryProbeCache.expiresAt > now) return discoveryProbeCache.result;
  const result = check();
  discoveryProbeCache = { key, expiresAt: now + DISCOVERY_PROBE_CACHE_MS, result };
  return result;
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
  const algorithm = token.header.alg;
  if ((algorithm !== "ES256" && algorithm !== "EdDSA") || typeof token.header.kid !== "string") throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌算法无效。");
  if (input.metadata.id_token_signing_alg_values_supported && !input.metadata.id_token_signing_alg_values_supported.includes(algorithm)) {
    throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌算法无效。");
  }
  const jwks = await fetchJson(input.fetcher, input.metadata.jwks_uri, { cache: "no-store", headers: { accept: "application/json" } }, "OIDC_JWKS_INVALID");
  if (!Array.isArray(jwks.keys)) throw new AccountAuthError("OIDC_JWKS_INVALID", 503, "统一登录签名密钥无效。");
  const matchingKeys = jwks.keys.filter((candidate) => candidate && typeof candidate === "object" && (candidate as JsonObject).kid === token.header.kid) as JsonWebKey[];
  const jwk = matchingKeys.length === 1 ? matchingKeys[0] : undefined;
  const keyOperations = jwk?.key_ops;
  const keyUsageInvalid = jwk?.use !== undefined && jwk.use !== "sig";
  const keyAlgorithmInvalid = jwk?.alg !== undefined && jwk.alg !== algorithm;
  const keyOperationsInvalid = keyOperations !== undefined
    && (!Array.isArray(keyOperations) || keyOperations.length !== 1 || keyOperations[0] !== "verify");
  if (!jwk || keyUsageInvalid || keyAlgorithmInvalid || keyOperationsInvalid
    || (algorithm === "ES256" ? jwk.kty !== "EC" || jwk.crv !== "P-256" : jwk.kty !== "OKP" || jwk.crv !== "Ed25519")) {
    throw new AccountAuthError("OIDC_JWKS_INVALID", 503, "统一登录签名密钥无效。");
  }
  let verified = false;
  try {
    if (algorithm === "ES256") {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, token.signature, token.signingInput);
    } else {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
      verified = await crypto.subtle.verify({ name: "Ed25519" }, key, token.signature, token.signingInput);
    }
  } catch { verified = false; }
  if (!verified) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌签名无效。");
  const claims = token.claims;
  const audience = claims.aud;
  const audienceValid = audience === input.clientId || (Array.isArray(audience) && audience.length === 1 && audience[0] === input.clientId);
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  if (claims.iss !== input.metadata.issuer || !audienceValid || claims.nonce !== input.nonce || typeof claims.sub !== "string" || !claims.sub) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌校验失败。");
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds - 30 || typeof claims.iat !== "number" || claims.iat > nowSeconds + 30) throw new AccountAuthError("OIDC_ID_TOKEN_INVALID", 401, "统一登录令牌已过期或时间无效。");
  return claims;
}

export async function beginKaiIdentityLogin(request: Request, options: { env?: Environment; fetcher?: typeof fetch; now?: Date } = {}): Promise<KaiIdentityStart> {
  const env = options.env ?? environment();
  const config = oidcConfiguration(env);
  const metadata = await readMetadata(options.fetcher ?? fetch, config);
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
    scope: config.scopes,
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { location: authorization.toString(), transactionCookie: transactionCookie(request, await sealTransaction(transaction, config.secret), TRANSACTION_MAX_AGE_SECONDS, env) };
}

export async function completeKaiIdentityLogin(request: Request, options: { env?: Environment; fetcher?: typeof fetch; store?: AccountAuthStore; now?: Date } = {}): Promise<KaiIdentityCompletion> {
  const env = options.env ?? environment();
  const config = oidcConfiguration(env);
  const now = options.now ?? new Date();
  const cookieName = secureRequest(request, env) ? SECURE_TRANSACTION_COOKIE : DEVELOPMENT_TRANSACTION_COOKIE;
  const sealed = cookieValue(request, cookieName);
  if (!sealed) throw new AccountAuthError("OIDC_TRANSACTION_INVALID", 401, "登录事务不存在，请重新登录。");
  const transaction = await openTransaction(sealed, config.secret, now);
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!state || state !== transaction.state) throw new AccountAuthError("OIDC_STATE_INVALID", 401, "登录状态校验失败，请重新登录。");
  if (url.searchParams.has("error")) throw new AccountAuthError("OIDC_AUTHORIZATION_DENIED", 401, "登录或授权未完成。");
  if (url.searchParams.get("iss") && url.searchParams.get("iss") !== config.issuer) throw new AccountAuthError("OIDC_ISSUER_INVALID", 401, "登录签发方校验失败。");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) throw new AccountAuthError("OIDC_RESPONSE_INVALID", 401, "统一登录响应无效，请重新登录。");
  const fetcher = options.fetcher ?? fetch;
  const metadata = await readMetadata(fetcher, config);
  const tokenHeaders = new Headers({ accept: "application/json", "content-type": "application/x-www-form-urlencoded" });
  const tokenBody = new URLSearchParams({ grant_type: "authorization_code", redirect_uri: config.redirectUri, code, code_verifier: transaction.verifier });
  if (config.clientSecret) {
    const formEncode = (value: string) => new URLSearchParams([["", value]]).toString().slice(1);
    tokenHeaders.set("authorization", `Basic ${Buffer.from(`${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`).toString("base64")}`);
  } else tokenBody.set("client_id", config.clientId);
  const tokenPayload = await fetchJson(fetcher, metadata.token_endpoint, {
    method: "POST",
    headers: tokenHeaders,
    body: tokenBody,
  }, "OIDC_TOKEN_EXCHANGE_FAILED");
  if (typeof tokenPayload.token_type !== "string" || tokenPayload.token_type.toLowerCase() !== "bearer") {
    throw new AccountAuthError("OIDC_TOKEN_EXCHANGE_FAILED", 401, "统一登录令牌无效。");
  }
  const claims = await validateIdToken(tokenPayload.id_token, { metadata, clientId: config.clientId, nonce: transaction.nonce, now, fetcher });
  if (typeof tokenPayload.access_token !== "string" || !tokenPayload.access_token) throw new AccountAuthError("OIDC_TOKEN_EXCHANGE_FAILED", 401, "统一登录令牌无效。");
  const userinfo = await fetchJson(fetcher, metadata.userinfo_endpoint, { headers: { accept: "application/json", authorization: `Bearer ${tokenPayload.access_token}` }, cache: "no-store" }, "OIDC_USERINFO_INVALID");
  if (userinfo.sub !== claims.sub || userinfo.email_verified !== true || typeof userinfo.email !== "string" || !userinfo.email.includes("@")) throw new AccountAuthError("OIDC_USERINFO_INVALID", 401, "统一账户没有可用的已验证邮箱。");
  const store = options.store ?? await getAccountAuthStore();
  const identity = await store.resolveOrCreateKaiIdentity({
    issuer: config.issuer,
    subject: String(claims.sub),
    displayName: typeof userinfo.name === "string" && userinfo.name.trim() ? userinfo.name.trim().slice(0, 120) : userinfo.email.split("@")[0].slice(0, 120),
    verifiedEmail: userinfo.email.trim().toLowerCase(),
    verifiedAt: now.toISOString(),
  });
  const issued = await createAccountSession(request, identity, "KAI_IDENTITY_OIDC", { store, now });
  return { issued, returnTo: transaction.returnTo, clearTransactionCookie: clearKaiIdentityTransactionCookie(request, env) };
}
