// Issuers identify the token namespace. Discovery and API paths are independent
// parts of the approved provider contract, never derived from untrusted metadata.
export const KAI_IDENTITY_ISSUER = "https://account.kai.com/connect";
export const KAI_IDENTITY_DISCOVERY = `${KAI_IDENTITY_ISSUER}/.well-known/openid-configuration`;
export const KAI_IDENTITY_MODERN_ISSUER = "https://auth.kai.com";
export const KAI_IDENTITY_MODERN_DISCOVERY = `${KAI_IDENTITY_MODERN_ISSUER}/.well-known/openid-configuration`;
export const KAI_IDENTITY_MODERN_API_BASE = "https://auth.kai.com/api/auth";

const legacy = Object.freeze({
  issuer: KAI_IDENTITY_ISSUER,
  discovery: KAI_IDENTITY_DISCOVERY,
  scopes: "openid kai:name email",
  modern: false,
  endpoints: Object.freeze({
    authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
    token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
    jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
  }),
});

const modern = Object.freeze({
  issuer: KAI_IDENTITY_MODERN_ISSUER,
  discovery: KAI_IDENTITY_MODERN_DISCOVERY,
  scopes: "openid profile email",
  modern: true,
  endpoints: Object.freeze({
    authorization_endpoint: `${KAI_IDENTITY_MODERN_API_BASE}/oauth2/authorize`,
    token_endpoint: `${KAI_IDENTITY_MODERN_API_BASE}/oauth2/token`,
    jwks_uri: `${KAI_IDENTITY_MODERN_API_BASE}/jwks`,
    userinfo_endpoint: `${KAI_IDENTITY_MODERN_API_BASE}/oauth2/userinfo`,
  }),
});

export function kaiIdentityProviderProfile(issuer = KAI_IDENTITY_ISSUER) {
  if (issuer === legacy.issuer) return legacy;
  if (issuer === modern.issuer) return modern;
  return null;
}

export async function readIdentityDiscoveryJson(response) {
  const maxBytes = 512 * 1024;
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
    throw new Error("OIDC_DISCOVERY_INVALID");
  }
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("OIDC_DISCOVERY_INVALID");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OIDC_DISCOVERY_INVALID");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("OIDC_DISCOVERY_INVALID");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OIDC_DISCOVERY_INVALID");
  return value;
}
