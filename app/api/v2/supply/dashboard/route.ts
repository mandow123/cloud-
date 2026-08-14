import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingSupplierContractClientView, hostingSupplierDeviceWorkspaceView, hostingSupplierOfferClientView, requireHostingV2SetupEnabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2SetupEnabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const now = new Date().toISOString();
    const dashboard = await (await getHostingV2Store()).dashboard(account.activeOrganization.id, now);
    const supplierContracts = dashboard.contracts
      .filter((contract) => contract.supplierOrganizationId === account.activeOrganization.id)
      .map((contract) => hostingSupplierContractClientView(contract));
    const deviceWorkspace = hostingSupplierDeviceWorkspaceView(dashboard.devices, dashboard.offers, dashboard.contracts, account.activeOrganization.id, now);
    return jsonResponse({ dashboard: { ...dashboard, offers: dashboard.offers.map(hostingSupplierOfferClientView), contracts: supplierContracts, deviceWorkspace } }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
