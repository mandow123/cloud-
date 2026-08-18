import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingSupplierEarningsClientView, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const updatedAt = new Date().toISOString();
    const [cardHours, hosting] = await Promise.all([getCardHourStore(), getHostingV2Store()]);
    const [dashboard, feePreview, monthlySettlement] = await Promise.all([
      cardHours.dashboard(account.activeOrganization.id, updatedAt),
      hosting.supplierFeePreview(account.activeOrganization.id, updatedAt),
      hosting.supplierMonthlySettlement(account.activeOrganization.id, updatedAt),
    ]);
    return jsonResponse({ earnings: hostingSupplierEarningsClientView(dashboard, feePreview, monthlySettlement, updatedAt) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
