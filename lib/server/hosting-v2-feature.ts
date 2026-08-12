import { AccountAuthError } from "./account-auth.ts";

type HostingFeatureEnvironment = Record<string, string | undefined>;

function enabled(value: string | undefined) {
  return ["1", "true"].includes((value ?? "").trim().toLowerCase());
}

export function isHostingV2ConfigurationEnabled(environment: HostingFeatureEnvironment) {
  return enabled(environment.KAI_HOSTING_V2) || enabled(environment.KAI_HOSTING_V2_SETUP);
}

export function isHostingV2Enabled() {
  return typeof process !== "undefined" && enabled(process.env.KAI_HOSTING_V2);
}

export function isHostingV2SetupEnabled() {
  return typeof process !== "undefined" && isHostingV2ConfigurationEnabled(process.env);
}

export function requireHostingV2Enabled() {
  if (!isHostingV2Enabled()) {
    throw new AccountAuthError("HOSTING_V2_DISABLED", 503, "新版算力上架功能尚未在当前环境开放。 ");
  }
}

export function requireHostingV2SetupEnabled() {
  if (!isHostingV2SetupEnabled()) {
    throw new AccountAuthError("HOSTING_V2_SETUP_DISABLED", 503, "新版算力上架的配置入口尚未在当前环境开放。 ");
  }
}
