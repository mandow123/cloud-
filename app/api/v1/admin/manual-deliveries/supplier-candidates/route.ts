import { adminRead } from "../../_shared.ts";

export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["FULFILLMENT_READ"],async(store)=>{const records=await store.listManualDeliverySupplierCandidates();return{records,count:records.length};});}
