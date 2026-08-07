import { adminQuery, adminRead, adminWrite } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["MARKET_READ"],store=>store.readProjection("demands",adminQuery(request)));}
export async function POST(request:Request){return adminWrite(request,["MARKET_PUBLISH"],(store,actor,input)=>store.createWorkItem(actor,{sourceSystem:"MARKETPLACE",entityType:"DEMAND",entityId:input.entityId,workType:"DEMAND_REVIEW",title:input.title??`Review demand ${input.entityId}`,summary:input.reason,priority:input.priority??"NORMAL",metadata:{requestedAction:input.action}}));}
