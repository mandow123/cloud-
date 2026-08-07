import { adminQuery, adminRead } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["KAI_SELF_INVENTORY_READ"],store=>store.readProjection("pools",adminQuery(request)));}
