import { AccountAuthError } from "./account-auth.ts";

export function isHostingV2Enabled() {
  return typeof process !== "undefined"
    && ["1", "true"].includes((process.env.KAI_HOSTING_V2 ?? "").trim().toLowerCase());
}

export function isHostingV2SetupEnabled() {
  return isHostingV2Enabled() || (typeof process !== "undefined"
    && ["1", "true"].includes((process.env.KAI_HOSTING_V2_SETUP ?? "").trim().toLowerCase()));
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
