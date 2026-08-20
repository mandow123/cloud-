import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody } from "@/lib/server/api-guard";
import { getKaiPublicApiStore } from "@/lib/server/public-api-store";
import { assertKaiPublicOrganization, authorizeKaiPublicApi, kaiPublicExactKeys, kaiPublicId, kaiPublicMutation, kaiPublicObject, kaiPublicString, kaiPublicVerificationView } from "@/lib/server/public-api-service";
import { deliverOneKaiPublicWebhook } from "@/lib/server/public-api-webhook";
import { AccountAuthError } from "@/lib/server/account-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    const principal = await authorizeKaiPublicApi(request, ["resource:read", "verification:write"]);
    const body = kaiPublicObject(await readJsonBody(request));
    kaiPublicExactKeys(body, ["organizationReference", "resourceReference", "resource"]);
    const organizationReference = kaiPublicId(body.organizationReference, "organizationReference");
    assertKaiPublicOrganization(principal, organizationReference);
    const resourceReference = kaiPublicId(body.resourceReference, "resourceReference");
    const resource = kaiPublicObject(body.resource);
    kaiPublicExactKeys(resource, ["productCode", "region", "specifications"]);
    const specifications = kaiPublicObject(resource.specifications);
    if (Object.keys(specifications).length > 100 || JSON.stringify(specifications).length > 16_384) throw new AccountAuthError("VALIDATION_ERROR", 400, "资源规格过大。 ");
    const result = await (await getKaiPublicApiStore()).createVerification(await kaiPublicMutation(request, principal, body), {
      resourceReference,
      productCode: kaiPublicString(resource.productCode, "productCode"),
      region: kaiPublicString(resource.region, "region"),
      specifications,
    });
    await deliverOneKaiPublicWebhook();
    const headers = new Headers({ "idempotency-replayed": String(result.replayed) });
    return jsonResponse({ record: kaiPublicVerificationView(result.record) }, result.replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, undefined, context);
  }
}
