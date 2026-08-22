import { AccountAuthError } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
export const dynamic="force-dynamic";
export async function GET(request:Request,ctx:{params:Promise<{caseId:string}>}){const c=beginApiRequest(request);try{requireManualAppealsEnabled();const account=await requireTradingAccountSession(request);if(!account)throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED",401,"请先登录账户。 ");const{caseId}=await ctx.params,record=await(await getAdminOperationsStore()).getMemberManualAppeal(account.activeOrganization.id,caseId);if(!record)throw new AccountAuthError("MANUAL_APPEAL_NOT_FOUND",404,"申诉不存在。 ");return jsonResponse({record},200,{"cache-control":"private, no-store"},c);}catch(error){return apiErrorResponse(error,undefined,c);}}
