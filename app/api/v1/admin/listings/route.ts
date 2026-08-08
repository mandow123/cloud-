import { adminQuery, adminRead } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return adminRead(request, ["MARKET_READ"], (store) => store.readProjection("listings", adminQuery(request)));
}
