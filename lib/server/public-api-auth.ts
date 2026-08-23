import { AccountAuthError } from "./account-auth.ts";
import { requireKaiPublicApiEnabled, requireKaiPublicApiHttps } from "./public-api-feature.ts";

export const KAI_PUBLIC_API_SCOPES = ["resource:read", "verification:write", "agent:write"] as const;
export type KaiPublicApiScope = typeof KAI_PUBLIC_API_SCOPES[number];

export type KaiPublicApiClient = Readonly<{
  clientId: string;
  secretSha256: string;
  organizationId: string;
  organizationReference: string;
  accountId: string;
  scopes: readonly KaiPublicApiScope[];
  webhookUrl: string | null;
  webhookSecret: string | null;
}>;

export type KaiPublicApiPrincipal = Readonly<{
  clientId: string;
  organizationId: string;
  organizationReference: string;
  accountId: string;
  scopes: readonly KaiPublicApiScope[];
}>;

type Environment = Record<string, string | undefined>;
type TokenClaims = KaiPublicApiPrincipal & Readonly<{
  iss: string;
  aud: "kai-cloud-public-api";
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}>;

const encoder = new TextEncoder();
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/u;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/u;
const DUMMY_SECRET_SHA256 = "0".repeat(64);

function configurationError() {
  return new AccountAuthError("KAI_PUBLIC_API_CONFIGURATION_INVALID", 503, "KAI Cloud 公共接口配置不可用。 ");
}

function invalidRequest() {
  return new AccountAuthError("OAUTH_REQUEST_INVALID", 400, "OAuth 请求格式无效。 ");
}

function unauthorized() {
  return new AccountAuthError("OAUTH_CLIENT_INVALID", 401, "客户端身份无效。 ");
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw unauthorized();
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw unauthorized();
  }
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value))) as T;
  } catch (error) {
    if (error instanceof AccountAuthError) throw error;
    throw unauthorized();
  }
}

async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function signingSecret(environment: Environment) {
  const value = environment.KAI_PUBLIC_API_TOKEN_SIGNING_SECRET ?? "";
  if (value.length < 32 || value.length > 512) throw configurationError();
  return value;
}

function issuer(environment: Environment) {
  const value = (environment.KAI_PUBLIC_API_ISSUER ?? "kai-cloud-sandbox").trim();
  if (!OPAQUE_ID.test(value)) throw configurationError();
  return value;
}

function parseClient(value: unknown): KaiPublicApiClient {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw configurationError();
  const record = value as Record<string, unknown>;
  if (typeof record.clientId !== "string" || !CLIENT_ID.test(record.clientId)) throw configurationError();
  if (typeof record.secretSha256 !== "string" || !SHA256.test(record.secretSha256)) throw configurationError();
  if (typeof record.organizationId !== "string" || !OPAQUE_ID.test(record.organizationId)) throw configurationError();
  if (typeof record.organizationReference !== "string" || !OPAQUE_ID.test(record.organizationReference)) throw configurationError();
  if (typeof record.accountId !== "string" || !OPAQUE_ID.test(record.accountId)) throw configurationError();
  if (!Array.isArray(record.scopes) || record.scopes.length === 0 || record.scopes.some((scope) => !KAI_PUBLIC_API_SCOPES.includes(scope as KaiPublicApiScope))) throw configurationError();
  const scopes = [...new Set(record.scopes as KaiPublicApiScope[])];
  const webhookUrl = record.webhookUrl == null ? null : String(record.webhookUrl);
  const webhookSecret = record.webhookSecret == null ? null : String(record.webhookSecret);
  if ((webhookUrl === null) !== (webhookSecret === null)) throw configurationError();
  if (webhookUrl) {
    let parsed: URL;
    try { parsed = new URL(webhookUrl); } catch { throw configurationError(); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || webhookSecret!.length < 32) throw configurationError();
  }
  return {
    clientId: record.clientId,
    secretSha256: record.secretSha256.replace(/^sha256:/u, ""),
    organizationId: record.organizationId,
    organizationReference: record.organizationReference,
    accountId: record.accountId,
    scopes,
    webhookUrl,
    webhookSecret,
  };
}

export function kaiPublicApiClients(environment: Environment = process.env) {
  let values: unknown;
  try { values = JSON.parse(environment.KAI_PUBLIC_API_CLIENTS ?? "[]"); } catch { throw configurationError(); }
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) throw configurationError();
  const clients = values.map(parseClient);
  if (new Set(clients.map((client) => client.clientId)).size !== clients.length) throw configurationError();
  return clients;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function principal(client: KaiPublicApiClient): KaiPublicApiPrincipal {
  return {
    clientId: client.clientId,
    organizationId: client.organizationId,
    organizationReference: client.organizationReference,
    accountId: client.accountId,
    scopes: client.scopes,
  };
}

export async function authenticateKaiPublicApiClient(clientId: string, clientSecret: string, environment: Environment = process.env) {
  const client = kaiPublicApiClients(environment).find((candidate) => candidate.clientId === clientId);
  const candidateDigest = await sha256(clientSecret);
  const validSecret = constantTimeEqual(candidateDigest, client?.secretSha256 ?? DUMMY_SECRET_SHA256);
  if (!client || !validSecret) throw unauthorized();
  return client;
}

