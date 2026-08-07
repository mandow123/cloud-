import { adminQuery, adminRead, adminWrite } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["ADMIN_PANEL_READ"],store=>store.listWorkItems(adminQuery(request)));}
export async function POST(request:Request){return adminWrite(request,["ADMIN_PANEL_READ"],(store,actor,input)=>store.createWorkItem(actor,input));}
