import { AccountAuthError } from "./account-auth.ts";

type Environment = Record<string, string | undefined>;

function enabled(value: string | undefined) {
  return ["1", "true"].includes((value ?? "").trim().toLowerCase());
}

function production(environment: Environment) {
  return (environment.KAI_ENVIRONMENT ?? environment.NODE_ENV ?? "").trim().toUpperCase() === "PRODUCTION";
}

export function isKaiPublicApiEnabled(environment: Environment = process.env) {
  return enabled(environment.KAI_PUBLIC_API_ENABLED);
}

export function requireKaiPublicApiEnabled(environment: Environment = process.env) {
  if (!isKaiPublicApiEnabled(environment)) {
    throw new AccountAuthError("KAI_PUBLIC_API_DISABLED", 503, "KAI Cloud 公共接口尚未在当前环境开放。 ");
  }
  if (production(environment) && !enabled(environment.KAI_PUBLIC_API_GATEWAY_RATE_LIMITED)) {
    throw new AccountAuthError("KAI_PUBLIC_API_GATEWAY_REQUIRED", 503, "KAI Cloud 公共接口缺少生产网关限流保护。 ");
  }
}

export function requireKaiPublicApiHttps(request: Request, environment: Environment = process.env) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  const forwardedSecure = enabled(environment.KAI_TRUST_PROXY) && forwarded === "https";
  const secure = new URL(request.url).protocol === "https:" || forwardedSecure;
  if (production(environment) && !secure) {
    throw new AccountAuthError("HTTPS_REQUIRED", 403, "KAI Cloud 公共接口仅接受 HTTPS 请求。 ");
  }
}
