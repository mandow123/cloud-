import { adminQuery, adminRead } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return adminRead(request, ["ADMIN_PANEL_READ"], (store) => store.readProjection("exceptions", adminQuery(request)));
}
