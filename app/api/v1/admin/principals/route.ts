import { adminQuery, adminRead, adminWrite } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["IDENTITY_READ"],store=>store.listPrincipals(adminQuery(request)));}
export async function POST(request:Request){return adminWrite(request,["IDENTITY_MANAGE"],(store,actor,input)=>store.invitePrincipal(actor,input));}
