import { assertAccountAuthSameOrigin, AccountAuthError, accountAuthDigest } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse, readJsonBody, requireIdempotencyKey } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { rejectAppealEvidence, requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";
export const dynamic="force-dynamic";
export async function POST(request:Request,ctx:{params:Promise<{caseId:string}>}){const c=beginApiRequest(request);try{requireManualAppealsEnabled();assertAccountAuthSameOrigin(request);await supplyWorkspaceRole(request,["supplier"]);const account=await requireTradingAccountSession(request);if(!account)throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED",401,"请先登录账户。 ");const input=await readJsonBody(request) as Record<string,unknown>;rejectAppealEvidence(input.evidenceIds);const{caseId}=await ctx.params,result=await(await getAdminOperationsStore()).addSupplierManualAppealMessage({principalId:account.account.id,organizationId:account.activeOrganization.id,idempotencyKey:requireIdempotencyKey(request),payloadHash:await accountAuthDigest(JSON.stringify(input))},caseId,input);return jsonResponse(result,result.replayed?200:201,{"cache-control":"private, no-store","idempotency-replayed":String(result.replayed)},c);}catch(error){return apiErrorResponse(error,undefined,c);}}
