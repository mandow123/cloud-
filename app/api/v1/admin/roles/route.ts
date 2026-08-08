import { adminQuery, adminRead } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["IDENTITY_READ"],store=>store.listRoles(adminQuery(request)));}
