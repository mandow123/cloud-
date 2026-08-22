import { AccountAuthError } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { requireManualAppealsEnabled } from "@/lib/server/manual-appeals";
export const dynamic="force-dynamic";
export async function GET(request:Request){const c=beginApiRequest(request);try{requireManualAppealsEnabled();const account=await requireTradingAccountSession(request);if(!account)throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED",401,"请先登录账户。 ");const records=await(await getAdminOperationsStore()).listMemberManualAppeals(account.activeOrganization.id,100);return jsonResponse({records,count:records.length},200,{"cache-control":"private, no-store"},c);}catch(error){return apiErrorResponse(error,undefined,c);}}
