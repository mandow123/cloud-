import { AccountAuthError } from "./account-auth.ts";

export function requireHostingV2Enabled() {
  const enabled = typeof process !== "undefined" && ["1", "true"].includes((process.env.KAI_HOSTING_V2 ?? "").trim().toLowerCase());
  if (!enabled) throw new AccountAuthError("HOSTING_V2_DISABLED", 503, "新版算力上架功能尚未在当前环境开放。 ");
}
