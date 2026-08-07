import { adminQuery, adminRead, adminWrite } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["SUPPLY_INTAKE_REVIEW"],store=>store.readProjection("supply-offers",adminQuery(request)));}
export async function POST(request:Request){return adminWrite(request,["SUPPLY_INTAKE_REVIEW"],(store,actor,input)=>store.createWorkItem(actor,{sourceSystem:"SUPPLY_PILOT",entityType:"SUPPLY_OFFER",entityId:input.entityId,workType:"SUPPLY_REVIEW",title:input.title??`Review supply offer ${input.entityId}`,summary:input.reason,priority:input.priority??"NORMAL",metadata:{requestedAction:input.action}}));}
