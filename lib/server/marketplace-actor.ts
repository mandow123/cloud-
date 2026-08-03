const SECURE_SESSION_COOKIE = "__Host-kai_session";
const DEVELOPMENT_SESSION_COOKIE = "kai_session_dev";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type MarketplaceActor = {
  id: string;
  source: "platform" | "anonymous-session";
  sessionHash: string;
  csrfToken: string;
  expiresAt: string;
  isNew: boolean;
  responseHeaders: Headers;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const entry of cookies) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(entry.slice(separator + 1).trim());
  }
  return null;
}

export function isSecureMarketplaceRequest(request: Request) {
  if (new URL(request.url).protocol === "https:") return true;
  const trustProxy = typeof process !== "undefined" && process.env.KAI_TRUST_PROXY === "1";
  if (!trustProxy) return false;
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

export async function hashText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function sessionCookie(token: string, secure: boolean) {
  const name = secure ? SECURE_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
  return [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

/**
 * Sites requests use the trusted workspace identity header when available.
 * Direct Node deployments fall back to a high-entropy, HttpOnly anonymous session.
 * Only the hash is used as a database owner id; raw emails and tokens are never
 * persisted or returned to the client.
 */
export async function resolveMarketplaceActor(request: Request, forceNew = false): Promise<MarketplaceActor> {
  const responseHeaders = new Headers();
  // Forwarded identity is accepted only when an explicitly configured trusted
  // proxy strips client-supplied copies of this header. Direct deployments
  // intentionally ignore it.
  const trustPlatformHeaders = typeof process !== "undefined"
    && process.env.KAI_TRUST_PLATFORM_HEADERS === "1";
  const platformEmail = trustPlatformHeaders
    ? request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase()
    : null;
  if (platformEmail) {
    const sessionHash = await hashText(`kai-cloud-platform-session:${platformEmail}`);
    return {
      id: `oai_${(await hashText(`kai-cloud:${platformEmail}`)).slice(0, 40)}`,
      source: "platform",
      sessionHash,
      csrfToken: await hashText(`kai-cloud-csrf:${sessionHash}`),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1_000).toISOString(),
      isNew: false,
      responseHeaders,
    };
  }

  const secure = isSecureMarketplaceRequest(request);
  const cookieName = secure ? SECURE_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
  const existing = forceNew ? null : cookieValue(request, cookieName);
  const validExisting = existing && /^[a-f0-9]{64}$/u.test(existing) ? existing : null;
  const token = validExisting ?? randomToken();
  responseHeaders.set("set-cookie", sessionCookie(token, secure));
  const sessionHash = await hashText(`kai-cloud-session:${token}`);

  return {
    id: `anon_${(await hashText(`kai-cloud:${token}`)).slice(0, 40)}`,
    source: "anonymous-session",
    sessionHash,
    csrfToken: await hashText(`kai-cloud-csrf:${token}`),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1_000).toISOString(),
    isNew: !validExisting,
    responseHeaders,
  };
}
