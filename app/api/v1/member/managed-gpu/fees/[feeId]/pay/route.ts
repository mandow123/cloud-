import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuInteger, managedGpuMemberMutation, managedGpuReadBody, managedGpuRejectFields } from "@/lib/server/managed-gpu-api";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";

export const dynamic="force-dynamic";
export async function POST(request:Request,routeContext:{params:Promise<{feeId:string}>}){
  const context=beginApiRequest(request);
  try{
    const body=await managedGpuReadBody(request);
    managedGpuRejectFields(body,["organizationId","accountId","status","balance"]);
    const {context:mutation}=await managedGpuMemberMutation(request,body);
    const {feeId}=await routeContext.params;
    const result=await (await getManagedGpuStore()).payOutstandingHostingFee(mutation,feeId,{expectedAmountMicros:managedGpuInteger(body,"expectedAmountMicros",1)});
    return jsonResponse(result,result.replayed?200:201,{"idempotency-replayed":String(result.replayed)},context);
  }catch(error){return apiErrorResponse(error,undefined,context);}
}
