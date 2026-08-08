import { adminWrite } from "../../../_shared";
export const dynamic="force-dynamic";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return adminWrite(request,["ROOT_CONTROL"],(store,actor,input)=>store.updatePrincipalStatus(id,actor,input));}
