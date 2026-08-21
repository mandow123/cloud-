import { AccountAuthError } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";

export const dynamic="force-dynamic";
export async function GET(request:Request){const context=beginApiRequest(request);try{await supplyWorkspaceRole(request,["supplier"]);const account=await requireTradingAccountSession(request);if(!account)throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED",401,"请先登录账户。 ");const records=await(await getAdminOperationsStore()).listSupplierManualDeliveries(account.activeOrganization.id,100);return jsonResponse({records,count:records.length},200,{"cache-control":"private, no-store"},context);}catch(error){return apiErrorResponse(error,undefined,context);}}
