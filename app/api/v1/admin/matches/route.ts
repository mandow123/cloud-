import { adminQuery, adminRead, adminWrite } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["MARKET_READ"],store=>store.readProjection("matches",adminQuery(request)));}
export async function POST(request:Request){return adminWrite(request,["MARKET_PUBLISH"],(store,actor,input)=>store.createWorkItem(actor,{sourceSystem:"ADMIN",entityType:"MATCH",entityId:input.matchId??crypto.randomUUID(),workType:"DEMAND_MATCH",title:input.title??"Demand and supply match review",summary:input.reason,priority:input.priority??"NORMAL",metadata:{demandId:input.demandId,supplyOfferId:input.supplyOfferId}}));}
