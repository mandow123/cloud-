import { AccountAuthError } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { hostingContractClientView, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { AccessGatewayClient, accessGatewayCapability } from "@/lib/server/access-gateway-client";

export const dynamic = "force-dynamic";

export async function GET(request: Request, contextValue: { params: Promise<{ contractId: string }> }) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const { contractId } = await contextValue.params;
    const store = await getHostingV2Store();
    const contract = await store.contractForViewer(account.activeOrganization.id, contractId);
    if (!contract) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
    if (contract.buyerOrganizationId !== account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "采购合同只能由采购方查看。");
    const evidence = await store.contractEvidenceForViewer(account.activeOrganization.id, contractId);
    const record = hostingContractClientView(contract, evidence ?? undefined);
    const gateway = accessGatewayCapability();
    const binding = gateway.configured ? await store.gatewayBinding(contract.id) : null;
    if (gateway.configured && binding?.status === "SLOT_CONFIRMED" && ["READY", "IN_SERVICE"].includes(contract.status)) {
      const access = await new AccessGatewayClient().issueBuyerAccess(contract.id);
      return jsonResponse({
        record: { ...record, endpointDisplay: access.buyerEndpoint },
        accessGateway: { version: 1, endpoint: access.buyerEndpoint, leaseId: access.leaseId, token: access.token, expiresAt: access.expiresAt, handshake: "JSON_LINE_V1" },
      }, 200, undefined, context);
    }
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
