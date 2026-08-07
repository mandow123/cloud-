import { adminQuery, adminRead } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["FULFILLMENT_READ"],store=>store.readProjection("orders",adminQuery(request)));}
