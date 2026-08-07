import { adminWrite } from "../../_shared";
export const dynamic="force-dynamic";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return adminWrite(request,["ADMIN_PANEL_READ"],(store,actor,input)=>store.updateWorkItem(id,actor,input));}
