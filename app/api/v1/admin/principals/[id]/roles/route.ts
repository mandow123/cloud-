import { adminWrite } from "../../../_shared";
export const dynamic="force-dynamic";
export async function PUT(request:Request,context:{params:Promise<{id:string}>}){const {id}=await context.params;return adminWrite(request,["IDENTITY_MANAGE"],(store,actor,input)=>store.assignPrincipalRoles(id,actor,input));}
