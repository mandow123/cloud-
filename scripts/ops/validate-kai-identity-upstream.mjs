#!/usr/bin/env node

import { pathToFileURL } from "node:url";

export const KAI_IDENTITY_ISSUER = "https://account.kai.com/connect";
export const KAI_IDENTITY_DISCOVERY = `${KAI_IDENTITY_ISSUER}/.well-known/openid-configuration`;

const EXPECTED_METADATA = Object.freeze({
  issuer: KAI_IDENTITY_ISSUER,
  authorization_endpoint: `${KAI_IDENTITY_ISSUER}/auth`,
  token_endpoint: `${KAI_IDENTITY_ISSUER}/token`,
  jwks_uri: `${KAI_IDENTITY_ISSUER}/jwks`,
  userinfo_endpoint: `${KAI_IDENTITY_ISSUER}/me`,
});

function failure(code, message, details = {}) {
  return { status: "error", code, message, discovery: KAI_IDENTITY_DISCOVERY, ...details };
}

export async function validateKaiIdentityUpstream({ fetcher = fetch, timeoutMs = 5_000 } = {}) {
  let response;
  try {
    response = await fetcher(KAI_IDENTITY_DISCOVERY, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return failure("OIDC_DISCOVERY_UNREACHABLE", "账户中心 Discovery 无法连接。", {
      reason: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network",
    });
  }

  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400) {
    return failure(
      location === KAI_IDENTITY_DISCOVERY ? "OIDC_DISCOVERY_SELF_REDIRECT" : "OIDC_DISCOVERY_REDIRECT",
      location === KAI_IDENTITY_DISCOVERY
        ? "账户中心 Discovery 正在重定向到自身，必须修复上游 HTTPS 路由。"
        : "账户中心 Discovery 不应返回重定向。",
      { httpStatus: response.status, location },
    );
  }

  if (response.status !== 200) {
    return failure("OIDC_DISCOVERY_HTTP_ERROR", "账户中心 Discovery 必须返回 HTTP 200。", { httpStatus: response.status });
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return failure("OIDC_DISCOVERY_CONTENT_TYPE_INVALID", "账户中心 Discovery 必须返回 JSON。", {
      httpStatus: response.status,
      contentType: contentType || null,
    });
  }

  const metadata = await response.json().catch(() => null);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return failure("OIDC_DISCOVERY_JSON_INVALID", "账户中心 Discovery 返回了无效 JSON。", { httpStatus: response.status });
  }

  const mismatches = [];
  for (const [field, expected] of Object.entries(EXPECTED_METADATA)) {
    if (metadata[field] !== expected) mismatches.push({ field, expected, actual: typeof metadata[field] === "string" ? metadata[field] : null });
  }
  if (mismatches.length > 0) {
    return failure("OIDC_DISCOVERY_METADATA_MISMATCH", "账户中心 Discovery 的 Issuer 或端点与 Cloud Client 不一致。", {
      httpStatus: response.status,
      mismatches,
    });
  }

  return {
    status: "ok",
    code: "OIDC_DISCOVERY_READY",
    message: "账户中心 Discovery 已满足 KAI Cloud 接入要求。",
    discovery: KAI_IDENTITY_DISCOVERY,
    httpStatus: response.status,
    metadata: EXPECTED_METADATA,
  };
}

async function main() {
  const result = await validateKaiIdentityUpstream();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "ok") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify(failure("OIDC_DISCOVERY_VALIDATOR_FAILED", error instanceof Error ? error.message : "验收工具运行失败。"), null, 2)}\n`);
    process.exitCode = 1;
  });
}