export async function issueKaiPublicApiToken(client: KaiPublicApiClient, environment: Environment = process.env, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const claims: TokenClaims = {
    ...principal(client),
    iss: issuer(environment), aud: "kai-cloud-public-api", sub: client.clientId,
    iat: issuedAt, exp: issuedAt + 300, jti: crypto.randomUUID(),
  };
  const header = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT", kid: "kai-public-v1" })));
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const unsigned = `${header}.${payload}`;
  return { accessToken: `${unsigned}.${base64url(await hmac(unsigned, signingSecret(environment)))}`, expiresIn: 300, scope: client.scopes.join(" ") };
}

function validClaims(value: unknown, environment: Environment, now: Date): value is TokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Partial<TokenClaims>;
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return claims.iss === issuer(environment) && claims.aud === "kai-cloud-public-api" && claims.sub === claims.clientId
    && typeof claims.clientId === "string" && CLIENT_ID.test(claims.clientId)
    && typeof claims.organizationId === "string" && OPAQUE_ID.test(claims.organizationId)
    && typeof claims.organizationReference === "string" && OPAQUE_ID.test(claims.organizationReference)
    && typeof claims.accountId === "string" && OPAQUE_ID.test(claims.accountId)
    && Array.isArray(claims.scopes) && claims.scopes.every((scope) => KAI_PUBLIC_API_SCOPES.includes(scope))
    && Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp)
    && Number(claims.iat) <= nowSeconds + 30 && Number(claims.exp) > nowSeconds && Number(claims.exp) <= Number(claims.iat) + 300
    && typeof claims.jti === "string" && claims.jti.length >= 16;
}

export async function authenticateKaiPublicApiRequest(request: Request, requiredScopes: readonly KaiPublicApiScope[], environment: Environment = process.env, now = new Date()) {
  requireKaiPublicApiEnabled(environment);
  requireKaiPublicApiHttps(request, environment);
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(request.headers.get("authorization") ?? "");
  if (!match) throw unauthorized();
  const [header, payload, signature] = match[1].split(".");
  const parsedHeader = decodeJson<Record<string, unknown>>(header);
  if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT" || parsedHeader.kid !== "kai-public-v1") throw unauthorized();
  const expected = base64url(await hmac(`${header}.${payload}`, signingSecret(environment)));
  if (!constantTimeEqual(signature, expected)) throw unauthorized();
  const claims = decodeJson<unknown>(payload);
  if (!validClaims(claims, environment, now)) throw unauthorized();
  const configured = kaiPublicApiClients(environment).find((client) => client.clientId === claims.clientId);
  if (!configured || configured.organizationId !== claims.organizationId || configured.organizationReference !== claims.organizationReference
    || configured.accountId !== claims.accountId || claims.scopes.some((scope) => !configured.scopes.includes(scope))) throw unauthorized();
  if (requiredScopes.some((scope) => !claims.scopes.includes(scope))) {
    throw new AccountAuthError("OAUTH_SCOPE_INSUFFICIENT", 403, "客户端权限不足。 ");
  }
  return claims as KaiPublicApiPrincipal;
}

export function kaiPublicApiClientForPrincipal(value: KaiPublicApiPrincipal, environment: Environment = process.env) {
  const client = kaiPublicApiClients(environment).find((candidate) => candidate.clientId === value.clientId);
  if (!client) throw unauthorized();
  return client;
}

function singleParameter(form: URLSearchParams, name: string) {
  const values = form.getAll(name);
  if (values.length > 1) throw invalidRequest();
  return values[0] ?? "";
}

function decodeBasicComponent(value: string) {
  return decodeURIComponent(value.replaceAll("+", " "));
}

export async function parseKaiPublicApiTokenRequest(request: Request, environment: Environment = process.env) {
  requireKaiPublicApiEnabled(environment);
  requireKaiPublicApiHttps(request, environment);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") throw invalidRequest();
  const raw = await request.text();
  if (raw.length > 8_192) throw invalidRequest();
  const form = new URLSearchParams(raw);
  if (singleParameter(form, "grant_type") !== "client_credentials") throw new AccountAuthError("OAUTH_GRANT_UNSUPPORTED", 400, "仅支持 client_credentials。 ");
  const requestedScope = singleParameter(form, "scope");
  const authorization = request.headers.get("authorization") ?? "";
  const bodyClientId = singleParameter(form, "client_id");
  const bodyClientSecret = singleParameter(form, "client_secret");
  let clientId = bodyClientId;
  let clientSecret = bodyClientSecret;
  if (authorization) {
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/iu.exec(authorization);
    if (!match || bodyClientId || bodyClientSecret) throw unauthorized();
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)));
      const separator = decoded.indexOf(":");
      if (separator < 1) throw new Error("invalid");
      clientId = decodeBasicComponent(decoded.slice(0, separator));
      clientSecret = decodeBasicComponent(decoded.slice(separator + 1));
    } catch { throw unauthorized(); }
  }
  if (!CLIENT_ID.test(clientId) || clientSecret.length < 16 || clientSecret.length > 512) throw unauthorized();
  const client = await authenticateKaiPublicApiClient(clientId, clientSecret, environment);
  const requestedScopes = requestedScope.split(/\s+/u).filter(Boolean);
  if (new Set(requestedScopes).size !== requestedScopes.length || requestedScopes.some((scope) => !client.scopes.includes(scope as KaiPublicApiScope))) {
    throw new AccountAuthError("OAUTH_SCOPE_INVALID", 400, "请求的 OAuth scope 无效。 ");
  }
  return { client, scope: requestedScopes.length ? requestedScopes as KaiPublicApiScope[] : client.scopes };
}
