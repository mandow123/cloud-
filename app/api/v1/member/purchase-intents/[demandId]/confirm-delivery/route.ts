import { assertAccountAuthSameOrigin, AccountAuthError, accountAuthDigest } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";

export const dynamic = "force-dynamic";

export async function POST(request:Request,contextValue:{params:Promise<{demandId:string}>}){
  const context=beginApiRequest(request);
  try{
    assertAccountAuthSameOrigin(request);
    const account=await requireTradingAccountSession(request);if(!account)throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED",401,"请先登录账户。 ");
    const input=await readJsonBody(request) as Record<string,unknown>,{demandId}=await contextValue.params;
    const result=await (await getAdminOperationsStore()).confirmMemberManualDelivery({principalId:account.account.id,organizationId:account.activeOrganization.id,idempotencyKey:requireIdempotencyKey(request),payloadHash:await accountAuthDigest(JSON.stringify(input))},demandId,input);
    return jsonResponse(result,result.replayed?200:201,{"cache-control":"private, no-store","idempotency-replayed":String(result.replayed)},context);
  }catch(error){return apiErrorResponse(error,undefined,context);}
}
