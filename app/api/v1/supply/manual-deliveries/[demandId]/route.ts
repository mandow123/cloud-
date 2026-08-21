import { AccountAuthError } from "@/lib/server/account-auth";
import { getAdminOperationsStore } from "@/lib/server/admin-store";
import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import { supplyWorkspaceRole } from "@/lib/server/supply-api";

export const dynamic="force-dynamic";
export async function GET(request:Request,contextValue:{params:Promise<{demandId:string}>}){const context=beginApiRequest(request);try{await supplyWorkspaceRole(request,["supplier"]);const account=await requireTradingAccountSession(request);if(!account)throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED",401,"请先登录账户。 ");const{demandId}=await contextValue.params,record=await(await getAdminOperationsStore()).getSupplierManualDelivery(account.activeOrganization.id,demandId);if(!record)throw new AccountAuthError("SUPPLIER_MANUAL_DELIVERY_NOT_FOUND",404,"交付任务不存在。 ");return jsonResponse({record},200,{"cache-control":"private, no-store"},context);}catch(error){return apiErrorResponse(error,undefined,context);}}
