import { AccountAuthError, assertAccountAuthSameOrigin } from "@/lib/server/account-auth";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { HOSTING_SUPPLIER_TYPES, type HostingSupplierType } from "@/lib/hosting-v2";
import { hostingInteger, hostingMutationContext, hostingObject, hostingString, requireHostingV2Enabled } from "@/lib/server/hosting-v2-api";
import { getHostingV2Store } from "@/lib/server/hosting-v2-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const dashboard = await (await getHostingV2Store()).dashboard(account.activeOrganization.id, new Date().toISOString());
    return jsonResponse({ record: dashboard.profile }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}

export async function PUT(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireHostingV2Enabled();
    assertAccountAuthSameOrigin(request);
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录账户。 ");
    const body = hostingObject(await readJsonBody(request));
    for (const field of ["actorId", "accountId", "organizationId", "payloadHash", "status", "reviewNote", "evidenceDigest"]) {
      if (field in body) throw new AccountAuthError("HOSTING_SERVER_FIELD_FORBIDDEN", 400, `${field} 只能由服务端生成。 `);
    }
    const supplierType = hostingString(body, "supplierType", 2, 32) as HostingSupplierType;
    if (!HOSTING_SUPPLIER_TYPES.includes(supplierType)) throw new AccountAuthError("HOSTING_VALIDATION_ERROR", 400, "supplierType 不受支持。 ");
    const mutation = await hostingMutationContext(request, account.account.id, body);
    const record = await (await getHostingV2Store()).saveProfile(account, {
      supplierType,
      legalDisplayName: hostingString(body, "legalDisplayName", 2, 120),
      contactEmail: hostingString(body, "contactEmail", 5, 254),
      expectedVersion: hostingInteger(body, "expectedVersion"),
    }, mutation);
    return jsonResponse({ record }, 200, undefined, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
