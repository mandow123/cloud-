import { AccountAuthError } from "./account-auth.ts";

export function isHostingV2Enabled() {
  return typeof process !== "undefined"
    && ["1", "true"].includes((process.env.KAI_HOSTING_V2 ?? "").trim().toLowerCase());
}

export function requireHostingV2Enabled() {
  if (!isHostingV2Enabled()) {
    throw new AccountAuthError("HOSTING_V2_DISABLED", 503, "新版算力上架功能尚未在当前环境开放。 ");
  }
}
