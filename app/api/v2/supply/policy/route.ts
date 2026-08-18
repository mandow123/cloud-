import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { hostingV2ApprovedImages, hostingV2CurrentTermsVersion } from "@/lib/server/hosting-v2-image-policy";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const feePreview = await (await getHostingV2Store()).supplierFeePreview(account.activeOrganization.id, new Date().toISOString());
    return jsonResponse({ policy: { approvedImages: [...hostingV2ApprovedImages()], termsVersion: hostingV2CurrentTermsVersion(), feePreview } }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
