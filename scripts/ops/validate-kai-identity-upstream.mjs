#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { kaiIdentityProviderProfile, readIdentityDiscoveryJson, KAI_IDENTITY_ISSUER, KAI_IDENTITY_DISCOVERY } from "./kai-identity-provider-profile.mjs";

export { KAI_IDENTITY_ISSUER, KAI_IDENTITY_DISCOVERY, KAI_IDENTITY_MODERN_ISSUER, KAI_IDENTITY_MODERN_DISCOVERY, KAI_IDENTITY_MODERN_API_BASE } from "./kai-identity-provider-profile.mjs";

function providerConfiguration(environment = process.env) {
  const issuer = environment.KAI_ACCOUNT_OIDC_ISSUER?.trim() || KAI_IDENTITY_ISSUER;
  return kaiIdentityProviderProfile(issuer);
}

function failure(code, message, discovery, details = {}) {
  return { status: "error", code, message, discovery, ...details };
}

function validatedEndpoint(value, issuer) {
  if (typeof value !== "string") return null;
  try {
    const endpoint = new URL(value), issuerUrl = new URL(issuer);
    return endpoint.protocol === "https:" && endpoint.origin === issuerUrl.origin && !endpoint.username && !endpoint.password && !endpoint.hash
      ? endpoint.toString()
      : null;
  } catch { return null; }
}

export async function validateKaiIdentityUpstream({ fetcher = fetch, timeoutMs = 5_000, environment = process.env } = {}) {
  const provider = providerConfiguration(environment);
  if (!provider) return failure("OIDC_ISSUER_NOT_ALLOWED", "账户中心 Issuer 不在 Cloud 允许列表中。", environment.KAI_ACCOUNT_OIDC_ISSUER ?? null);
  let response;
  try {
    response = await fetcher(provider.discovery, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return failure("OIDC_DISCOVERY_UNREACHABLE", "账户中心 Discovery 无法连接。", provider.discovery, {
      reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
    });
  }

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400) {
    return failure(
      location === provider.discovery ? "OIDC_DISCOVERY_SELF_REDIRECT" : "OIDC_DISCOVERY_REDIRECT",
      location === provider.discovery
        ? "账户中心 Discovery 正在重定向到自身，必须修复上游 HTTPS 路由。"
        : "账户中心 Discovery 不应返回重定向。",
      provider.discovery,
      { httpStatus: response.status, location },
    );
  }

  if (response.status !== 200) {
    return failure("OIDC_DISCOVERY_HTTP_ERROR", "账户中心 Discovery 必须返回 HTTP 200。", provider.discovery, { httpStatus: response.status });
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return failure("OIDC_DISCOVERY_CONTENT_TYPE_INVALID", "账户中心 Discovery 必须返回 JSON。", provider.discovery, {
      httpStatus: response.status,
      contentType: contentType || null,
    });
  }

  const metadata = await readIdentityDiscoveryJson(response).catch(() => null);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return failure("OIDC_DISCOVERY_JSON_INVALID", "账户中心 Discovery 返回了无效 JSON。", provider.discovery, { httpStatus: response.status });
  }

  const mismatches = [];
  if (metadata.issuer !== provider.issuer) mismatches.push({ field: "issuer", expected: provider.issuer, actual: typeof metadata.issuer === "string" ? metadata.issuer : null });
  const endpoints = provider.endpoints;
  for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri", "userinfo_endpoint"]) {
    const endpoint = validatedEndpoint(metadata[field], provider.issuer);
    if (!endpoint || endpoint !== endpoints[field] || metadata[field] !== endpoints[field]) mismatches.push({ field, expected: endpoints[field], actual: typeof metadata[field] === "string" ? metadata[field] : null });
  }
  const expectedAuthMethod = provider.modern || environment.KAI_ACCOUNT_OIDC_CLIENT_SECRET?.trim() ? "client_secret_basic" : "none";
  const authMethods = metadata.token_endpoint_auth_methods_supported;
  const signingAlgorithms = metadata.id_token_signing_alg_values_supported;
  const validMethods = Array.isArray(authMethods) && authMethods.every((value) => typeof value === "string");
  const validAlgorithms = Array.isArray(signingAlgorithms) && signingAlgorithms.every((value) => typeof value === "string");
  if ((provider.modern && !validMethods) || (validMethods && !authMethods.includes(expectedAuthMethod))) {
    mismatches.push({ field: "token_endpoint_auth_methods_supported", expected: expectedAuthMethod, actual: metadata.token_endpoint_auth_methods_supported });
  }
  if ((provider.modern && !validAlgorithms) || (validAlgorithms && !signingAlgorithms.some((value) => value === "ES256" || value === "EdDSA"))) {
    mismatches.push({ field: "id_token_signing_alg_values_supported", expected: "ES256 or EdDSA", actual: metadata.id_token_signing_alg_values_supported });
  }
  if (mismatches.length > 0) {
    return failure("OIDC_DISCOVERY_METADATA_MISMATCH", "账户中心 Discovery 的 Issuer、端点或客户端认证方式与 Cloud Client 不一致。", provider.discovery, {
      httpStatus: response.status,
      mismatches,
    });
  }

  return {
    status: "ok",
    code: "OIDC_DISCOVERY_READY",
    message: "账户中心 Discovery 已满足 KAI Cloud 接入要求。",
    discovery: provider.discovery,
    httpStatus: response.status,
    metadata: {
      issuer: provider.issuer,
      authorization_endpoint: metadata.authorization_endpoint,
      token_endpoint: metadata.token_endpoint,
      jwks_uri: metadata.jwks_uri,
      userinfo_endpoint: metadata.userinfo_endpoint,
    },
  };
}

async function main() {
  const result = await validateKaiIdentityUpstream();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "ok") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify(failure("OIDC_DISCOVERY_VALIDATOR_FAILED", error instanceof Error ? error.message : "验收工具运行失败。", process.env.KAI_ACCOUNT_OIDC_ISSUER ?? KAI_IDENTITY_DISCOVERY), null, 2)}\n`);
    process.exitCode = 1;
  });
}
