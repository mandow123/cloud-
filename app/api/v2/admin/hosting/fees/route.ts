import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { requireAdminPermission } from "@/lib/server/admin-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { hostingBoolean, hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    await requireAdminPermission(request, ["MARKET_READ", "PAYMENT_READ"]);
    return jsonResponse({ record: await (await getHostingV2Store()).activeFeeSchedule(new Date().toISOString()) }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const admin = await requireAdminPermission(request, ["MARKET_PUBLISH", "SETTLEMENT_OPERATE"]);
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "createdBy", "payloadHash", "status", "id"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const mutation = await hostingMutationContext(request, admin.principal.id, body);
    const record = await (await getHostingV2Store()).createFeeSchedule({
      platformFeeBps: hostingInteger(body, "platformFeeBps"),
      referralRewardBps: hostingInteger(body, "referralRewardBps"),
      activate: hostingBoolean(body, "activate"),
      effectiveFrom: hostingString(body, "effectiveFrom", 20, 30),
    }, mutation);
    return jsonResponse({ record }, 201, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
