import type { AdminPermission } from "../admin-auth-types.ts";
import { accountAuthDigest, assertAccountAuthSameOrigin } from "./account-auth.ts";
import { readJsonBody, requireIdempotencyKey } from "./api-guard.ts";
import { requireAdminPermission } from "./admin-auth.ts";
import { managedGpuObject } from "./managed-gpu-api.ts";
import type { ManagedGpuApprovalAction } from "./managed-gpu-store.ts";
export const MANAGED_GPU_APPROVAL_PERMISSIONS: Readonly<Record<ManagedGpuApprovalAction, AdminPermission>> = {
  ISSUE_QUOTE: "MARKET_PUBLISH", RECORD_PAYMENT_EVIDENCE: "PAYMENT_OPERATE", TRANSITION_ORDER: "FULFILLMENT_OPERATE",
  CREATE_ASSET: "KAI_SELF_INVENTORY_WRITE", TRANSITION_ASSET: "VERIFICATION_REVIEW", CREATE_SETTLEMENT: "SETTLEMENT_OPERATE", TRANSITION_SETTLEMENT: "SETTLEMENT_OPERATE", SHIP_ASSET: "FULFILLMENT_OPERATE",
  PUBLISH_PRODUCT_VERSION: "MARKET_PUBLISH", ACTIVATE_FACILITY: "FULFILLMENT_OPERATE", PUBLISH_ECONOMIC_POLICY: "SETTLEMENT_OPERATE",
};
export async function managedGpuAdminMutation(request: Request, permissions: readonly AdminPermission[]) {
  assertAccountAuthSameOrigin(request);
  const auth = await requireAdminPermission(request, permissions);
  const input = managedGpuObject(await readJsonBody(request));
  const approvalId = request.headers.get("x-kai-approval-id")?.trim();
  return { auth, input, context: { organizationId: auth.organization.id, accountId: auth.principal.id, idempotencyKey: requireIdempotencyKey(request), payloadHash: await accountAuthDigest(JSON.stringify(input)), now: new Date().toISOString(), ...(approvalId ? { approvalId } : {}) } };
}
