import { adminQuery, adminRead } from "../_shared";
export const dynamic="force-dynamic";
export async function GET(request:Request){return adminRead(request,["VERIFICATION_REVIEW"],store=>store.readProjection("verifications",adminQuery(request)));}
