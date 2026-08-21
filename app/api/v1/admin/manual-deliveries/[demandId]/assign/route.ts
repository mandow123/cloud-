import { manualDeliveryAction } from "../_action.ts";
export const dynamic = "force-dynamic";
export async function POST(request:Request,context:{params:Promise<{demandId:string}>}){const{demandId}=await context.params;return manualDeliveryAction(request,demandId,"ASSIGN");}
