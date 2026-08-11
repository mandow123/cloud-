import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";
import { reserveHostingContract } from "@/lib/server/hosting-contract-service";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { hostingContractClientView, hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "buyerOrganizationId", "supplierOrganizationId", "deviceId", "feeScheduleId", "heldMicros", "price", "payloadHash", "status", "id"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端计算。 `);
    }
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const result = await reserveHostingContract({
      account,
      offerId: hostingString(body, "offerId", 20, 100),
      reservedSeconds: hostingInteger(body, "reservedSeconds", 180),
      mutation,
    });
    return jsonResponse({ record: hostingContractClientView(result.contract), billing: { heldMicros: result.heldMicros, status: String(result.hold.status) }, replayed: result.replayed }, result.replayed ? 200 : 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const dashboard = await (await getHostingV2Store()).dashboard(account.activeOrganization.id, new Date().toISOString());
    const records = dashboard.contracts
      .filter((contract) => contract.buyerOrganizationId === account.activeOrganization.id)
      .map(hostingContractClientView);
    return jsonResponse({ records, count: records.length, updatedAt: new Date().toISOString() }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
