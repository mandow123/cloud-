import { adminQuery, adminRead } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["AUDIT_READ"],store=>store.listAuditEvents(adminQuery(request)));}
