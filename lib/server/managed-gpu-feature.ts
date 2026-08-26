import { AccountAuthError } from "./account-auth.ts";
export function managedGpuFeatureEnabled(environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env) {
  return environment.KAI_MANAGED_GPU_MVP === "1";
}
export function managedGpuOrganizationInvited(organizationId: string, environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env) {
  const allowed = (environment.KAI_MANAGED_GPU_INVITED_ORGANIZATIONS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowed.includes(organizationId);
}
export function managedGpuOrganizationEnabled(organizationId: string, environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env) {
  return managedGpuFeatureEnabled(environment) && managedGpuOrganizationInvited(organizationId, environment);
}
export function requireManagedGpuFeature() {
  if (!managedGpuFeatureEnabled()) throw new AccountAuthError("MANAGED_GPU_DISABLED", 503, "GPU 云托管当前尚未开放。");
}
export function requireManagedGpuOrganization(organizationId: string) {
  requireManagedGpuFeature();
  if (!managedGpuOrganizationInvited(organizationId)) throw new AccountAuthError("MANAGED_GPU_INVITATION_REQUIRED", 403, "GPU 云托管首期仅向受邀企业开放。");
}
